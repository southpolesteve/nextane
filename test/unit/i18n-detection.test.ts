import { describe, expect, it } from "vitest";
import {
  acceptLanguage,
  localeDetectionRedirect,
  normalizeI18nConfig,
} from "../../src/server/i18n";

const i18n = { locales: ["en", "id"], defaultLocale: "en" };

describe("acceptLanguage (port of Next's negotiator)", () => {
  it("picks the highest-q configured locale", () => {
    expect(acceptLanguage("id,en;q=0.8", ["en", "id"])).toBe("id");
    expect(acceptLanguage("en;q=0.5, id;q=0.9", ["en", "id"])).toBe("id");
  });

  it("breaks an equal-q tie by configured locale order, then header order", () => {
    // Unknown "fr" sorts last; "en" (configured first) beats "id".
    expect(acceptLanguage("fr,id,en", ["en", "id"])).toBe("en");
  });

  it("matches a language-only header entry to a regional locale (prefix match)", () => {
    expect(acceptLanguage("fr", ["en-CA", "fr-CA"])).toBe("fr-CA");
    expect(acceptLanguage("en", ["en-CA", "fr-CA"])).toBe("en-CA");
  });

  it("does not match a regional header entry to a plain locale (Next's asymmetry)", () => {
    // Playwright's default en-US therefore falls through to the default locale.
    expect(acceptLanguage("en-US", ["en", "id"])).toBe("");
  });

  it("returns an empty string when nothing matches", () => {
    expect(acceptLanguage("de", ["en", "id"])).toBe("");
    expect(acceptLanguage("", ["en", "id"])).toBe("");
  });

  it("excludes q=0 entries and expands * to unlisted locales", () => {
    expect(acceptLanguage("id;q=0,en", ["en", "id"])).toBe("en");
    expect(acceptLanguage("*", ["en", "id"])).toBe("en");
    expect(acceptLanguage("en;q=0.1,*", ["en", "id"])).toBe("id");
  });

  it("throws on a malformed header, like Next", () => {
    expect(() => acceptLanguage("id;q=0.5;x", ["en", "id"])).toThrow();
    expect(() => acceptLanguage("id;foo=1", ["en", "id"])).toThrow();
  });
});

describe("localeDetectionRedirect", () => {
  const base = {
    pathname: "/",
    hadLocalePrefix: false,
    nextLocaleCookie: undefined,
    acceptLanguageHeader: null,
    basePath: "",
    trailingSlash: false,
    search: "",
    i18n,
  };

  it("redirects the bare root to the Accept-Language locale", () => {
    expect(
      localeDetectionRedirect({ ...base, acceptLanguageHeader: "id" }),
    ).toBe("/id");
  });

  it("does not redirect when the detected locale is the default", () => {
    expect(localeDetectionRedirect({ ...base, acceptLanguageHeader: "en" })).toBeNull();
    // en-US does not match "en" in Next's negotiator, so it falls to the default.
    expect(
      localeDetectionRedirect({ ...base, acceptLanguageHeader: "en-US" }),
    ).toBeNull();
    expect(localeDetectionRedirect(base)).toBeNull();
  });

  it("lets a NEXT_LOCALE cookie beat Accept-Language, case-insensitively", () => {
    expect(
      localeDetectionRedirect({
        ...base,
        nextLocaleCookie: "ID",
        acceptLanguageHeader: "en",
      }),
    ).toBe("/id");
  });

  it("ignores a cookie naming an unconfigured locale", () => {
    expect(
      localeDetectionRedirect({
        ...base,
        nextLocaleCookie: "de",
        acceptLanguageHeader: "id",
      }),
    ).toBe("/id");
  });

  it("never re-triggers on a locale-prefixed root (no redirect loop)", () => {
    expect(
      localeDetectionRedirect({
        ...base,
        hadLocalePrefix: true,
        acceptLanguageHeader: "id",
      }),
    ).toBeNull();
  });

  it("applies only to the root path", () => {
    expect(
      localeDetectionRedirect({
        ...base,
        pathname: "/new",
        acceptLanguageHeader: "id",
      }),
    ).toBeNull();
  });

  it("honors localeDetection: false", () => {
    expect(
      localeDetectionRedirect({
        ...base,
        i18n: { ...i18n, localeDetection: false as const },
        acceptLanguageHeader: "id",
      }),
    ).toBeNull();
  });

  it("keeps basePath, trailing slash, and the query string", () => {
    expect(
      localeDetectionRedirect({
        ...base,
        basePath: "/docs",
        trailingSlash: true,
        search: "?a=1",
        acceptLanguageHeader: "id",
      }),
    ).toBe("/docs/id/?a=1");
  });

  it("negotiates default-first so * and equal-q ties settle on the default", () => {
    const reversed = { locales: ["id", "en"], defaultLocale: "en" };
    expect(
      localeDetectionRedirect({ ...base, i18n: reversed, acceptLanguageHeader: "*" }),
    ).toBeNull();
    expect(
      localeDetectionRedirect({ ...base, i18n: reversed, acceptLanguageHeader: "id,en" }),
    ).toBeNull();
    // An explicit preference still wins.
    expect(
      localeDetectionRedirect({ ...base, i18n: reversed, acceptLanguageHeader: "id" }),
    ).toBe("/id");
  });

  it("accepts /index and /index/ as the root", () => {
    expect(
      localeDetectionRedirect({ ...base, pathname: "/index", acceptLanguageHeader: "id" }),
    ).toBe("/id");
    expect(
      localeDetectionRedirect({ ...base, pathname: "/index/", acceptLanguageHeader: "id" }),
    ).toBe("/id");
  });

  it("unquotes a quoted NEXT_LOCALE cookie like Next's cookie parser", () => {
    expect(
      localeDetectionRedirect({ ...base, nextLocaleCookie: '"id"' }),
    ).toBe("/id");
  });

  it("swallows a malformed Accept-Language header", () => {
    expect(
      localeDetectionRedirect({ ...base, acceptLanguageHeader: "id;q=0.5;x" }),
    ).toBeNull();
  });
});

