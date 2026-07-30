import { prerender } from "octane/static";
import type { ComponentBody } from "octane";
import {
  DefaultNotFound,
  DefaultServerError,
} from "../runtime/default-error";
import { setRouterState } from "../runtime/router";
import { matchRoute } from "../routing/match";
import type { ClientRoute } from "../routing/types";
import type {
  GetStaticPathsResult,
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  GetStaticPropsResult,
  NextaneData,
  ParsedUrlQuery,
  Redirect,
} from "../types";
import { runApiRoute } from "./api";
import {
  createPageRequest,
  PageResponse,
  type ResponseSnapshot,
} from "./http";

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

export interface NextaneEnvironment {
  ASSETS: AssetBinding;
}

export interface NextaneManifest {
  routes: ServerRouteManifest[];
  loadApp: null | (() => Promise<Record<string, unknown>>);
  loadDocument: null | (() => Promise<Record<string, unknown>>);
  loadError: null | (() => Promise<Record<string, unknown>>);
  config?: {
    rewrites?: Array<{ source: string; destination: string }>;
    crossOrigin?: string;
    trailingSlash?: boolean;
  };
}

interface ServerRouteManifest extends ClientRoute {
  id: number;
  kind: "page" | "api";
  load(): Promise<Record<string, unknown>>;
}

interface PageResolution {
  pageProps: Record<string, unknown>;
  gsp: boolean;
  gssp: boolean;
  revalidate?: number | boolean;
  notFound?: boolean;
  redirect?: Redirect;
  response: ResponseSnapshot;
}

export interface RenderArtifact {
  route: string;
  pageProps: Record<string, unknown>;
  appProps?: Record<string, unknown>;
  query: ParsedUrlQuery;
  gsp: boolean;
  gssp: boolean;
  isFallback?: boolean;
  resolvedPath?: string;
  revalidate?: number | boolean;
  notFound?: boolean;
  redirect?: Redirect;
  response?: ResponseSnapshot;
  html?: string;
  css?: string;
  head?: string;
  documentHtml?: string;
  documentHead?: string;
  documentCss?: string;
  crossOrigin?: string;
  trailingSlash?: boolean;
  generatedAt: number;
}

interface HandlerOptions {
  loadCachedArtifact?: (
    request: Request,
    route: ServerRouteManifest,
  ) => Promise<Response>;
  revalidatePath?: (
    pathname: string,
    options?: { unstable_onlyGenerated?: boolean },
  ) => Promise<boolean> | boolean;
}

const BUILD_ID = "development";
const staticPathsCache = new WeakMap<
  Function,
  Promise<GetStaticPathsResult>
>();

export function cacheTagForPath(pathname: string): string {
  return `nextane:path:${encodeURIComponent(pathname).slice(0, 900)}`;
}

