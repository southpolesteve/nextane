import { createElement, use } from "octane";
import { describe, expect, it, vi } from "vitest";
import App from "../fixtures/upstream-app.tsrx";
import Document from "../fixtures/upstream-document.tsrx";
import Page from "../fixtures/upstream-page.tsrx";
import ReplacementDocument from "../fixtures/replacement-document.tsrx";
import ReplacementPage from "../fixtures/replacement-page.tsrx";
import Router from "../../src/runtime/router";
import {
  createIsrArtifactHandler,
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
        <SCRIPT>globalThis.__templateInline = true</SCRIPT >
      </head><body>
        <div id="__next"></div><!--nextane-data-->
        <SCRIPT data-note=">" type="module" src="/client.js"></SCRIPT >
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
    expect(html).not.toContain("__templateInline");
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

  it("isolates request, response, cookie, header, and body data across overlapping GSSP HTML and data requests", async () => {
    const requestCount = 24;
    let entered = 0;
    let releaseAll!: () => void;
    const allEntered = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const IsolationPage = (props: Record<string, unknown>) =>
      createElement("pre", { id: "request-isolation" }, JSON.stringify(props));
    const isolationRoute = {
      ...route,
      route: "/request-isolation",
      regexSource: "^/request-isolation/?$",
      params: [],
      async load() {
        return {
          default: IsolationPage,
          async getServerSideProps({
            req,
            res,
            query,
          }: {
            req: {
              url: string;
              cookies: Record<string, string>;
              headers: { get(name: string): string | null };
            };
            res: { setHeader(name: string, value: string): void };
            query: Record<string, unknown>;
          }) {
            const token = String(query.token);
            entered += 1;
            if (entered === requestCount) releaseAll();
            await allEntered;
            res.setHeader("x-request-canary", token);
            res.setHeader(
              "set-cookie",
              `request-canary=${token}; Path=/; HttpOnly`,
            );
            return {
              props: {
                token,
                authorization: req.headers.get("authorization"),
                cookie: req.cookies.session,
                requestUrl: req.url,
              },
            };
          },
        };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        buildId: "request-isolation-build",
        routes: [isolationRoute],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const tokens = Array.from(
      { length: requestCount },
      (_, index) => `request-${String(index).padStart(2, "0")}-canary`,
    );
    const responses = await Promise.all(
      tokens.map((token, index) =>
        handler(
          new Request(
            index % 2 === 0
              ? `https://nextane.test/request-isolation?token=${token}`
              : `https://nextane.test/_next/data/request-isolation-build/request-isolation.json?token=${token}`,
            {
              headers: {
                authorization: `Bearer ${token}`,
                cookie: `session=${token}`,
              },
            },
          ),
          { ASSETS: assets },
        ),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.text()));

    for (let index = 0; index < requestCount; index += 1) {
      const response = responses[index];
      const body = bodies[index];
      const token = tokens[index];
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, max-age=0, must-revalidate",
      );
      expect(response.headers.get("x-request-canary")).toBe(token);
      expect(response.headers.get("set-cookie")).toContain(token);
      expect(body).toContain(token);
      expect(body).toContain(`Bearer ${token}`);
      for (const other of tokens) {
        if (other !== token) expect(body).not.toContain(other);
      }
    }
  });

  it("isolates Octane suspense state and Router state across concurrent SSR passes", async () => {
    const requestCount = 16;
    let entered = 0;
    let releaseAll!: () => void;
    const allEntered = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const SuspendedPage = ({
      delayedIdentity,
    }: {
      delayedIdentity: Promise<string>;
    }) =>
      createElement(
        "main",
        {},
        createElement("p", { id: "resolved-identity" }, use(delayedIdentity)),
        createElement("p", { id: "router-identity" }, Router.asPath),
      );
    const suspenseRoute = {
      ...route,
      route: "/suspense-isolation",
      regexSource: "^/suspense-isolation/?$",
      params: [],
      async load() {
        return {
          default: SuspendedPage,
          async getServerSideProps({
            query,
          }: {
            query: Record<string, unknown>;
          }) {
            const token = String(query.token);
            entered += 1;
            if (entered === requestCount) releaseAll();
            await allEntered;
            return {
              props: {
                delayedIdentity: new Promise<string>((resolve) => {
                  setTimeout(
                    () => resolve(`resolved:${token}`),
                    (requestCount - entered) % 4,
                  );
                }),
              },
            };
          },
        };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [suspenseRoute],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const tokens = Array.from(
      { length: requestCount },
      (_, index) => `render-${String(index).padStart(2, "0")}-canary`,
    );
    const bodies = await Promise.all(
      tokens.map((token) =>
        handler(
          new Request(
            `https://nextane.test/suspense-isolation?token=${token}`,
          ),
          { ASSETS: assets },
        ).then((response) => response.text()),
      ),
    );

    for (let index = 0; index < requestCount; index += 1) {
      expect(bodies[index]).toContain(`resolved:${tokens[index]}`);
      expect(bodies[index]).toContain(
        `/suspense-isolation?token=${tokens[index]}`,
      );
      for (const other of tokens) {
        if (other !== tokens[index]) expect(bodies[index]).not.toContain(other);
      }
    }
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
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );
    expect(await response.text()).toBe("hello from gssp");
  });

  it("keeps request-dependent GSSP redirects private by default", async () => {
    const redirectRoute = {
      ...route,
      route: "/private-redirect",
      regexSource: "^/private-redirect/?$",
      params: [],
      async load() {
        return {
          default: Page,
          getServerSideProps({
            query,
          }: {
            query: Record<string, unknown>;
          }) {
            return {
              redirect: {
                destination: `/account/${String(query.user)}`,
                permanent: true,
              },
            };
          },
        };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [redirectRoute],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const [first, second] = await Promise.all([
      handler(
        new Request("https://nextane.test/private-redirect?user=first"),
        { ASSETS: assets },
      ),
      handler(
        new Request("https://nextane.test/private-redirect?user=second"),
        { ASSETS: assets },
      ),
    ]);

    expect(first.status).toBe(308);
    expect(second.status).toBe(308);
    expect(first.headers.get("location")).toBe(
      "https://nextane.test/account/first",
    );
    expect(second.headers.get("location")).toBe(
      "https://nextane.test/account/second",
    );
    for (const response of [first, second]) {
      expect(response.headers.get("cache-control")).toBe(
        "private, no-cache, no-store, max-age=0, must-revalidate",
      );
    }
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

  it("inserts attacker-controlled replacement tokens literally without duplicating the document", async () => {
    const replacement = "$&|$`|$'";
    const pathToken = `PATH:${replacement}`;
    const queryToken = `QUERY:${replacement}`;
    const dataToken = `DATA:${replacement}`;
    const documentToken = `DOCUMENT:${replacement}`;
    const replacementRoute = {
      ...route,
      route: "/replacement/[slug]",
      regexSource: "^/replacement/([^/]+)/?$",
      async load() {
        return {
          default: ReplacementPage,
          getServerSideProps({
            params,
            query,
          }: {
            params: Record<string, unknown>;
            query: Record<string, unknown>;
          }) {
            return {
              props: {
                pathToken: String(params.slug),
                queryToken: String(query.queryToken),
                dataToken,
              },
            };
          },
        };
      },
    };
    const replacementManifest = manifest({
      routes: [replacementRoute],
      loadApp: null,
      loadDocument: async () => ({ default: ReplacementDocument }),
    });
    const handler = createNextaneHandler(replacementManifest);
    const url = new URL(
      `/replacement/${encodeURIComponent(pathToken)}`,
      "https://nextane.test",
    );
    url.searchParams.set("queryToken", queryToken);
    url.searchParams.set("documentToken", documentToken);

    const response = await handler(new Request(url), { ASSETS: assets });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html.length).toBeLessThan(12_000);
    expect(html.match(/<html\b/g)).toHaveLength(1);
    expect(html.match(/id="__next"/g)).toHaveLength(1);
    expect(html.match(/id="__NEXT_DATA__"/g)).toHaveLength(1);
    expect(html.match(/src="\/client\.js"/g)).toHaveLength(1);
    expect(html).toContain(pathToken);
    expect(html).toContain(queryToken);
    expect(html).toContain(dataToken);
    expect(html).toContain(documentToken);
    expect(html).toContain(`content: "${replacement}"`);

    const dataUrl = new URL(
      `/_next/data/development/replacement/${encodeURIComponent(pathToken)}.json`,
      "https://nextane.test",
    );
    dataUrl.searchParams.set("queryToken", queryToken);
    dataUrl.searchParams.set("documentToken", documentToken);
    const dataResponse = await handler(new Request(dataUrl), {
      ASSETS: assets,
    });
    const dataText = await dataResponse.text();
    expect(dataResponse.status).toBe(200);
    expect(dataText.length).toBeLessThan(4_000);
    expect(dataText).toContain(pathToken);
    expect(dataText).toContain(queryToken);
    expect(dataText).toContain(dataToken);
  });

  it.each(["html-first", "data-first"] as const)(
    "keeps request-dependent GSP artifacts private across %s cross-user requests",
    async (order) => {
      type AppContext = {
        req: {
          cookies: Record<string, string>;
          headers: { get(name: string): string | null };
          raw: Request;
        };
        res: { setHeader(name: string, value: string): void };
      };
      const PersonalizedPage = () => createElement("p", {}, "static page");
      const PersonalizedApp = ((props: Record<string, unknown>) =>
        createElement(
          "main",
          { id: "personalized-app" },
          JSON.stringify({
            cookie: props.cookie,
            authorization: props.authorization,
            host: props.host,
            language: props.language,
            userAgent: props.userAgent,
          }),
        )) as ((props: Record<string, unknown>) => unknown) & {
        getInitialProps?: (input: { ctx: AppContext }) => unknown;
      };
      PersonalizedApp.getInitialProps = ({ ctx }) => {
        const host = new URL(ctx.req.raw.url).host;
        ctx.res.setHeader("set-cookie", `visitor=${host}; Path=/; HttpOnly`);
        return {
          cookie: ctx.req.cookies.session,
          authorization: ctx.req.headers.get("authorization"),
          host,
          language: ctx.req.headers.get("accept-language"),
          userAgent: ctx.req.headers.get("user-agent"),
          pageProps: {},
        };
      };
      const personalizedRoute = {
        ...route,
        route: "/personalized",
        regexSource: "^/personalized/?$",
        params: [],
        async load() {
          return {
            default: PersonalizedPage,
            getStaticProps() {
              return { props: { static: true }, revalidate: 60 };
            },
          };
        },
      };
      const personalizedManifest = manifest({
        buildId: "matrix-build",
        routes: [personalizedRoute],
        loadApp: async () => ({ default: PersonalizedApp }),
        loadDocument: null,
      });
      let sharedCacheCalls = 0;
      const handler = createNextaneHandler(personalizedManifest, {
        async loadCachedArtifact() {
          sharedCacheCalls += 1;
          return new Response("shared cache must be bypassed", { status: 500 });
        },
      });
      const requestFor = (
        identity: "attacker" | "victim",
        kind: "html" | "data",
      ) =>
        new Request(
          kind === "html"
            ? `https://${identity}.test/personalized?seed=${identity}`
            : `https://${identity}.test/_next/data/matrix-build/personalized.json?seed=${identity}`,
          {
            headers: {
              cookie: `session=${identity}`,
              authorization: `Bearer ${identity}`,
              "accept-language": `${identity}-language`,
              "user-agent": `${identity}-agent`,
            },
          },
        );
      const firstKind = order === "html-first" ? "html" : "data";
      const secondKind = firstKind === "html" ? "data" : "html";
      const first = await handler(requestFor("attacker", firstKind), {
        ASSETS: assets,
      });
      const second = await handler(requestFor("victim", secondKind), {
        ASSETS: assets,
      });
      const firstText = await first.text();
      const secondText = await second.text();

      expect(sharedCacheCalls).toBe(0);
      expect(first.headers.get("cache-control")).toBe("private, no-store");
      expect(second.headers.get("cache-control")).toBe("private, no-store");
      expect(first.headers.get("set-cookie")).toContain("visitor=attacker.test");
      expect(second.headers.get("set-cookie")).toContain("visitor=victim.test");
      for (const value of [
        "attacker",
        "Bearer attacker",
        "attacker.test",
        "attacker-language",
        "attacker-agent",
      ]) {
        expect(firstText).toContain(value);
        expect(secondText).not.toContain(value);
      }
      for (const value of [
        "victim",
        "Bearer victim",
        "victim.test",
        "victim-language",
        "victim-agent",
      ]) {
        expect(secondText).toContain(value);
      }
    },
  );

  it("keeps request-dependent custom Document artifacts private and out of shared ISR", async () => {
    type DocumentContext = {
      req: {
        headers: { get(name: string): string | null };
      };
      res: { setHeader(name: string, value: string): void };
      renderPage(): Promise<Record<string, unknown>>;
    };
    const StaticPage = () => createElement("p", {}, "static document page");
    const PersonalizedDocument = ((props: Record<string, unknown>) =>
      createElement(
        "html",
        {},
        createElement(
          "head",
          {},
          createElement("nextane-head", {}),
        ),
        createElement(
          "body",
          {},
          createElement("p", { id: "document-identity" }, props.identity),
          createElement("nextane-main", {}),
          createElement("nextane-script", {}),
        ),
      )) as ((props: Record<string, unknown>) => unknown) & {
        getInitialProps?: (context: DocumentContext) => unknown;
      };
    PersonalizedDocument.getInitialProps = async ({
      req,
      res,
      renderPage,
    }) => {
      const identity = req.headers.get("authorization") ?? "anonymous";
      res.setHeader("set-cookie", `document-user=${identity}; Path=/; HttpOnly`);
      return { ...(await renderPage()), identity };
    };
    const staticRoute = {
      ...route,
      route: "/document-private",
      regexSource: "^/document-private/?$",
      params: [],
      async load() {
        return {
          default: StaticPage,
          getStaticProps() {
            return { props: {}, revalidate: 60 };
          },
        };
      },
    };
    const documentManifest = manifest({
      buildId: "document-build",
      routes: [staticRoute],
      loadApp: null,
      loadDocument: async () => ({ default: PersonalizedDocument }),
    });
    let sharedCacheCalls = 0;
    const handler = createNextaneHandler(documentManifest, {
      async loadCachedArtifact() {
        sharedCacheCalls += 1;
        return new Response("shared cache must be bypassed", { status: 500 });
      },
    });
    const attacker = await handler(
      new Request("https://nextane.test/document-private?user=attacker", {
        headers: { authorization: "Bearer attacker" },
      }),
      { ASSETS: assets },
    );
    const victim = await handler(
      new Request("https://nextane.test/document-private?user=victim", {
        headers: { authorization: "Bearer victim" },
      }),
      { ASSETS: assets },
    );
    const attackerHtml = await attacker.text();
    const victimHtml = await victim.text();

    expect(sharedCacheCalls).toBe(0);
    expect(attacker.headers.get("cache-control")).toBe("private, no-store");
    expect(victim.headers.get("cache-control")).toBe("private, no-store");
    expect(attacker.headers.get("set-cookie")).toContain(
      "document-user=Bearer attacker",
    );
    expect(victim.headers.get("set-cookie")).toContain(
      "document-user=Bearer victim",
    );
    expect(attackerHtml).toContain("Bearer attacker");
    expect(victimHtml).toContain("Bearer victim");
    expect(victimHtml).not.toContain("Bearer attacker");

    const isrResponse = await createIsrArtifactHandler(documentManifest)(
      new Request("https://nextane.internal/document-private"),
    );
    expect(isrResponse.status).toBe(409);
    expect(isrResponse.headers.get("cache-control")).toBe("private, no-store");
  });

  it("isolates router state across overlapping page and Document renders", async () => {
    let markFirstEntered!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const RouterPage = () => createElement("p", {}, Router.asPath);
    type RouterDocumentContext = {
      asPath: string;
      renderPage(): Promise<Record<string, unknown>>;
    };
    const RouterDocument = ((props: Record<string, unknown>) =>
      createElement(
        "html",
        {},
        createElement("head", {}, createElement("nextane-head", {})),
        createElement(
          "body",
          {},
          createElement("p", { id: "document-router" }, props.observedAsPath),
          createElement("nextane-main", {}),
          createElement("nextane-script", {}),
        ),
      )) as ((props: Record<string, unknown>) => unknown) & {
        getInitialProps?: (context: RouterDocumentContext) => unknown;
      };
    RouterDocument.getInitialProps = async ({ asPath, renderPage }) => {
      const rendered = await renderPage();
      if (asPath.startsWith("/overlap/first")) {
        markFirstEntered();
        await firstGate;
      } else {
        releaseFirst();
        await Promise.resolve();
      }
      return { ...rendered, observedAsPath: Router.asPath };
    };
    const overlapRoute = {
      ...route,
      route: "/overlap/[slug]",
      regexSource: "^/overlap/([^/]+)/?$",
      async load() {
        return { default: RouterPage };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [overlapRoute],
        loadApp: null,
        loadDocument: async () => ({ default: RouterDocument }),
      }),
    );
    const firstResponse = handler(
      new Request("https://nextane.test/overlap/first?request=first"),
      { ASSETS: assets },
    );
    await firstEntered;
    const secondResponse = handler(
      new Request("https://nextane.test/overlap/second?request=second"),
      { ASSETS: assets },
    );
    const [firstHtml, secondHtml] = await Promise.all([
      firstResponse.then((response) => response.text()),
      secondResponse.then((response) => response.text()),
    ]);

    expect(firstHtml).toContain("/overlap/first?request=first");
    expect(firstHtml).not.toContain("/overlap/second?request=second");
    expect(secondHtml).toContain("/overlap/second?request=second");
    expect(secondHtml).not.toContain("/overlap/first?request=first");
  });

  it("canonicalizes shared GSP artifact generation and strips request variance", async () => {
    let staticRenderCalls = 0;
    const StaticPage = ({ slug }: { slug: string }) =>
      createElement("p", { id: "static-slug" }, slug);
    const staticRoute = {
      ...route,
      route: "/static/[slug]",
      regexSource: "^/static/([^/]+)/?$",
      async load() {
        return {
          default: StaticPage,
          getStaticProps({
            params,
          }: {
            params: Record<string, string>;
          }) {
            staticRenderCalls += 1;
            return { props: { slug: params.slug }, revalidate: 60 };
          },
        };
      },
    };
    const staticManifest = manifest({
      buildId: "canonical-build",
      routes: [staticRoute],
      loadApp: null,
      loadDocument: null,
    });
    const artifactHandler = createIsrArtifactHandler(staticManifest);
    const artifactRequests: Array<{
      url: string;
      headers: Array<[string, string]>;
    }> = [];
    let cachedArtifact: Promise<Response> | undefined;
    const handler = createNextaneHandler(staticManifest, {
      async loadCachedArtifact(request) {
        artifactRequests.push({
          url: request.url,
          headers: [...request.headers],
        });
        cachedArtifact ??= artifactHandler(request);
        return (await cachedArtifact).clone();
      },
    });
    const [attacker, victim] = await Promise.all([
      handler(
        new Request(
          "https://attacker.test/static/value?secret=QUERY_SECRET",
          {
            headers: {
              authorization: "Bearer HEADER_SECRET",
              cookie: "session=COOKIE_SECRET",
              "accept-language": "LANGUAGE_SECRET",
              "user-agent": "AGENT_SECRET",
              "x-nextane-only-cached": "1",
            },
          },
        ),
        { ASSETS: assets },
      ),
      handler(
        new Request(
          "https://victim.test/static/value?secret=VICTIM_QUERY",
          {
            headers: {
              authorization: "Bearer VICTIM_HEADER",
              cookie: "session=VICTIM_COOKIE",
              "accept-language": "VICTIM_LANGUAGE",
              "user-agent": "VICTIM_AGENT",
            },
          },
        ),
        { ASSETS: assets },
      ),
    ]);
    const attackerHtml = await attacker.text();
    const victimHtml = await victim.text();

    expect(attacker.status).toBe(200);
    expect(victim.status).toBe(200);
    expect(attacker.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(victim.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(artifactRequests).toEqual([
      {
        url: "https://nextane.internal/static/value",
        headers: [],
      },
      {
        url: "https://nextane.internal/static/value",
        headers: [],
      },
    ]);
    expect(staticRenderCalls).toBe(1);
    for (const secret of [
      "attacker.test",
      "QUERY_SECRET",
      "HEADER_SECRET",
      "COOKIE_SECRET",
      "LANGUAGE_SECRET",
      "AGENT_SECRET",
      "victim.test",
      "VICTIM_QUERY",
      "VICTIM_HEADER",
      "VICTIM_COOKIE",
      "VICTIM_LANGUAGE",
      "VICTIM_AGENT",
    ]) {
      expect(attackerHtml).not.toContain(secret);
      expect(victimHtml).not.toContain(secret);
    }
    expect(victimHtml).toBe(attackerHtml);
    expect(attackerHtml).toContain('"resolvedPath":"/static/value"');
    expect(attackerHtml).toContain('"buildId":"canonical-build"');
  });

  it("fails closed if a shared cache returns an artifact for another path", async () => {
    const StaticTenantPage = ({ tenant }: { tenant: string }) =>
      createElement("p", { id: "tenant" }, tenant);
    const tenantRoute = {
      ...route,
      route: "/tenant/[tenant]",
      regexSource: "^/tenant/([^/]+)/?$",
      params: [{ name: "tenant", kind: "single" as const }],
      async load() {
        return {
          default: StaticTenantPage,
          getStaticProps({
            params,
          }: {
            params: Record<string, string>;
          }) {
            return {
              props: { tenant: `${params.tenant}-private-artifact` },
              revalidate: 60,
            };
          },
        };
      },
    };
    const tenantManifest = manifest({
      buildId: "tenant-build",
      routes: [tenantRoute],
      loadApp: null,
      loadDocument: null,
    });
    const artifactHandler = createIsrArtifactHandler(tenantManifest);
    const attackerArtifact = await artifactHandler(
      new Request("https://nextane.internal/tenant/attacker"),
    );
    const attackerBody = await attackerArtifact.text();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const handler = createNextaneHandler(tenantManifest, {
        async loadCachedArtifact() {
          return new Response(attackerBody, {
            status: attackerArtifact.status,
            headers: attackerArtifact.headers,
          });
        },
      });
      const victim = await handler(
        new Request("https://nextane.test/tenant/victim"),
        { ASSETS: assets },
      );
      const victimHtml = await victim.text();

      expect(victim.status).toBe(500);
      expect(victim.headers.get("cache-control")).toBe("private, no-store");
      expect(victimHtml).not.toContain("attacker-private-artifact");
      expect(error).toHaveBeenCalledWith(
        "[nextane] request failed",
        expect.objectContaining({
          message: "Shared ISR cache returned a mismatched artifact",
        }),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("rejects tampered shared artifacts instead of serving potentially cross-user data", async () => {
    const StaticTenantPage = ({ tenant }: { tenant: string }) =>
      createElement("p", { id: "tenant" }, tenant);
    const tenantRoute = {
      ...route,
      route: "/validated/[tenant]",
      regexSource: "^/validated/([^/]+)/?$",
      params: [{ name: "tenant", kind: "single" as const }],
      async load() {
        return {
          default: StaticTenantPage,
          getStaticProps({
            params,
          }: {
            params: Record<string, string>;
          }) {
            return {
              props: { tenant: params.tenant },
              revalidate: 60,
            };
          },
        };
      },
    };
    const tenantManifest = manifest({
      buildId: "validated-build",
      routes: [tenantRoute],
      loadApp: null,
      loadDocument: null,
    });
    const canonicalResponse = await createIsrArtifactHandler(tenantManifest)(
      new Request("https://nextane.internal/validated/victim"),
    );
    const canonicalArtifact = (await canonicalResponse.json()) as Record<
      string,
      any
    >;
    const mutations: Array<
      [string, (artifact: Record<string, any>) => void]
    > = [
      ["build ID", (artifact) => { artifact.buildId = "attacker-build"; }],
      ["route", (artifact) => { artifact.route = "/validated/[other]"; }],
      [
        "resolved path",
        (artifact) => { artifact.resolvedPath = "/validated/attacker"; },
      ],
      [
        "query variance",
        (artifact) => { artifact.query = { tenant: "victim", user: "attacker" }; },
      ],
      ["GSP marker", (artifact) => { artifact.gsp = false; }],
      ["GSSP marker", (artifact) => { artifact.gssp = true; }],
      ["cacheable marker", (artifact) => { artifact.cacheable = false; }],
      ["fallback marker", (artifact) => { artifact.isFallback = true; }],
      [
        "App props",
        (artifact) => { artifact.appProps = { user: "attacker" }; },
      ],
      [
        "response cookie",
        (artifact) => {
          artifact.response.headers = [
            ["set-cookie", "session=attacker; Path=/; HttpOnly"],
          ];
        },
      ],
      ["response status", (artifact) => { artifact.response.status = 201; }],
      ["generation timestamp", (artifact) => { artifact.generatedAt = null; }],
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [name, mutate] of mutations) {
        const tampered = structuredClone(canonicalArtifact);
        mutate(tampered);
        const handler = createNextaneHandler(tenantManifest, {
          async loadCachedArtifact() {
            return Response.json(tampered);
          },
        });
        const response = await handler(
          new Request("https://nextane.test/validated/victim"),
          { ASSETS: assets },
        );
        const html = await response.text();

        expect(response.status, name).toBe(500);
        expect(response.headers.get("cache-control"), name).toBe(
          "private, no-store",
        );
        expect(html, name).not.toContain("attacker");
      }
      expect(error).toHaveBeenCalledTimes(mutations.length);
    } finally {
      error.mockRestore();
    }
  });

  it("rejects ambiguous rewrite patterns before processing attacker paths", () => {
    const started = performance.now();
    expect(() =>
      createNextaneHandler(
        manifest({
          config: {
            rewrites: [
              {
                source: "/:a*/:b*/:c*/:d*/fixed",
                destination: "/items/rewritten",
              },
            ],
          },
        }),
      ),
    ).toThrow(/Unsupported ambiguous rewrite source/);
    expect(() =>
      createNextaneHandler(
        manifest({
          config: {
            rewrites: [
              {
                source: "/:a?:b?:c?:d?/fixed",
                destination: "/items/rewritten",
              },
            ],
          },
        }),
      ),
    ).toThrow(/parameters must be separated by literal text/);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("matches a supported rewrite in bounded time on a long hostile path", async () => {
    const handler = createNextaneHandler(
      manifest({
        config: {
          rewrites: [
            {
              source: "/safe/:path*/fixed",
              destination: "/items/rewritten",
            },
          ],
        },
      }),
    );
    const started = performance.now();
    const response = await handler(
      new Request(
        `https://nextane.test/safe/${"segment/".repeat(1_000)}missing`,
      ),
      { ASSETS: assets },
    );

    expect(response.status).toBe(404);
    expect(performance.now() - started).toBeLessThan(750);
  });

  it("requires the exact data build ID and GET or HEAD", async () => {
    const handler = createNextaneHandler(manifest({ buildId: "secure-build" }));
    const valid = await handler(
      new Request(
        "https://nextane.test/_next/data/secure-build/items/octane.json",
      ),
      { ASSETS: assets },
    );
    const head = await handler(
      new Request(
        "https://nextane.test/_next/data/secure-build/items/octane.json",
        { method: "HEAD" },
      ),
      { ASSETS: assets },
    );
    const wrongBuild = await handler(
      new Request(
        "https://nextane.test/_next/data/other-build/items/octane.json",
      ),
      { ASSETS: assets },
    );

    expect(valid.status).toBe(200);
    expect(head.status).toBe(200);
    expect(wrongBuild.status).toBe(404);
    expect(await wrongBuild.json()).toEqual({ notFound: true });
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await handler(
        new Request(
          "https://nextane.test/_next/data/secure-build/items/octane.json",
          { method },
        ),
        { ASSETS: assets },
      );
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow"), method).toBe("GET, HEAD");
    }
  });

  it("tolerates malformed cookies, strips reserved ingress headers, and adds safe defaults", async () => {
    const headerRoute = {
      ...route,
      route: "/headers",
      regexSource: "^/headers/?$",
      params: [],
      async load() {
        return {
          default: Page,
          getServerSideProps({
            req,
          }: {
            req: {
              cookies: Record<string, string>;
              headers: { get(name: string): string | null };
            };
          }) {
            return {
              props: {
                query: {
                  malformedCookie: req.cookies.bad,
                  reservedHeader: req.headers.get("x-nextane-only-cached"),
                },
              },
            };
          },
        };
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [headerRoute],
        loadApp: null,
        loadDocument: null,
      }),
    );
    const response = await handler(
      new Request("https://nextane.test/headers", {
        headers: {
          cookie: "bad=%; good=octane%20powered",
          "x-nextane-only-cached": "1",
        },
      }),
      { ASSETS: assets },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('"malformedCookie":"%"');
    expect(html).toContain('"reservedHeader":null');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("HTML-escapes the development fallback error body", async () => {
    const malicious = "</pre><script>globalThis.pwned=true</script>";
    const failingRoute = {
      ...route,
      route: "/failure",
      regexSource: "^/failure/?$",
      params: [],
      async load() {
        throw new Error(malicious);
      },
    };
    const handler = createNextaneHandler(
      manifest({
        routes: [failingRoute],
        loadApp: null,
        loadDocument: null,
        loadError: null,
      }),
    );
    const response = await handler(
      new Request("https://nextane.test/failure"),
      {
        ASSETS: {
          async fetch() {
            throw new Error("error template unavailable");
          },
        },
      },
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).not.toContain(malicious);
    expect(html).not.toContain("<script>globalThis.pwned");
    expect(html).toContain("&lt;/pre&gt;&lt;script&gt;");
  });
});
