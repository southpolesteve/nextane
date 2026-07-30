import { describe, expect, it } from "vitest";
import App from "../fixtures/upstream-app.tsrx";
import Document from "../fixtures/upstream-document.tsrx";
import Page from "../fixtures/upstream-page.tsrx";
import {
  createNextaneHandler,
  type NextaneManifest,
} from "../../src/server/handler";

const route = {
  route: "/items/[slug]",
  regexSource: "^/items/([^/]+)/?$",
  params: [{ name: "slug", kind: "single" as const }],
  id: 0,
  kind: "page" as const,
  async load() {
    return {
      default: Page,
      async getServerSideProps({
        req,
        res,
        query,
        resolvedUrl,
      }: {
        req: { url: string };
        res: { setHeader(name: string, value: string): void };
        query: Record<string, unknown>;
        resolvedUrl: string;
      }) {
        res.setHeader("x-from-gssp", "yes");
        return {
          props: {
            requestUrl: req.url,
            resolvedUrl,
            query,
          },
        };
      },
    };
  },
};

function manifest(overrides: Partial<NextaneManifest> = {}): NextaneManifest {
  return {
    routes: [route],
    loadApp: async () => ({ default: App }),
    loadDocument: async () => ({ default: Document }),
    loadError: null,
    ...overrides,
  };
}

const assets = {
  async fetch() {
    return new Response(`<!doctype html>
      <html><head>
        <meta charset="utf-8">
        <!--nextane-head--><!--nextane-styles-->
        <link rel="preload" href="/client.js">
      </head><body>
        <div id="__next"></div><!--nextane-data-->
        <script type="module" src="/client.js"></script>
      </body></html>`);
  },
};

