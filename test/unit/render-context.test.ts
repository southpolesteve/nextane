import { createElement } from "octane";
import { describe, expect, it } from "vitest";
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

function base(overrides: Partial<NextaneManifest>): NextaneManifest {
  return {
    routes: [],
    loadApp: null,
    loadDocument: null,
    loadError: null,
    buildId: "test-build",
    ...overrides,
  };
}

describe("render context", () => {
  it("passes the route pattern (not the concrete URL) as page getInitialProps ctx.pathname", async () => {
    const handler = createNextaneHandler(
      base({
        routes: [
          {
            route: "/items/[slug]",
            regexSource: "^/items/([^/]+)/?$",
            params: [{ name: "slug", kind: "single" as const }],
            id: 0,
            kind: "page" as const,
            async load() {
              return {
                default: (props: { ctxPathname?: string }) =>
                  createElement("p", { id: "p" }, props.ctxPathname),
                async getInitialProps(ctx: { pathname: string }) {
                  return { ctxPathname: ctx.pathname };
                },
              };
            },
          },
        ],
      }),
    );

    const res = await handler(
      new Request("https://nextane.test/items/octane?a=1"),
      { ASSETS: assets },
    );
    const html = await res.text();
    expect(html).toContain("/items/[slug]");
    expect(html).not.toContain(">/items/octane<");
  });

  it("merges App.getInitialProps pageProps with getServerSideProps props", async () => {
    const handler = createNextaneHandler(
      base({
        loadApp: async () => ({
          default: Object.assign(
            (props: Record<string, unknown>) =>
              createElement((props.Component as () => unknown) ?? "div", {
                ...((props.pageProps as Record<string, unknown>) ?? {}),
              }),
            {
              async getInitialProps() {
                return { pageProps: { fromApp: "APP", shared: "app" } };
              },
            },
          ),
        }),
        routes: [
          {
            route: "/about",
            regexSource: "^/about/?$",
            params: [],
            id: 0,
            kind: "page" as const,
            async load() {
              return {
                default: (props: { fromApp?: string; fromGssp?: string; shared?: string }) =>
                  createElement(
                    "p",
                    { id: "p" },
                    `${props.fromApp ?? ""}|${props.fromGssp ?? ""}|${props.shared ?? ""}`,
                  ),
                async getServerSideProps() {
                  return { props: { fromGssp: "GSSP", shared: "gssp" } };
                },
              };
            },
          },
        ],
      }),
    );

    const res = await handler(new Request("https://nextane.test/about"), {
      ASSETS: assets,
    });
    const html = await res.text();
    // App-injected pageProps survive; the data-function props win on collision.
    expect(html).toContain('"fromApp":"APP"');
    expect(html).toContain('"fromGssp":"GSSP"');
    expect(html).toContain('"shared":"gssp"');
  });

  it("omits getServerSideProps params for a static route", async () => {
    const handler = createNextaneHandler(
      base({
        routes: [
          {
            route: "/about",
            regexSource: "^/about/?$",
            params: [],
            id: 0,
            kind: "page" as const,
            async load() {
              return {
                default: (props: { hasParams?: boolean }) =>
                  createElement("p", { id: "p" }, String(props.hasParams)),
                async getServerSideProps(ctx: { params?: unknown }) {
                  return { props: { hasParams: ctx.params !== undefined } };
                },
              };
            },
          },
        ],
      }),
    );

    const res = await handler(new Request("https://nextane.test/about"), {
      ASSETS: assets,
    });
    expect(await res.text()).toContain('"hasParams":false');
  });
});