describe("normalizeI18nConfig", () => {
  it("moves the default locale to the front, like Next's config normalization", () => {
    expect(
      normalizeI18nConfig({ locales: ["id", "en"], defaultLocale: "en" }),
    ).toEqual({ locales: ["en", "id"], defaultLocale: "en" });
  });

  it("rejects a non-boolean localeDetection, like Next", () => {
    expect(() =>
      normalizeI18nConfig({
        locales: ["en"],
        defaultLocale: "en",
        localeDetection: "false",
      }),
    ).toThrow(/localeDetection must be a boolean/);
  });

  it("records only an explicit false", () => {
    expect(
      normalizeI18nConfig({
        locales: ["en"],
        defaultLocale: "en",
        localeDetection: false,
      }),
    ).toEqual({ locales: ["en"], defaultLocale: "en", localeDetection: false });
    expect(
      normalizeI18nConfig({
        locales: ["en"],
        defaultLocale: "en",
        localeDetection: true,
      }),
    ).toEqual({ locales: ["en"], defaultLocale: "en" });
  });
});

// ---------------------------------------------------------------------------
// Handler-level: the redirect is issued before routing, exactly once, and the
// locale-prefixed target renders normally.
// ---------------------------------------------------------------------------
import { createElement } from "octane";
import {
  createNextaneHandler,
  type NextaneManifest,
} from "../../src/server/handler";

const assets = {
  async fetch() {
    return new Response(
      `<!doctype html><html><head><!--nextane-head--></head><body><div id="__next"></div><!--nextane-data--></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
};

function indexPage() {
  return {
    route: "/",
    regexSource: "^/?$",
    params: [],
    id: 0,
    kind: "page" as const,
    async load() {
      return {
        default: (props: { locale?: string }) =>
          createElement("p", { id: "loc" }, props.locale),
        async getServerSideProps(ctx: { locale?: string }) {
          return { props: { locale: ctx.locale } };
        },
      };
    },
  };
}

function detectionManifest(
  config: NonNullable<NextaneManifest["config"]>,
): NextaneManifest {
  return {
    routes: [indexPage()],
    loadApp: null,
    loadDocument: null,
    loadError: null,
    buildId: "test-build",
    config,
  };
}

const env = { ASSETS: assets };
const get = (
  handler: ReturnType<typeof createNextaneHandler>,
  path: string,
  headers: Record<string, string> = {},
) => handler(new Request(`https://nextane.test${path}`, { headers }), env);

describe("localeDetection in the request handler", () => {
  const handler = createNextaneHandler(detectionManifest({ i18n }));

  it("307s the bare root to the Accept-Language locale before routing", async () => {
    const res = await get(handler, "/", { "accept-language": "id" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/id");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lets the NEXT_LOCALE cookie drive the redirect", async () => {
    const res = await get(handler, "/", { cookie: "NEXT_LOCALE=id" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/id");
  });

  it("serves the default locale at the root when nothing selects another", async () => {
    expect((await get(handler, "/")).status).toBe(200);
    expect((await get(handler, "/", { "accept-language": "en" })).status).toBe(200);
  });

  it("renders the locale-prefixed root without re-triggering (no loop)", async () => {
    const res = await get(handler, "/id", { "accept-language": "id" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"locale":"id"');
  });

  it("preserves the query string on the redirect", async () => {
    const res = await get(handler, "/?x=1", { "accept-language": "id" });
    expect(res.headers.get("location")).toBe("/id?x=1");
  });

  it("is disabled by localeDetection: false", async () => {
    const off = createNextaneHandler(
      detectionManifest({ i18n: { ...i18n, localeDetection: false } }),
    );
    expect((await get(off, "/", { "accept-language": "id" })).status).toBe(200);
  });

  it("targets `${basePath}/{locale}` for the root inside or outside the basePath", async () => {
    const based = createNextaneHandler(
      detectionManifest({ basePath: "/docs", i18n }),
    );
    const inside = await get(based, "/docs", { "accept-language": "id" });
    expect(inside.status).toBe(307);
    expect(inside.headers.get("location")).toBe("/docs/id");
    // Next's removePathPrefix leaves an unprefixed "/" untouched, so the bare
    // root is locale-redirected into the basePath as well.
    const outside = await get(based, "/", { "accept-language": "id" });
    expect(outside.status).toBe(307);
    expect(outside.headers.get("location")).toBe("/docs/id");
    // Any other path outside the basePath is untouched by detection.
    expect(
      (await get(based, "/other", { "accept-language": "id" })).status,
    ).not.toBe(307);
  });

  it("treats /index like the root, as Next's denormalizePagePath does", async () => {
    const res = await get(handler, "/index", { "accept-language": "id" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/id");
  });

  it("adds the trailing slash when trailingSlash is on", async () => {
    const slashed = createNextaneHandler(
      detectionManifest({ trailingSlash: true, i18n }),
    );
    const res = await get(slashed, "/", { "accept-language": "id" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/id/");
  });
});