describe("Pages Router server compatibility", () => {
  it("preserves GSSP req/res, app initial props, query precedence, and custom document rendering", async () => {
    const handler = createNextaneHandler(manifest());
    const response = await handler(
      new Request(
        "https://nextane.test/items/real-slug?slug=wrong&hello=world",
      ),
      { ASSETS: assets },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-from-gssp")).toBe("yes");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );
    expect(html).toContain('class="test-html-props"');
    expect(html).toMatch(/class="custom-body(?:\s[^"]*)?"/);
    expect(html).toContain("Hello Document");
    expect(html).toContain("/items/real-slug?slug=wrong&amp;hello=world");
    expect(html).toContain(
      '{"slug":"real-slug","hello":"world"}',
    );
    expect(html).toContain('script id="__NEXT_DATA__"');
    expect(html).toMatch(/script[^>]+nonce="test-nonce"/);
    expect(html).toMatch(/link[^>]+nonce="test-nonce"/);
  });

  it("keeps the original data URL on req while exposing the resolved page URL", async () => {
    const handler = createNextaneHandler(manifest());
    const response = await handler(
      new Request(
        "https://nextane.test/_next/data/development/items/octane.json?hello=world",
      ),
      { ASSETS: assets },
    );
    const data = (await response.json()) as {
      appRequestUrl: string;
      pageProps: {
        requestUrl: string;
        resolvedUrl: string;
        query: Record<string, unknown>;
      };
    };

    expect(data.appRequestUrl).toBe(
      "/_next/data/development/items/octane.json?hello=world",
    );
    expect(data.pageProps.requestUrl).toBe(
      "/_next/data/development/items/octane.json?hello=world",
    );
    expect(data.pageProps.resolvedUrl).toBe("/items/octane?hello=world");
    expect(data.pageProps.query).toEqual({ hello: "world", slug: "octane" });
    expect(response.headers.get("x-from-gssp")).toBe("yes");
  });

  it("supports Document.getInitialProps renderPage component enhancers", async () => {
    const handler = createNextaneHandler(manifest());
    const response = await handler(
      new Request("https://nextane.test/items/octane?enhance=true"),
      { ASSETS: assets },
    );

    expect(await response.text()).toContain(
      'id="render-page-enhance-component">RENDERED',
    );
  });

  it("applies Pages-style rewrites while keeping req.url and router asPath public", async () => {
    const handler = createNextaneHandler(
      manifest({
        config: {
          rewrites: [
            {
              source: "/public-:slug",
              destination: "/items/rewritten?internal=yes",
            },
          ],
        },
      }),
    );
    const response = await handler(
      new Request("https://nextane.test/public-octane?visible=yes"),
      { ASSETS: assets },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("/public-octane?visible=yes");
    expect(html).toContain("/items/rewritten?visible=yes");
    expect(html).toContain(
      '{"internal":"yes","slug":"rewritten","visible":"yes"}',
    );
  });

  it("returns early when getServerSideProps ends the response", async () => {
    const earlyRoute = {
      ...route,
      route: "/early",
      regexSource: "^/early/?$",
      params: [],
      async load() {
        return {
          default: Page,
          getServerSideProps({
            res,
          }: {
            res: {
              statusCode: number;
              setHeader(name: string, value: string): void;
              end(value: string): void;
            };
          }) {
            res.statusCode = 202;
            res.setHeader("x-early", "yes");
            res.end("hello from gssp");
            return { props: {} };
          },
        };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [earlyRoute],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const response = await handler(
      new Request("https://nextane.test/early"),
      { ASSETS: assets },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-early")).toBe("yes");
    expect(await response.text()).toBe("hello from gssp");
  });

  it("renders POST requests without forwarding the method to the HTML asset lookup", async () => {
    let assetMethod = "";
    const handler = createNextaneHandler(manifest());
    const response = await handler(
      new Request("https://nextane.test/items/octane", {
        method: "POST",
        body: "hello=world",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      {
        ASSETS: {
          async fetch(request: Request) {
            assetMethod = request.method;
            return assets.fetch();
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(assetMethod).toBe("GET");
  });

  it("renders a Next-shaped default 404 when no custom page exists", async () => {
    const handler = createNextaneHandler(
      manifest({ routes: [], loadApp: null, loadDocument: null }),
    );
    const response = await handler(
      new Request("https://nextane.test/missing"),
      { ASSETS: assets },
    );
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("This page could not be found.");
    expect(html).toContain('"page":"/404"');
  });

  it("honors getStaticPaths with fallback false and renders other fallback modes on demand", async () => {
    const makeRoute = (fallback: boolean | "blocking") => ({
      ...route,
      async load() {
        return {
          default: Page,
          async getStaticPaths() {
            return {
              paths: [{ params: { slug: "known" } }],
              fallback,
            };
          },
          async getStaticProps({
            params,
          }: {
            params: Record<string, unknown>;
          }) {
            return {
              props: {
                resolvedUrl: String(params.slug),
              },
            };
          },
        };
      },
    });

    const strictHandler = createNextaneHandler(
      manifest({
        routes: [makeRoute(false)],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const missing = await strictHandler(
      new Request("https://nextane.test/items/missing"),
      { ASSETS: assets },
    );
    expect(missing.status).toBe(404);

    const blockingHandler = createNextaneHandler(
      manifest({
        routes: [makeRoute("blocking")],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const generated = await blockingHandler(
      new Request("https://nextane.test/items/generated"),
      { ASSETS: assets },
    );
    expect(generated.status).toBe(200);
    expect(await generated.text()).toContain("generated");
  });

  it("matches an empty optional catch-all path and supplies params to getStaticProps", async () => {
    const optionalRoute = {
      ...route,
      route: "/optional/[[...slug]]",
      regexSource: "^/optional(?:/(.*))?/?$",
      params: [{ name: "slug", kind: "optionalCatchAll" as const }],
      async load() {
        return {
          default: Page,
          async getStaticPaths() {
            return {
              paths: [{ params: { slug: [] } }],
              fallback: false,
            };
          },
          async getStaticProps({
            params: { slug },
          }: {
            params: { slug?: string[] };
          }) {
            return {
              props: {
                resolvedUrl: JSON.stringify(slug ?? []),
              },
            };
          },
        };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [optionalRoute],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const response = await handler(
      new Request("https://nextane.test/optional"),
      { ASSETS: assets },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("[]");
  });

  it("redirects page paths to the configured trailing-slash form", async () => {
    const withSlash = createNextaneHandler(
      manifest({ config: { trailingSlash: true } }),
    );
    const added = await withSlash(
      new Request("https://nextane.test/items/octane?hello=world"),
      { ASSETS: assets },
    );

    expect(added.status).toBe(308);
    expect(added.headers.get("location")).toBe(
      "https://nextane.test/items/octane/?hello=world",
    );

    const withoutSlash = createNextaneHandler(
      manifest({ config: { trailingSlash: false } }),
    );
    const removed = await withoutSlash(
      new Request("https://nextane.test/items/octane/?hello=world"),
      { ASSETS: assets },
    );

    expect(removed.status).toBe(308);
    expect(removed.headers.get("location")).toBe(
      "https://nextane.test/items/octane?hello=world",
    );
  });
});
