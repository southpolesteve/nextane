import { createElement } from "octane";
import { describe, expect, it } from "vitest";
import Router from "../../src/runtime/router";
import {
  createIsrArtifactHandler,
  createNextaneHandler,
  type NextaneManifest,
} from "../../src/server/handler";

const assets = {
  async fetch() {
    return new Response(
      `<!doctype html>
      <html><head>
        <meta charset="utf-8">
        <!--nextane-head--><!--nextane-styles-->
      </head><body>
        <div id="__next"></div><!--nextane-data-->
      </body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
};

const GREETINGS: Record<string, string> = { en: "Hello", fr: "Bonjour" };

/** A static `getStaticProps` page that greets per locale and echoes the locale. */
function aboutPage() {
  return {
    route: "/about",
    regexSource: "^/about/?$",
    params: [],
    id: 0,
    kind: "page" as const,
    async load() {
      return {
        default: (props: { greeting?: string }) =>
          createElement(
            "div",
            null,
            createElement("p", { id: "greeting" }, props.greeting),
            createElement("p", { id: "router-locale" }, Router.locale ?? ""),
          ),
        async getStaticProps(context: { locale?: string }) {
          return {
            props: { greeting: GREETINGS[context.locale ?? "en"] ?? "??" },
          };
        },
      };
    },
  };
}

function labeledPage(route: string, label: string) {
  return {
    route,
    regexSource: `^${route}/?$`,
    params: [],
    id: 1,
    kind: "page" as const,
    async load() {
      return {
        default: () => createElement("p", { id: "page" }, label),
      };
    },
  };
}

const I18N = { locales: ["en", "fr"], defaultLocale: "en" };

function i18nManifest(overrides: Partial<NextaneManifest> = {}): NextaneManifest {
  return {
    routes: [aboutPage()],
    loadApp: null,
    loadDocument: null,
    loadError: null,
    buildId: "test-build",
    config: { i18n: { ...I18N } },
    ...overrides,
  };
}

describe("i18n static/ISR artifact caching", () => {
  it("keys the shared artifact per locale so each locale gets its own content", async () => {
    const isr = createIsrArtifactHandler(i18nManifest());
    const store = new Map<string, string>();
    const loadCachedArtifact = async (artifactRequest: Request) => {
      const key = new URL(artifactRequest.url).pathname;
      if (store.has(key)) {
        return new Response(store.get(key)!, {
          headers: { "content-type": "application/json", "x-cache-status": "HIT" },
        });
      }
      const res = await isr(artifactRequest);
      const body = await res.clone().text();
      if (res.ok) store.set(key, body);
      return new Response(body, { status: res.status });
    };
    const handler = createNextaneHandler(i18nManifest(), { loadCachedArtifact });

    // Non-default locale first, to prove there is no cross-locale poisoning.
    const fr = await handler(new Request("https://nextane.test/fr/about"), {
      ASSETS: assets,
    });
    const frHtml = await fr.text();
    const en = await handler(new Request("https://nextane.test/about"), {
      ASSETS: assets,
    });
    const enHtml = await en.text();

    expect(frHtml).toContain("Bonjour");
    expect(frHtml).toContain('id="router-locale">fr');
    expect(enHtml).toContain("Hello");
    expect(enHtml).toContain('id="router-locale">en');
    // Distinct cache keys: the default locale stays unprefixed.
    expect([...store.keys()].sort()).toEqual(["/about", "/fr/about"]);
  });
});

describe("i18n internal redirects", () => {
  it("preserves the active locale on the redirect destination", async () => {
    const handler = createNextaneHandler(
      i18nManifest({
        config: {
          i18n: { ...I18N },
          redirects: [
            { source: "/old-blog", destination: "/new-blog" },
            { source: "/fr/legacy", destination: "/modern", locale: false },
          ],
        },
      }),
    );

    const prefixed = await handler(
      new Request("https://nextane.test/fr/old-blog"),
      { ASSETS: assets },
    );
    expect(prefixed.headers.get("location")).toBe(
      "https://nextane.test/fr/new-blog",
    );

    // The default locale stays unprefixed.
    const dflt = await handler(new Request("https://nextane.test/old-blog"), {
      ASSETS: assets,
    });
    expect(dflt.headers.get("location")).toBe("https://nextane.test/new-blog");

    // `locale: false` redirects match the locale-included source and are not
    // re-prefixed with the active locale.
    const ignore = await handler(
      new Request("https://nextane.test/fr/legacy"),
      { ASSETS: assets },
    );
    expect(ignore.headers.get("location")).toBe("https://nextane.test/modern");
  });
});

describe("i18n header rules", () => {
  it("applies non-locale:false header rules across all locales", async () => {
    const handler = createNextaneHandler(
      i18nManifest({
        config: {
          i18n: { ...I18N },
          headers: [
            { source: "/about", headers: [{ key: "x-custom", value: "1" }] },
          ],
        },
      }),
    );

    const dflt = await handler(new Request("https://nextane.test/about"), {
      ASSETS: assets,
    });
    expect(dflt.headers.get("x-custom")).toBe("1");

    const prefixed = await handler(
      new Request("https://nextane.test/fr/about"),
      { ASSETS: assets },
    );
    expect(prefixed.headers.get("x-custom")).toBe("1");
  });
});

describe("i18n data requests", () => {
  it("serves locale-prefixed /_next/data JSON with the right locale context", async () => {
    const handler = createNextaneHandler(i18nManifest());

    const fr = await handler(
      new Request("https://nextane.test/_next/data/test-build/fr/about.json"),
      { ASSETS: assets },
    );
    expect(fr.status).toBe(200);
    const frData = (await fr.json()) as { pageProps?: { greeting?: string } };
    expect(frData.pageProps?.greeting).toBe("Bonjour");

    const en = await handler(
      new Request("https://nextane.test/_next/data/test-build/en/about.json"),
      { ASSETS: assets },
    );
    expect(en.status).toBe(200);
    const enData = (await en.json()) as { pageProps?: { greeting?: string } };
    expect(enData.pageProps?.greeting).toBe("Hello");
  });
});

describe("afterFiles rewrite phase order", () => {
  it("lets a real page win over an afterFiles rewrite, but fires on a miss", async () => {
    const handler = createNextaneHandler({
      routes: [labeledPage("/about", "ABOUT"), labeledPage("/team", "TEAM")],
      loadApp: null,
      loadDocument: null,
      loadError: null,
      buildId: "test-build",
      config: {
        rewrites: [
          { source: "/about", destination: "/team" },
          { source: "/virtual", destination: "/team" },
        ],
      },
    });

    // A real /about page wins over the afterFiles rewrite to /team.
    const page = await handler(new Request("https://nextane.test/about"), {
      ASSETS: assets,
    });
    const pageHtml = await page.text();
    expect(pageHtml).toContain("ABOUT");
    expect(pageHtml).not.toContain("TEAM");

    // A path with no page falls through to the afterFiles rewrite.
    const rewritten = await handler(
      new Request("https://nextane.test/virtual"),
      { ASSETS: assets },
    );
    expect(await rewritten.text()).toContain("TEAM");
  });
});