function searchQuery(url: URL, params: ParsedUrlQuery): ParsedUrlQuery {
  const query: ParsedUrlQuery = {};
  for (const [key, value] of url.searchParams) {
    const previous = query[key];
    if (previous === undefined) query[key] = value;
    else if (Array.isArray(previous)) query[key] = [...previous, value];
    else query[key] = [previous, value];
  }
  return { ...query, ...params };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchRewrite(
  source: string,
  pathname: string,
): Record<string, string> | null {
  const names: string[] = [];
  let pattern = "^";
  let cursor = 0;
  for (const match of source.matchAll(/:([A-Za-z0-9_]+)([+*?])?/g)) {
    pattern += escapeRegex(source.slice(cursor, match.index));
    names.push(match[1]);
    if (match[2] === "+") pattern += "(.+)";
    else if (match[2] === "*") pattern += "(.*)";
    else if (match[2] === "?") pattern += "([^/]*)";
    else pattern += "([^/]+)";
    cursor = (match.index ?? 0) + match[0].length;
  }
  pattern += `${escapeRegex(source.slice(cursor))}/?$`;
  const matched = new RegExp(pattern).exec(pathname);
  if (!matched) return null;
  return Object.fromEntries(
    names.map((name, index) => [name, decodeURIComponent(matched[index + 1])]),
  );
}

function resolveRewrite(
  manifest: NextaneManifest,
  requestUrl: URL,
): { pageUrl: URL; displayUrl: URL; resolvedUrl: URL } {
  for (const rewrite of manifest.config?.rewrites ?? []) {
    const values = matchRewrite(rewrite.source, requestUrl.pathname);
    if (!values) continue;
    const consumedParameters = new Set(
      [...rewrite.destination.matchAll(/:([A-Za-z0-9_]+)/g)].map(
        (match) => match[1],
      ),
    );
    const destination = rewrite.destination.replace(
      /:([A-Za-z0-9_]+)/g,
      (_match, name: string) => encodeURIComponent(values[name] ?? ""),
    );
    const pageUrl = new URL(destination, requestUrl);
    for (const [name, value] of Object.entries(values)) {
      if (
        !consumedParameters.has(name) &&
        !pageUrl.searchParams.has(name)
      ) {
        pageUrl.searchParams.set(name, value);
      }
    }
    for (const [name, value] of requestUrl.searchParams) {
      pageUrl.searchParams.append(name, value);
    }
    const resolvedUrl = new URL(pageUrl.pathname, requestUrl);
    resolvedUrl.search = requestUrl.search;
    return {
      pageUrl,
      displayUrl: requestUrl,
      resolvedUrl,
    };
  }
  return {
    pageUrl: requestUrl,
    displayUrl: requestUrl,
    resolvedUrl: requestUrl,
  };
}

function canonicalPathname(
  pathname: string,
  trailingSlash: boolean,
): string {
  if (pathname === "/") return pathname;
  const fileLike = /\/[^/]+\.[^/]+\/?$/.test(pathname);
  if (trailingSlash && !fileLike) {
    return pathname.endsWith("/") ? pathname : `${pathname}/`;
  }
  return pathname.replace(/\/+$/, "");
}

function paramsEqual(
  expected: ParsedUrlQuery,
  actual: ParsedUrlQuery,
): boolean {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    const left = expected[key];
    const right = actual[key];
    if (
      (left === undefined && Array.isArray(right) && right.length === 0) ||
      (right === undefined && Array.isArray(left) && left.length === 0)
    ) {
      continue;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      if (left.some((value, index) => value !== right[index])) return false;
    } else if (left !== right) {
      return false;
    }
  }
  return true;
}

async function staticPathInfo(
  pageModule: Record<string, unknown>,
  params: ParsedUrlQuery,
  pageUrl: URL,
): Promise<{
  matched: boolean;
  fallback: boolean | "blocking";
}> {
  const getStaticPaths = pageModule.getStaticPaths;
  if (typeof getStaticPaths !== "function") {
    return { matched: true, fallback: false };
  }

  let resultPromise = staticPathsCache.get(getStaticPaths);
  if (!resultPromise) {
    resultPromise = Promise.resolve(getStaticPaths({})) as Promise<GetStaticPathsResult>;
    staticPathsCache.set(getStaticPaths, resultPromise);
  }
  const result = await resultPromise;
  const matched = result.paths.some((candidate) => {
    if (typeof candidate === "string") {
      const candidateUrl = new URL(candidate, pageUrl);
      return candidateUrl.pathname === pageUrl.pathname;
    }
    return paramsEqual(candidate.params, params);
  });
  return { matched, fallback: result.fallback };
}

