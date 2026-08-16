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
    return new Response(`<!doctype html>
      <html><head>
        <meta charset="utf-8">
        <!--nextane-head--><!--nextane-styles-->
      </head><body>
        <div id="__next"></div><!--nextane-data-->
      </body></html>`, { headers: { "content-type": "text/html" } });
  },
};

function localePage() {
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
            createElement("p", { id: "router-locale" }, Router.locale),
          ),
        async getStaticProps(context: { locale?: string }) {
          const greetings: Record<string, string> = {
            en: "Hello",
            fr: "Bonjour",
          };
          return {
            props: { greeting: greetings[context.locale ?? "en"] ?? "??" },
          };
        },
      };
    },
  };
}

function makeManifest(): NextaneManifest {
  return {
    routes: [localePage()],
    loadApp: null,
    loadDocument: null,
    loadError: null,
    buildId: "test-build",
    config: { i18n: { locales: ["en", "fr"], defaultLocale: "en" } },
  };
}

describe("ISR + i18n repro", () => {
  it("serves per-locale content when ISR cache is wired", async () => {
    const manifest = makeManifest();
    const isr = createIsrArtifactHandler(manifest);
    // Map-backed cache keyed by canonical URL, mirroring worker.ts loadLocalArtifact.
    const store = new Map<string, string>();

    const loadCachedArtifact = async (artifactRequest: Request) => {
      const key = new URL(artifactRequest.url).pathname;
      if (store.has(key)) {
        return new Response(store.get(key)!, {
          headers: { "content-type": "application/json", "x-cache-status": "HIT" },
        });
      }
      if (artifactRequest.headers.get("x-nextane-only-cached") === "1") {
        return new Response("not cached", { status: 404 });
      }
      const res = await isr(artifactRequest);
      const body = await res.clone().text();
      if (res.ok) store.set(key, body);
      return new Response(body, {
        status: res.status,
        headers: { "content-type": "application/json", "x-cache-status": "MISS" },
      });
    };

    const handler = createNextaneHandler(manifest, { loadCachedArtifact });

    // French first, to test the finding's "first-writer-wins" claim.
    const fr = await handler(new Request("https://nextane.test/fr/about"), {
      ASSETS: assets,
    });
    const frHtml = await fr.text();

    const en = await handler(new Request("https://nextane.test/about"), {
      ASSETS: assets,
    });
    const enHtml = await en.text();

    console.log("FR status", fr.status);
    console.log("FR greeting match", frHtml.match(/id="greeting">([^<]*)/)?.[1]);
    console.log("FR router-locale", frHtml.match(/id="router-locale">([^<]*)/)?.[1]);
    console.log("FR __NEXT_DATA__ locale", frHtml.match(/"locale":"([^"]*)"/)?.[1]);
    console.log("EN status", en.status);
    console.log("EN greeting match", enHtml.match(/id="greeting">([^<]*)/)?.[1]);
    console.log("EN router-locale", enHtml.match(/id="router-locale">([^<]*)/)?.[1]);
    console.log("EN __NEXT_DATA__ locale", enHtml.match(/"locale":"([^"]*)"/)?.[1]);
    console.log("cache keys", [...store.keys()]);

    // What SHOULD happen (Next.js): FR serves Bonjour, EN serves Hello.
    expect(frHtml).toContain("Bonjour");
    expect(enHtml).toContain("Hello");
  });
});