async function resolvePageData(
  pageModule: Record<string, unknown>,
  request: Request,
  params: ParsedUrlQuery,
  pageUrl: URL,
  resolvedUrl: URL,
  displayUrl: URL,
  response: PageResponse,
  skipPageInitialProps: boolean,
): Promise<PageResolution> {
  const query = searchQuery(pageUrl, params);
  const req = createPageRequest(request);

  if (typeof pageModule.getServerSideProps === "function") {
    const context: GetServerSidePropsContext = {
      req,
      res: response,
      params: Object.keys(params).length > 0 ? params : undefined,
      query,
      resolvedUrl: `${resolvedUrl.pathname}${resolvedUrl.search}`,
      preview: false,
      draftMode: false,
    };
    const result = (await pageModule.getServerSideProps(
      context,
    )) as GetServerSidePropsResult<Record<string, unknown>>;
    const snapshot = response.snapshot();
    if ("redirect" in result) {
      return {
        pageProps: {},
        gsp: false,
        gssp: true,
        redirect: result.redirect,
        response: snapshot,
      };
    }
    if ("notFound" in result && result.notFound === true) {
      return {
        pageProps: {},
        gsp: false,
        gssp: true,
        notFound: true,
        response: snapshot,
      };
    }
    return {
      pageProps: await result.props,
      gsp: false,
      gssp: true,
      response: response.snapshot(),
    };
  }

  if (typeof pageModule.getStaticProps === "function") {
    const staticPath = await staticPathInfo(pageModule, params, pageUrl);
    if (!staticPath.matched && staticPath.fallback === false) {
      return {
        pageProps: {},
        gsp: true,
        gssp: false,
        notFound: true,
        response: response.snapshot(),
      };
    }
    const result = (await pageModule.getStaticProps({
      params:
        typeof pageModule.getStaticPaths === "function" ||
        Object.keys(params).length > 0
          ? params
          : undefined,
      revalidateReason: "build",
    })) as GetStaticPropsResult<Record<string, unknown>>;
    if ("redirect" in result) {
      return {
        pageProps: {},
        gsp: true,
        gssp: false,
        redirect: result.redirect,
        revalidate: result.revalidate,
        response: response.snapshot(),
      };
    }
    if ("notFound" in result && result.notFound === true) {
      return {
        pageProps: {},
        gsp: true,
        gssp: false,
        notFound: true,
        revalidate: result.revalidate,
        response: response.snapshot(),
      };
    }
    return {
      pageProps: await result.props,
      gsp: true,
      gssp: false,
      revalidate: result.revalidate,
      response: response.snapshot(),
    };
  }

  const component = pageModule.default as
    | (ComponentBody<Record<string, unknown>> & {
        getInitialProps?: (context: Record<string, unknown>) => unknown;
      })
    | undefined;
  if (!skipPageInitialProps && typeof component?.getInitialProps === "function") {
    const pageProps = await component.getInitialProps({
      pathname: pageUrl.pathname,
      query,
      asPath: `${displayUrl.pathname}${displayUrl.search}`,
      req,
      res: response,
    });
    return {
      pageProps: (pageProps ?? {}) as Record<string, unknown>,
      gsp: false,
      gssp: false,
      response: response.snapshot(),
    };
  }

  return {
    pageProps: {},
    gsp: false,
    gssp: false,
    response: response.snapshot(),
  };
}

function redirectStatus(redirect: Redirect): number {
  if (redirect.statusCode) return redirect.statusCode;
  return redirect.permanent ? 308 : 307;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function getTemplate(request: Request, env: NextaneEnvironment): Promise<string> {
  const templateResponse = await env.ASSETS.fetch(
    new Request(new URL("/", request.url), {
      method: "GET",
      headers: request.headers,
    }),
  );
  if (!templateResponse.ok) {
    throw new Error(`Unable to load the Nextane HTML template (${templateResponse.status})`);
  }
  return templateResponse.text();
}

function attributeValue(source: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i").exec(
    source,
  );
  return match?.[1] ?? match?.[2];
}

function stampResourceAttributes(
  html: string,
  attributes: { nonce?: string; crossOrigin?: string },
): string {
  return html.replace(/<(script|link)\b([^>]*)>/gi, (tag, name, rest) => {
    if (
      name.toLowerCase() === "link" &&
      !/\brel=["'][^"']*preload/i.test(rest)
    ) {
      return tag;
    }
    let next = rest;
    if (attributes.nonce && !/\bnonce=/i.test(next)) {
      next += ` nonce="${attributes.nonce}"`;
    }
    if (attributes.crossOrigin) {
      if (/\bcrossorigin(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/i.test(next)) {
        next = next.replace(
          /\s+crossorigin(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/i,
          ` crossorigin="${attributes.crossOrigin}"`,
        );
      } else {
        next += ` crossorigin="${attributes.crossOrigin}"`;
      }
    }
    return `<${name}${next}>`;
  });
}

function stampManagedHead(html: string): string {
  return html
    .replace(/^<!--\[--><!--\]-->/, "")
    .replace(
      /<(base|meta|title|link|style|script)\b([^>]*)>/gi,
      (tag, name: string, attributes: string) =>
        /\bdata-next-head(?:=|\s|$)/i.test(attributes)
          ? tag
          : `<${name}${attributes} data-next-head="">`,
    );
}

function renderDocumentShell(
  shell: string,
  template: string,
  artifact: RenderArtifact,
  dataScript: string,
): string {
  const templateHead =
    /<head[^>]*>([\s\S]*?)<\/head>/i.exec(template)?.[1] ?? "";
  const hydratedHead = templateHead
    .replace("<!--nextane-head-->", stampManagedHead(artifact.head ?? ""))
    .replace("<!--nextane-styles-->", artifact.css ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const templateScripts = [...template.matchAll(/<script\b[\s\S]*?<\/script>/gi)]
    .map((match) => match[0])
    .filter((script) => /\bsrc=/.test(script))
    .join("");

  let html = shell;
  html = html.replace(
    /<nextane-head\b([^>]*)><\/nextane-head>/i,
    (_match, attributes: string) => {
      return stampResourceAttributes(
        `${artifact.documentHead ?? ""}${artifact.documentCss ?? ""}${hydratedHead}`,
        {
          nonce: attributeValue(attributes, "nonce"),
          crossOrigin:
            attributeValue(attributes, "crossorigin") ??
            attributeValue(attributes, "crossOrigin") ??
            artifact.crossOrigin,
        },
      );
    },
  );
  html = html.replace(
    /<nextane-main\b[^>]*><\/nextane-main>/i,
    `<div id="__next">${artifact.html ?? ""}</div>`,
  );
  html = html.replace(
    /<nextane-script\b([^>]*)><\/nextane-script>/i,
    (_match, attributes: string) => {
      return stampResourceAttributes(`${dataScript}${templateScripts}`, {
        nonce: attributeValue(attributes, "nonce"),
        crossOrigin:
          attributeValue(attributes, "crossorigin") ??
          attributeValue(attributes, "crossOrigin") ??
          artifact.crossOrigin,
      });
    },
  );
  return `<!doctype html>${html}`;
}

async function createRenderArtifact(
  manifest: NextaneManifest,
  route: ServerRouteManifest,
  request: Request,
  params: ParsedUrlQuery,
  pageUrl = new URL(request.url),
  forcedPageProps?: Record<string, unknown>,
  shouldRender = true,
  displayUrl = pageUrl,
  resolvedUrl = pageUrl,
  fallbackShell = false,
): Promise<RenderArtifact> {
  const pageModule = await route.load();
  const Page = pageModule.default as ComponentBody<Record<string, unknown>> | undefined;
  if (typeof Page !== "function") {
    throw new Error(`Page ${route.route} does not export a default Octane component`);
  }

  const appModule = manifest.loadApp ? await manifest.loadApp() : null;
  const App = appModule?.default as
    | (ComponentBody<Record<string, unknown>> & {
        getInitialProps?: (context: Record<string, unknown>) => unknown;
      })
    | undefined;
  const response = new PageResponse();
  const resolution = forcedPageProps
    ? {
        pageProps: forcedPageProps,
        gsp: false,
        gssp: false,
        response: response.snapshot(),
      }
    : fallbackShell
      ? {
          pageProps: {},
          gsp: true,
          gssp: false,
          response: response.snapshot(),
        }
    : await resolvePageData(
        pageModule,
        request,
        params,
        pageUrl,
        resolvedUrl,
        displayUrl,
        response,
        typeof App?.getInitialProps === "function",
      );
  const query = resolution.gsp ? { ...params } : searchQuery(pageUrl, params);
  const req = createPageRequest(request);
  let appProps: Record<string, unknown> = {};

  if (!forcedPageProps && typeof App?.getInitialProps === "function") {
    const initial = await App.getInitialProps({
      Component: Page,
      router: {
        route: route.route,
        pathname: route.route,
        query,
        asPath: `${displayUrl.pathname}${displayUrl.search}`,
      },
      ctx: {
        req,
        res: response,
        pathname: route.route,
        query,
        asPath: `${displayUrl.pathname}${displayUrl.search}`,
      },
    });
    if (initial && typeof initial === "object") {
      appProps = { ...(initial as Record<string, unknown>) };
    }
    if (!resolution.gsp && !resolution.gssp && "pageProps" in appProps) {
      resolution.pageProps =
        (appProps.pageProps as Record<string, unknown> | undefined) ?? {};
    }
    delete appProps.pageProps;
    resolution.response = response.snapshot();
  }

  if (resolution.gsp && !fallbackShell) {
    warnForLargePageData(route, displayUrl, resolution.pageProps);
  }

  const baseArtifact = {
    route: route.route,
    pageProps: resolution.pageProps,
    ...(Object.keys(appProps).length > 0 ? { appProps } : {}),
    query,
    gsp: resolution.gsp,
    gssp: resolution.gssp,
    isFallback: fallbackShell,
    resolvedPath: `${pageUrl.pathname}${pageUrl.search}`,
    revalidate: resolution.revalidate,
    notFound: resolution.notFound,
    redirect: resolution.redirect,
    response: resolution.response,
    crossOrigin: manifest.config?.crossOrigin,
    trailingSlash: manifest.config?.trailingSlash,
    generatedAt: Date.now(),
  };
  if (
    resolution.redirect ||
    resolution.notFound ||
    resolution.response.ended ||
    !shouldRender
  ) {
    return baseArtifact;
  }

  const router = {
    route: route.route,
    pathname: route.route,
    query,
    asPath: `${displayUrl.pathname}${displayUrl.search}`,
    basePath: "",
    isReady: true,
    isPreview: false,
    isFallback: fallbackShell,
    trailingSlash: manifest.config?.trailingSlash,
  };
  setRouterState(router);

  type RenderEnhancements =
    | ((component: ComponentBody<Record<string, unknown>>) => ComponentBody<Record<string, unknown>>)
    | {
        enhanceComponent?: (
          component: ComponentBody<Record<string, unknown>>,
        ) => ComponentBody<Record<string, unknown>>;
        enhanceApp?: (
          component: ComponentBody<Record<string, unknown>>,
        ) => ComponentBody<Record<string, unknown>>;
      };

  const renderPage = async (enhancements?: RenderEnhancements) => {
    const options =
      typeof enhancements === "function"
        ? { enhanceComponent: enhancements }
        : enhancements ?? {};
    const RenderPage = options.enhanceComponent
      ? options.enhanceComponent(Page)
      : Page;
    const RenderApp =
      App && options.enhanceApp ? options.enhanceApp(App) : App;

    return RenderApp
      ? prerender(
          RenderApp as never,
          {
            ...appProps,
            Component: RenderPage,
            pageProps: resolution.pageProps,
            router,
          },
          { headChannel: "separate", signal: request.signal },
        )
      : prerender(RenderPage as never, resolution.pageProps, {
          headChannel: "separate",
          signal: request.signal,
        });
  };

  let renderResult = await renderPage();
  let documentHtml: string | undefined;
  let documentHead: string | undefined;
  let documentCss: string | undefined;
  if (manifest.loadDocument) {
    const documentModule = await manifest.loadDocument();
    const Document = documentModule.default as
      | (ComponentBody<Record<string, unknown>> & {
          getInitialProps?: (context: Record<string, unknown>) => unknown;
        })
      | undefined;
    if (typeof Document !== "function") {
      throw new Error("pages/_document must export a default Octane component");
    }

    let documentProps: Record<string, unknown> = {};
    if (typeof Document.getInitialProps === "function") {
      const initial = await Document.getInitialProps({
        req,
        res: response,
        pathname: route.route,
        query,
        asPath: `${displayUrl.pathname}${displayUrl.search}`,
        async renderPage(enhancements?: RenderEnhancements) {
          renderResult = await renderPage(enhancements);
          return {
            html: renderResult.html,
            head: renderResult.head,
            styles: renderResult.css,
          };
        },
      });
      if (initial && typeof initial === "object") {
        documentProps = initial as Record<string, unknown>;
      }
    }

    const documentRender = await prerender(
      Document as never,
      {
        ...documentProps,
        html: renderResult.html,
        head: renderResult.head,
        styles: renderResult.css,
        __NEXT_DATA__: {
          props: {
            ...appProps,
            pageProps: resolution.pageProps,
          },
          page: route.route,
          query,
          buildId: BUILD_ID,
          isFallback: fallbackShell,
        },
      },
      { signal: request.signal },
    );
    documentHtml = documentRender.html;
    documentHead = documentRender.head;
    documentCss = documentRender.css;
  }

  return {
    ...baseArtifact,
    response: response.snapshot(),
    html: renderResult.html,
    css: renderResult.css,
    head: renderResult.head,
    documentHtml,
    documentHead,
    documentCss,
  };
}

function warnForLargePageData(
  route: ServerRouteManifest,
  displayUrl: URL,
  pageProps: Record<string, unknown>,
) {
  const size = new TextEncoder().encode(JSON.stringify(pageProps)).byteLength;
  if (size <= 128_000) return;
  const path =
    route.route === displayUrl.pathname
      ? ""
      : ` (path "${displayUrl.pathname}")`;
  console.warn(
    `Warning: data for page "${route.route}"${path} is ${Math.round(
      size / 1000,
    )} kB which exceeds the threshold of 128 kB, this amount of data can reduce performance`,
  );
}

function artifactData(artifact: RenderArtifact) {
  if (artifact.redirect) {
    return {
      __N_REDIRECT: artifact.redirect.destination,
      __N_REDIRECT_STATUS: redirectStatus(artifact.redirect),
    };
  }
  if (artifact.notFound) return { notFound: true };
  return {
    ...(artifact.appProps ?? {}),
    pageProps: artifact.pageProps,
    ...(artifact.gsp ? { __N_SSG: true } : {}),
    ...(artifact.gssp ? { __N_SSP: true } : {}),
  };
}

async function renderArtifactResponse(
  artifact: RenderArtifact,
  request: Request,
  env: NextaneEnvironment,
  status = 200,
  cacheStatus?: string | null,
): Promise<Response> {
  if (artifact.response?.ended) {
    return new Response(artifact.response.body ?? null, {
      status: artifact.response.status,
      statusText: artifact.response.statusMessage,
      headers: artifact.response.headers,
    });
  }
  if (artifact.redirect) {
    return Response.redirect(
      new URL(artifact.redirect.destination, request.url),
      redirectStatus(artifact.redirect),
    );
  }
  if (artifact.notFound) return new Response("Not Found", { status: 404 });

  const nextData: NextaneData = {
    props: {
      ...(artifact.appProps ?? {}),
      pageProps: artifact.pageProps,
    },
    page: artifact.route,
    query: artifact.query,
    buildId: BUILD_ID,
    isFallback: artifact.isFallback === true,
    resolvedPath: artifact.resolvedPath,
    ...(artifact.gsp ? { gsp: true } : {}),
    ...(artifact.gssp ? { gssp: true } : {}),
    trailingSlash: artifact.trailingSlash,
  };

  const dataScript = `<script id="__NEXT_DATA__" type="application/json">${safeJson(nextData)}</script>`;
  const template = await getTemplate(request, env);
  const html = artifact.documentHtml
    ? renderDocumentShell(
        artifact.documentHtml,
        template,
        artifact,
        dataScript,
      )
    : template
        .replace("<!--nextane-head-->", stampManagedHead(artifact.head ?? ""))
        .replace("<!--nextane-styles-->", artifact.css ?? "")
        .replace('<div id="__next"></div>', `<div id="__next">${artifact.html ?? ""}</div>`)
        .replace("<!--nextane-data-->", dataScript);

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "x-powered-by": "Nextane",
    "cache-control": artifact.gssp
      ? "private, no-cache, no-store, max-age=0, must-revalidate"
      : artifact.gsp
        ? "public, max-age=0, must-revalidate"
        : "private, no-store",
    "x-nextane-generated-at": String(artifact.generatedAt),
  });
  for (const [name, value] of artifact.response?.headers ?? []) {
    if (name.toLowerCase() === "set-cookie") headers.append(name, value);
    else headers.set(name, value);
  }
  if (typeof artifact.revalidate === "number") {
    headers.set("x-nextane-revalidate", String(artifact.revalidate));
  }
  if (cacheStatus) headers.set("x-nextane-cache-status", cacheStatus);
  return new Response(html, { status, headers });
}

async function renderRoute(
  manifest: NextaneManifest,
  route: ServerRouteManifest,
  request: Request,
  params: ParsedUrlQuery,
  env: NextaneEnvironment,
  status = 200,
  forcedPageProps?: Record<string, unknown>,
): Promise<Response> {
  const artifact = await createRenderArtifact(
    manifest,
    route,
    request,
    params,
    new URL(request.url),
    forcedPageProps,
  );
  if (artifact.notFound && route.route !== "/404") {
    return renderNotFound(manifest, request, env);
  }
  return renderArtifactResponse(artifact, request, env, status);
}

function internalErrorRoute(
  status: 404 | 500,
): ServerRouteManifest {
  return {
    route: status === 404 ? "/404" : "/500",
    regexSource: status === 404 ? "^/404/?$" : "^/500/?$",
    params: [],
    id: -status,
    kind: "page",
    async load() {
      return {
        default: status === 404 ? DefaultNotFound : DefaultServerError,
      };
    },
  };
}

async function renderNotFound(
  manifest: NextaneManifest,
  request: Request,
  env: NextaneEnvironment,
) {
  const notFoundRoute = manifest.routes.find(
    (candidate) => candidate.route === "/404",
  );
  if (!notFoundRoute && manifest.loadError) {
    const errorModule = await manifest.loadError();
    const ErrorComponent = errorModule.default as
      | (ComponentBody<Record<string, unknown>> & {
          getInitialProps?: (context: Record<string, unknown>) => unknown;
        })
      | undefined;
    const response = new PageResponse();
    let pageProps: Record<string, unknown> = { statusCode: 404 };
    if (typeof ErrorComponent?.getInitialProps === "function") {
      const requestUrl = new URL(request.url);
      const initial = await ErrorComponent.getInitialProps({
        req: createPageRequest(request),
        res: response,
        pathname: "/_error",
        query: searchQuery(requestUrl, {}),
        asPath: `${requestUrl.pathname}${requestUrl.search}`,
        err: null,
      });
      if (initial && typeof initial === "object") {
        pageProps = {
          ...pageProps,
          ...(initial as Record<string, unknown>),
        };
      }
    }
    return renderRoute(
      manifest,
      {
        route: "/_error",
        regexSource: "^/_error/?$",
        params: [],
        id: -1,
        kind: "page",
        async load() {
          return errorModule;
        },
      },
      request,
      {},
      env,
      404,
      pageProps,
    );
  }
  const route = notFoundRoute ?? internalErrorRoute(404);
  return renderRoute(
    manifest,
    route,
    request,
    {},
    env,
    404,
    { statusCode: 404 },
  );
}

async function renderServerError(
  manifest: NextaneManifest,
  request: Request,
  env: NextaneEnvironment,
) {
  const route =
    manifest.routes.find((candidate) => candidate.route === "/500") ??
    (manifest.loadError
      ? {
          route: "/_error",
          regexSource: "^/_error/?$",
          params: [],
          id: -1,
          kind: "page" as const,
          load: manifest.loadError,
        }
      : internalErrorRoute(500));
  return renderRoute(
    manifest,
    route,
    request,
    {},
    env,
    500,
    { statusCode: 500 },
  );
}

function dataPathFromRequest(pathname: string): string | null {
  const match = /^\/_next\/data\/[^/]+\/(.+)\.json$/.exec(pathname);
  if (!match) return null;
  return match[1] === "index" ? "/" : `/${match[1]}`;
}

async function routeUsesStaticProps(route: ServerRouteManifest): Promise<boolean> {
  const pageModule = await route.load();
  return typeof pageModule.getStaticProps === "function";
}

async function loadArtifact(
  manifest: NextaneManifest,
  route: ServerRouteManifest,
  request: Request,
  params: ParsedUrlQuery,
  options: HandlerOptions,
  pageUrl = new URL(request.url),
  shouldRender = true,
  displayUrl = pageUrl,
  resolvedUrl = pageUrl,
): Promise<{ artifact: RenderArtifact; cacheStatus?: string | null }> {
  const usesStaticProps = await routeUsesStaticProps(route);
  if (usesStaticProps) {
    if (shouldRender) {
      const pageModule = await route.load();
      const staticPath = await staticPathInfo(pageModule, params, pageUrl);
      if (!staticPath.matched && staticPath.fallback === true) {
        if (options.loadCachedArtifact) {
          const headers = new Headers(request.headers);
          headers.set("x-nextane-only-cached", "1");
          const response = await options.loadCachedArtifact(
            new Request(pageUrl, { ...request, headers }),
            route,
          );
          if (response.ok) {
            return {
              artifact: (await response.json()) as RenderArtifact,
              cacheStatus:
                response.headers.get("cf-cache-status") ??
                response.headers.get("x-cache-status"),
            };
          }
          if (response.status !== 404) {
            throw new Error(
              `ISR artifact cache lookup failed (${response.status})`,
            );
          }
        }
        return {
          artifact: await createRenderArtifact(
            manifest,
            route,
            request,
            params,
            pageUrl,
            undefined,
            true,
            displayUrl,
            resolvedUrl,
            true,
          ),
        };
      }
    }
  }

  if (options.loadCachedArtifact && usesStaticProps) {
    const response = await options.loadCachedArtifact(
      new Request(pageUrl, request),
      route,
    );
    if (!response.ok) {
      throw new Error(`ISR artifact entrypoint failed (${response.status})`);
    }
    return {
      artifact: (await response.json()) as RenderArtifact,
      cacheStatus: response.headers.get("cf-cache-status") ?? response.headers.get("x-cache-status"),
    };
  }
  return {
    artifact: await createRenderArtifact(
      manifest,
      route,
      request,
      params,
      pageUrl,
      undefined,
      shouldRender,
      displayUrl,
      resolvedUrl,
    ),
  };
}

export function createIsrArtifactHandler(manifest: NextaneManifest) {
  return async function handleIsrArtifact(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = matchRoute(
      manifest.routes.filter((route) => route.kind === "page"),
      url.pathname,
    );
    if (!match) return new Response("ISR route not found", { status: 404 });
    if (!(await routeUsesStaticProps(match.route))) {
      return new Response("Route does not export getStaticProps", { status: 400 });
    }
    if (request.headers.get("x-nextane-only-cached") === "1") {
      return new Response("ISR artifact not cached", { status: 404 });
    }

    const artifact = await createRenderArtifact(
      manifest,
      match.route,
      request,
      match.params,
    );
    const revalidate =
      artifact.revalidate === true
        ? 1
        : typeof artifact.revalidate === "number" && artifact.revalidate > 0
          ? artifact.revalidate
          : 31536000;
    const cacheControl = [
      "public",
      `max-age=${revalidate}`,
      "stale-while-revalidate=31536000",
      "stale-if-error=31536000",
    ].join(", ");
    const cacheTag = cacheTagForPath(url.pathname);

    return Response.json(artifact, {
      headers: {
        "cache-control": cacheControl,
        "cache-tag": cacheTag,
        "x-nextane-generated-at": String(artifact.generatedAt),
      },
    });
  };
}

export function createNextaneHandler(
  manifest: NextaneManifest,
  options: HandlerOptions = {},
) {
  return async function handle(
    request: Request,
    env: NextaneEnvironment,
  ): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (
        url.pathname.startsWith("/@") ||
        url.pathname.startsWith("/src/") ||
        url.pathname.startsWith("/node_modules/") ||
        (/\.[a-z0-9]+$/i.test(url.pathname) &&
          !url.pathname.startsWith("/_next/data/"))
      ) {
        return env.ASSETS.fetch(request);
      }

      if (!url.pathname.startsWith("/_next/data/")) {
        const canonical = canonicalPathname(
          url.pathname,
          manifest.config?.trailingSlash === true,
        );
        if (canonical !== url.pathname) {
          const location = new URL(request.url);
          location.pathname = canonical;
          return Response.redirect(location, 308);
        }
      }

      const dataPath = dataPathFromRequest(url.pathname);
      if (dataPath) {
        const match = matchRoute(
          manifest.routes.filter((route) => route.kind === "page"),
          dataPath,
        );
        if (!match) return Response.json({ notFound: true }, { status: 404 });
        const pageUrl = new URL(dataPath, request.url);
        pageUrl.search = url.search;
        const { artifact, cacheStatus } = await loadArtifact(
          manifest,
          match.route,
          request,
          match.params,
          options,
          pageUrl,
          false,
        );
        if (artifact.response?.ended) {
          const responseHeaders = new Headers(artifact.response.headers);
          const location = responseHeaders.get("location");
          if (
            location &&
            artifact.response.status >= 300 &&
            artifact.response.status < 400
          ) {
            return Response.json({
              __N_REDIRECT: location,
              __N_REDIRECT_STATUS: artifact.response.status,
            });
          }
          return new Response(artifact.response.body ?? null, {
            status: artifact.response.status,
            statusText: artifact.response.statusMessage,
            headers: artifact.response.headers,
          });
        }
        const headers = new Headers({
          ...(cacheStatus ? { "x-nextane-cache-status": cacheStatus } : {}),
          "x-nextane-generated-at": String(artifact.generatedAt),
          ...(artifact.gssp
            ? {
                "cache-control":
                  "private, no-cache, no-store, max-age=0, must-revalidate",
              }
            : artifact.gsp
              ? { "cache-control": "public, max-age=0, must-revalidate" }
              : {}),
        });
        for (const [name, value] of artifact.response?.headers ?? []) {
          headers.set(name, value);
        }
        return Response.json(artifactData(artifact), {
          status: artifact.notFound ? 404 : 200,
          headers,
        });
      }

      const routing = resolveRewrite(manifest, url);
      const match = matchRoute(manifest.routes, routing.pageUrl.pathname);
      if (!match) {
        return renderNotFound(manifest, request, env);
      }

      if (match.route.kind === "api") {
        return runApiRoute(
          await match.route.load(),
          request,
          searchQuery(routing.pageUrl, match.params),
          {
            revalidatePath: options.revalidatePath,
          },
        );
      }

      if (
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        (await routeUsesStaticProps(match.route))
      ) {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { allow: "GET, HEAD" },
        });
      }

      const status = match.route.route === "/404" ? 404 : 200;
      const { artifact, cacheStatus } = await loadArtifact(
        manifest,
        match.route,
        request,
        match.params,
        options,
        routing.pageUrl,
        true,
        routing.displayUrl,
        routing.resolvedUrl,
      );
      if (artifact.notFound && match.route.route !== "/404") {
        return renderNotFound(manifest, request, env);
      }
      return renderArtifactResponse(artifact, request, env, status, cacheStatus);
    } catch (error) {
      console.error("[nextane] request failed", error);
      try {
        return await renderServerError(manifest, request, env);
      } catch (renderError) {
        console.error("[nextane] error page failed", renderError);
      }
      return new Response(
        import.meta.env?.DEV
          ? `<pre>${String(error instanceof Error ? error.stack ?? error.message : error)}</pre>`
          : "Internal Server Error",
        {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
  };
}
