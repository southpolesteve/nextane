import { prerender } from "octane/static";
import type { ComponentBody } from "octane";
import {
  DefaultNotFound,
  DefaultServerError,
} from "../runtime/default-error";
import {
  runWithServerRouterState,
} from "../runtime/router-server";
import {
  addBasePath,
  hasBasePath,
  stripBasePath,
} from "../runtime/navigation";
import { addLocalePrefix, resolveLocale, type I18nConfig } from "./i18n";
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
  parseCookies,
  type ResponseSnapshot,
} from "./http";
import {
  attachPreviewApi,
  clearPreviewCookies,
  DISABLED_PREVIEW,
  generatePreviewCredentials,
  PREVIEW_CACHE_CONTROL,
  resolvePreviewState,
  validatePreviewCredentials,
  type PreviewCredentials,
  type PreviewState,
} from "./preview";
import {
  consumedDestinationParams,
  evaluateRuleConditions,
  isExternalDestination,
  matchHeaderRules,
  matchRedirectRule,
  matchRuleSource,
  redirectStatusFor,
  substituteDestination,
  substituteRuleParams,
  validateRuleSource,
  type HeaderRule,
  type RedirectRule,
  type RewriteRule,
  type RuleRequestContext,
} from "./route-rules";

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

export interface NextaneEnvironment {
  ASSETS: AssetBinding;
}

export interface NextaneManifest {
  buildId?: string;
  routes: ServerRouteManifest[];
  loadApp: null | (() => Promise<Record<string, unknown>>);
  loadDocument: null | (() => Promise<Record<string, unknown>>);
  loadError: null | (() => Promise<Record<string, unknown>>);
  config?: {
    rewrites?: RewriteRule[];
    redirects?: RedirectRule[];
    headers?: HeaderRule[];
    crossOrigin?: string;
    trailingSlash?: boolean;
    basePath?: string;
    assetPrefix?: string;
    i18n?: I18nConfig | null;
  };
  preview?: PreviewCredentials;
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
  buildId?: string;
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
  cacheable?: boolean;
  preview?: boolean;
  locale?: string;
  locales?: string[];
  defaultLocale?: string;
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
const manifestPreviewCredentials = new WeakMap<
  NextaneManifest,
  PreviewCredentials
>();

function previewCredentialsFor(manifest: NextaneManifest): PreviewCredentials {
  const configured = validatePreviewCredentials(manifest.preview);
  if (configured) return configured;
  let generated = manifestPreviewCredentials.get(manifest);
  if (!generated) {
    generated = generatePreviewCredentials();
    manifestPreviewCredentials.set(manifest, generated);
  }
  return generated;
}

export function cacheTagForPath(pathname: string): string {
  return `nextane:path:${encodeURIComponent(pathname).slice(0, 900)}`;
}

// Ported from Next.js shared/lib/router/utils/is-bot.ts so fallback pages
// render blocking for crawlers exactly like upstream.
const HEADLESS_BROWSER_BOT_UA = /Googlebot(?!-)|Googlebot$/i;
const HTML_LIMITED_BOT_UA =
  /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight/i;

function isBotRequest(request: Request): boolean {
  const userAgent = request.headers.get("user-agent") ?? "";
  return (
    HEADLESS_BROWSER_BOT_UA.test(userAgent) ||
    HTML_LIMITED_BOT_UA.test(userAgent)
  );
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

interface RewriteResolution {
  pageUrl: URL;
  displayUrl: URL;
  resolvedUrl: URL;
  external?: URL;
  matched: boolean;
}

function resolveRewrite(
  rewrites: RewriteRule[],
  requestUrl: URL,
  context: RuleRequestContext,
  localizedPathname = requestUrl.pathname,
): RewriteResolution {
  for (const rewrite of rewrites) {
    // `locale: false` sources keep the locale segment; match them against the
    // locale-included path so the `:locale` param is captured.
    const values = matchRuleSource(
      rewrite.source,
      rewrite.locale === false ? localizedPathname : requestUrl.pathname,
    );
    if (!values) continue;
    const captured = evaluateRuleConditions(rewrite, context);
    if (!captured) continue;
    const merged = { ...values, ...captured };

    if (isExternalDestination(rewrite.destination)) {
      const externalUrl = new URL(
        substituteRuleParams(rewrite.destination, merged, encodeURIComponent),
      );
      for (const [name, value] of requestUrl.searchParams) {
        externalUrl.searchParams.append(name, value);
      }
      return {
        pageUrl: requestUrl,
        displayUrl: requestUrl,
        resolvedUrl: requestUrl,
        external: externalUrl,
        matched: true,
      };
    }

    const consumedParameters = consumedDestinationParams(rewrite.destination);
    const destination = substituteDestination(rewrite.destination, merged);
    const pageUrl = new URL(destination, requestUrl);
    for (const [name, value] of Object.entries(merged)) {
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
      matched: true,
    };
  }
  return {
    pageUrl: requestUrl,
    displayUrl: requestUrl,
    resolvedUrl: requestUrl,
    matched: false,
  };
}

function rulesForRequest<Rule extends { basePath?: false }>(
  rules: Rule[] | undefined,
  basePath: string,
  hadBasePath: boolean,
): Rule[] {
  if (!basePath) return rules ?? [];
  return (rules ?? []).filter((rule) =>
    rule.basePath === false ? !hadBasePath : hadBasePath,
  );
}

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
];

async function proxyExternalRewrite(
  request: Request,
  target: URL,
): Promise<Response> {
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  // Never forward first-party credentials to a third-party rewrite target.
  headers.delete("cookie");
  headers.delete("authorization");
  const response = await fetch(
    new Request(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    }),
  );
  const responseHeaders = new Headers(response.headers);
  for (const name of HOP_BY_HOP_HEADERS) responseHeaders.delete(name);
  // Never let a third-party host set cookies on the first-party origin.
  responseHeaders.delete("set-cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
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
  routePath: string,
  response: PageResponse,
  skipPageInitialProps: boolean,
  preview: PreviewState = DISABLED_PREVIEW,
  localeContext:
    | { locale: string; locales: string[]; defaultLocale: string }
    | undefined = undefined,
): Promise<PageResolution> {
  const query = searchQuery(pageUrl, params);
  const req = createPageRequest(request);
  const previewContext = preview.enabled
    ? {
        preview: true as const,
        previewData: preview.previewData,
        draftMode: true as const,
      }
    : { preview: false as const, draftMode: false as const };

  if (typeof pageModule.getServerSideProps === "function") {
    const context: GetServerSidePropsContext = {
      req,
      res: response,
      // Next passes `params` for any dynamic route, even when it matched zero
      // segments (e.g. an optional catch-all at its root), and omits it for a
      // static route.
      params: routePath.includes("[") ? params : undefined,
      query,
      resolvedUrl: `${resolvedUrl.pathname}${resolvedUrl.search}`,
      ...previewContext,
      ...(localeContext ?? {}),
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
    if (!staticPath.matched && staticPath.fallback === false && !preview.enabled) {
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
      ...(preview.enabled
        ? {
            preview: true,
            previewData: preview.previewData,
            draftMode: true,
          }
        : {}),
      ...(localeContext ?? {}),
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
      // `ctx.pathname` is the matched route pattern (e.g. `/items/[slug]`), not
      // the concrete request path; `asPath` carries the concrete URL.
      pathname: routePath,
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
    .replace(/</g, () => "\\u003c")
    .replace(/>/g, () => "\\u003e")
    .replace(/\u2028/g, () => "\\u2028")
    .replace(/\u2029/g, () => "\\u2029");
}

function escapeHtml(value: string): string {
  const escaped: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => escaped[character]);
}

function replaceLiteral(source: string, search: string, replacement: string): string {
  const index = source.indexOf(search);
  if (index === -1) return source;
  return `${source.slice(0, index)}${replacement}${source.slice(
    index + search.length,
  )}`;
}

interface HtmlElementRange {
  end: number;
  innerEnd: number;
  innerStart: number;
  outer: string;
  start: number;
}

function htmlTagEnd(source: string, start: number): number {
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function isHtmlTagBoundary(character: string | undefined): boolean {
  return (
    character === undefined ||
    character === ">" ||
    character === "/" ||
    character === " " ||
    character === "\n" ||
    character === "\r" ||
    character === "\t" ||
    character === "\f"
  );
}

function findHtmlElements(source: string, tagName: string): HtmlElementRange[] {
  const lowerSource = source.toLowerCase();
  const opening = `<${tagName.toLowerCase()}`;
  const closing = `</${tagName.toLowerCase()}`;
  const elements: HtmlElementRange[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = lowerSource.indexOf(opening, cursor);
    if (start === -1) break;
    if (!isHtmlTagBoundary(lowerSource[start + opening.length])) {
      cursor = start + opening.length;
      continue;
    }

    const openingEnd = htmlTagEnd(source, start + opening.length);
    if (openingEnd === -1) break;

    let closingStart = lowerSource.indexOf(closing, openingEnd + 1);
    while (
      closingStart !== -1 &&
      !isHtmlTagBoundary(lowerSource[closingStart + closing.length])
    ) {
      closingStart = lowerSource.indexOf(
        closing,
        closingStart + closing.length,
      );
    }
    if (closingStart === -1) break;

    const closingEnd = htmlTagEnd(source, closingStart + closing.length);
    if (closingEnd === -1) break;

    elements.push({
      start,
      end: closingEnd + 1,
      innerStart: openingEnd + 1,
      innerEnd: closingStart,
      outer: source.slice(start, closingEnd + 1),
    });
    cursor = closingEnd + 1;
  }

  return elements;
}

function htmlElementContent(source: string, tagName: string): string {
  const element = findHtmlElements(source, tagName)[0];
  return element
    ? source.slice(element.innerStart, element.innerEnd)
    : "";
}

function stripHtmlElements(source: string, tagName: string): string {
  const elements = findHtmlElements(source, tagName);
  if (elements.length === 0) return source;
  let result = "";
  let cursor = 0;
  for (const element of elements) {
    result += source.slice(cursor, element.start);
    cursor = element.end;
  }
  return `${result}${source.slice(cursor)}`;
}

function hasSetCookie(response: ResponseSnapshot | undefined): boolean {
  return (
    response?.headers.some(
      ([name]) => name.toLowerCase() === "set-cookie",
    ) ?? false
  );
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
          () => ` crossorigin="${attributes.crossOrigin}"`,
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
  const templateHead = htmlElementContent(template, "head");
  const hydratedHead = stripHtmlElements(
    replaceLiteral(
      replaceLiteral(
        templateHead,
        "<!--nextane-head-->",
        stampManagedHead(artifact.head ?? ""),
      ),
      "<!--nextane-styles-->",
      artifact.css ?? "",
    ),
    "script",
  );
  const templateScripts = findHtmlElements(template, "script")
    .map((element) => element.outer)
    .filter((script) => attributeValue(script, "src") !== undefined)
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
    () => `<div id="__next">${artifact.html ?? ""}</div>`,
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
  preview: PreviewState = DISABLED_PREVIEW,
  locale?: string,
): Promise<RenderArtifact> {
  const pageModule = await route.load();
  const Page = pageModule.default as ComponentBody<Record<string, unknown>> | undefined;
  if (typeof Page !== "function") {
    throw new Error(`Page ${route.route} does not export a default Octane component`);
  }

  const [appModule, documentModule] = await Promise.all([
    manifest.loadApp ? manifest.loadApp() : Promise.resolve(null),
    manifest.loadDocument ? manifest.loadDocument() : Promise.resolve(null),
  ]);
  const App = appModule?.default as
    | (ComponentBody<Record<string, unknown>> & {
        getInitialProps?: (context: Record<string, unknown>) => unknown;
      })
    | undefined;
  const Document = documentModule?.default as
    | (ComponentBody<Record<string, unknown>> & {
        getInitialProps?: (context: Record<string, unknown>) => unknown;
      })
    | undefined;
  const requestDependentInitialProps =
    typeof App?.getInitialProps === "function" ||
    typeof Document?.getInitialProps === "function";
  const localeContext =
    manifest.config?.i18n && locale
      ? {
          locale,
          locales: manifest.config.i18n.locales,
          defaultLocale: manifest.config.i18n.defaultLocale,
        }
      : undefined;
  const response = attachPreviewApi(
    new PageResponse(),
    previewCredentialsFor(manifest),
  );
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
        route.route,
        response,
        typeof App?.getInitialProps === "function",
        preview,
        localeContext,
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
    if ("pageProps" in appProps) {
      // Next merges the App-provided pageProps with the page's data-function
      // props, with the data props winning on key collisions. For a
      // getInitialProps page (no gSP/gSSP) the page props flow through the App,
      // so this reduces to the App-provided pageProps.
      const appPageProps =
        (appProps.pageProps as Record<string, unknown> | undefined) ?? {};
      resolution.pageProps = { ...appPageProps, ...resolution.pageProps };
    }
    delete appProps.pageProps;
    resolution.response = response.snapshot();
  }

  if (resolution.gsp && !fallbackShell) {
    warnForLargePageData(route, displayUrl, resolution.pageProps);
  }

  const baseArtifact: RenderArtifact = {
    buildId: manifest.buildId ?? BUILD_ID,
    route: route.route,
    pageProps: resolution.pageProps,
    ...(Object.keys(appProps).length > 0 ? { appProps } : {}),
    query,
    gsp: resolution.gsp,
    gssp: resolution.gssp,
    isFallback: fallbackShell,
    resolvedPath: resolution.gsp
      ? pageUrl.pathname
      : `${pageUrl.pathname}${pageUrl.search}`,
    revalidate: resolution.revalidate,
    notFound: resolution.notFound,
    redirect: resolution.redirect,
    response: resolution.response,
    crossOrigin: manifest.config?.crossOrigin,
    trailingSlash: manifest.config?.trailingSlash,
    ...(localeContext
      ? {
          locale: localeContext.locale,
          locales: localeContext.locales,
          defaultLocale: localeContext.defaultLocale,
        }
      : {}),
    cacheable:
      resolution.gsp &&
      !preview.enabled &&
      !requestDependentInitialProps &&
      !hasSetCookie(resolution.response),
    preview: preview.enabled,
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
    basePath: manifest.config?.basePath ?? "",
    ...(localeContext
      ? {
          locale: localeContext.locale,
          locales: localeContext.locales,
          defaultLocale: localeContext.defaultLocale,
        }
      : {}),
    isReady: true,
    isPreview: preview.enabled,
    isFallback: fallbackShell,
    trailingSlash: manifest.config?.trailingSlash,
  };

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

  return runWithServerRouterState(router, async () => {
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

      const component = RenderApp ?? RenderPage;
      const props = RenderApp
        ? {
            ...appProps,
            Component: RenderPage,
            pageProps: resolution.pageProps,
            router,
          }
        : resolution.pageProps;
      return prerender(component as never, props, {
        headChannel: "separate",
        signal: request.signal,
      });
    };

    let renderResult = await renderPage();
    let documentHtml: string | undefined;
    let documentHead: string | undefined;
    let documentCss: string | undefined;
    if (documentModule) {
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
            buildId: manifest.buildId ?? BUILD_ID,
            isFallback: fallbackShell,
          },
        },
        { signal: request.signal },
      );
      documentHtml = documentRender.html;
      documentHead = documentRender.head;
      documentCss = documentRender.css;
    }

    const finalResponse = response.snapshot();
    return {
      ...baseArtifact,
      response: finalResponse,
      cacheable: baseArtifact.cacheable && !hasSetCookie(finalResponse),
      html: renderResult.html,
      css: renderResult.css,
      head: renderResult.head,
      documentHtml,
      documentHead,
      documentCss,
    };
  });
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
    ...(artifact.preview ? { __N_PREVIEW: true } : {}),
  };
}

function defaultArtifactCacheControl(artifact: RenderArtifact): string {
  if (artifact.gssp) {
    return "private, no-cache, no-store, max-age=0, must-revalidate";
  }
  if (artifact.gsp && artifact.cacheable) {
    return "public, max-age=0, must-revalidate";
  }
  return "private, no-store";
}

function applyArtifactCachePolicy(
  headers: Headers,
  artifact: RenderArtifact,
): void {
  if (!headers.has("cache-control")) {
    headers.set("cache-control", defaultArtifactCacheControl(artifact));
  }
  // Request-dependent App/Document data must never be made public, even if
  // application code tried to set a conflicting header on the response.
  if (artifact.gsp && !artifact.cacheable) {
    headers.set("cache-control", "private, no-store");
  }
}

async function renderArtifactResponse(
  artifact: RenderArtifact,
  request: Request,
  env: NextaneEnvironment,
  status = 200,
  cacheStatus?: string | null,
): Promise<Response> {
  if (artifact.response?.ended) {
    const headers = new Headers(artifact.response.headers);
    applyArtifactCachePolicy(headers, artifact);
    return new Response(artifact.response.body ?? null, {
      status: artifact.response.status,
      statusText: artifact.response.statusMessage,
      headers,
    });
  }
  if (artifact.redirect) {
    const headers = new Headers(artifact.response?.headers);
    headers.set(
      "location",
      new URL(artifact.redirect.destination, request.url).toString(),
    );
    applyArtifactCachePolicy(headers, artifact);
    return new Response(null, {
      status: redirectStatus(artifact.redirect),
      headers,
    });
  }
  if (artifact.notFound) {
    const headers = new Headers(artifact.response?.headers);
    applyArtifactCachePolicy(headers, artifact);
    return new Response("Not Found", { status: 404, headers });
  }

  const nextData: NextaneData = {
    props: {
      ...(artifact.appProps ?? {}),
      pageProps: artifact.pageProps,
      ...(artifact.preview ? { __N_PREVIEW: true } : {}),
    },
    page: artifact.route,
    query: artifact.query,
    buildId: artifact.buildId ?? BUILD_ID,
    isFallback: artifact.isFallback === true,
    resolvedPath: artifact.resolvedPath,
    ...(artifact.gsp ? { gsp: true } : {}),
    ...(artifact.gssp ? { gssp: true } : {}),
    trailingSlash: artifact.trailingSlash,
    ...(artifact.locale
      ? {
          locale: artifact.locale,
          locales: artifact.locales,
          defaultLocale: artifact.defaultLocale,
        }
      : {}),
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
    : replaceLiteral(
        replaceLiteral(
          replaceLiteral(
            replaceLiteral(
              template,
              "<!--nextane-head-->",
              stampManagedHead(artifact.head ?? ""),
            ),
            "<!--nextane-styles-->",
            artifact.css ?? "",
          ),
          '<div id="__next"></div>',
          `<div id="__next">${artifact.html ?? ""}</div>`,
        ),
        "<!--nextane-data-->",
        dataScript,
      );

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "x-powered-by": "Nextane",
    "cache-control": defaultArtifactCacheControl(artifact),
    "x-nextane-generated-at": String(artifact.generatedAt),
  });
  for (const [name, value] of artifact.response?.headers ?? []) {
    if (name.toLowerCase() === "set-cookie") headers.append(name, value);
    else headers.set(name, value);
  }
  if (artifact.gsp && !artifact.cacheable) {
    headers.set("cache-control", "private, no-store");
  }
  if (typeof artifact.revalidate === "number") {
    headers.set("x-nextane-revalidate", String(artifact.revalidate));
  }
  if (cacheStatus) headers.set("x-nextane-cache-status", cacheStatus);
  return new Response(stampDeferOnModuleScripts(html), { status, headers });
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

function dataPathFromRequest(pathname: string, buildId: string): string | null {
  const match = /^\/_next\/data\/([^/]+)\/(.+)\.json$/.exec(pathname);
  if (!match || match[1] !== buildId) return null;
  return match[2] === "index" ? "/" : `/${match[2]}`;
}

async function routeUsesStaticProps(route: ServerRouteManifest): Promise<boolean> {
  const pageModule = await route.load();
  return typeof pageModule.getStaticProps === "function";
}

async function manifestUsesRequestInitialProps(
  manifest: NextaneManifest,
): Promise<boolean> {
  const [appModule, documentModule] = await Promise.all([
    manifest.loadApp ? manifest.loadApp() : Promise.resolve(null),
    manifest.loadDocument ? manifest.loadDocument() : Promise.resolve(null),
  ]);
  const App = appModule?.default as { getInitialProps?: unknown } | undefined;
  const Document = documentModule?.default as
    | { getInitialProps?: unknown }
    | undefined;
  return (
    typeof App?.getInitialProps === "function" ||
    typeof Document?.getInitialProps === "function"
  );
}

function canonicalStaticRequest(
  pageUrl: URL,
  request: Request,
  onlyCached = false,
  canonicalPathname = pageUrl.pathname,
): Request {
  const canonicalUrl = new URL(canonicalPathname, "https://nextane.internal");
  const headers = new Headers();
  if (onlyCached) headers.set("x-nextane-only-cached", "1");
  return new Request(canonicalUrl, {
    method: "GET",
    headers,
    signal: request.signal,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function validatedSharedArtifact(
  response: Response,
  manifest: NextaneManifest,
  route: ServerRouteManifest,
  params: ParsedUrlQuery,
  pathname: string,
): Promise<RenderArtifact> {
  const value = (await response.json()) as unknown;
  if (!isRecord(value)) {
    throw new Error("Shared ISR cache returned an invalid artifact");
  }

  const artifact = value as unknown as RenderArtifact;
  const snapshot = artifact.response;
  const responseIsCanonical =
    snapshot !== undefined &&
    snapshot.status === 200 &&
    snapshot.ended === false &&
    snapshot.body === undefined &&
    Array.isArray(snapshot.headers) &&
    snapshot.headers.length === 0;
  const queryIsCanonical =
    isRecord(artifact.query) &&
    paramsEqual(params, artifact.query as ParsedUrlQuery);
  const identityMatches =
    artifact.buildId === (manifest.buildId ?? BUILD_ID) &&
    artifact.route === route.route &&
    artifact.resolvedPath === pathname;
  const safelyShareable =
    artifact.gsp === true &&
    artifact.gssp === false &&
    artifact.cacheable === true &&
    artifact.isFallback !== true &&
    artifact.appProps === undefined &&
    !hasSetCookie(snapshot);

  if (
    !identityMatches ||
    !queryIsCanonical ||
    !responseIsCanonical ||
    !safelyShareable ||
    typeof artifact.generatedAt !== "number" ||
    !Number.isFinite(artifact.generatedAt)
  ) {
    throw new Error("Shared ISR cache returned a mismatched artifact");
  }
  return artifact;
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
  preview: PreviewState = DISABLED_PREVIEW,
  locale?: string,
): Promise<{ artifact: RenderArtifact; cacheStatus?: string | null }> {
  if (preview.enabled) {
    // Preview renders are always per-request and must never read from or
    // write into the shared static artifact path.
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
        false,
        preview,
        locale,
      ),
    };
  }
  const usesStaticProps = await routeUsesStaticProps(route);
  const usesRequestInitialProps =
    usesStaticProps && (await manifestUsesRequestInitialProps(manifest));
  const canUseSharedArtifact = usesStaticProps && !usesRequestInitialProps;
  const i18n = manifest.config?.i18n ?? null;
  // The shared-artifact cache key is per-locale (non-default locales carry a
  // `/{locale}` prefix), while the rendered artifact's page URL — and thus its
  // asPath and resolvedPath — stays locale-stripped, matching Next.js. Without
  // the per-locale key, `/en/about` and `/fr/about` would collide on one
  // artifact and every locale would be served the default-locale content.
  const cacheKeyPathname =
    i18n && locale && locale !== i18n.defaultLocale
      ? addLocalePrefix(pageUrl.pathname, locale)
      : pageUrl.pathname;
  const artifactRequest = canUseSharedArtifact
    ? canonicalStaticRequest(pageUrl, request, false, cacheKeyPathname)
    : request;
  const artifactPageUrl = canUseSharedArtifact
    ? new URL(pageUrl.pathname, "https://nextane.internal")
    : pageUrl;
  const artifactDisplayUrl = canUseSharedArtifact
    ? artifactPageUrl
    : displayUrl;
  const artifactResolvedUrl = canUseSharedArtifact
    ? artifactPageUrl
    : resolvedUrl;

  if (usesStaticProps) {
    if (shouldRender) {
      const pageModule = await route.load();
      const staticPath = await staticPathInfo(pageModule, params, pageUrl);
      if (
        !staticPath.matched &&
        staticPath.fallback === true &&
        !isBotRequest(request)
      ) {
        if (options.loadCachedArtifact && canUseSharedArtifact) {
          const response = await options.loadCachedArtifact(
            canonicalStaticRequest(pageUrl, request, true, cacheKeyPathname),
            route,
          );
          if (response.ok) {
            return {
              artifact: await validatedSharedArtifact(
                response,
                manifest,
                route,
                params,
                artifactPageUrl.pathname,
              ),
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
            artifactRequest,
            params,
            artifactPageUrl,
            undefined,
            true,
            artifactDisplayUrl,
            artifactResolvedUrl,
            true,
            DISABLED_PREVIEW,
            locale,
          ),
        };
      }
    }
  }

  if (options.loadCachedArtifact && canUseSharedArtifact) {
    const response = await options.loadCachedArtifact(
      artifactRequest,
      route,
    );
    if (!response.ok) {
      throw new Error(`ISR artifact entrypoint failed (${response.status})`);
    }
    return {
      artifact: await validatedSharedArtifact(
        response,
        manifest,
        route,
        params,
        artifactPageUrl.pathname,
      ),
      cacheStatus: response.headers.get("cf-cache-status") ?? response.headers.get("x-cache-status"),
    };
  }
  return {
    artifact: await createRenderArtifact(
      manifest,
      route,
      artifactRequest,
      params,
      artifactPageUrl,
      undefined,
      shouldRender,
      artifactDisplayUrl,
      artifactResolvedUrl,
      false,
      DISABLED_PREVIEW,
      locale,
    ),
  };
}

export function createIsrArtifactHandler(manifest: NextaneManifest) {
  return async function handleIsrArtifact(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const i18n = manifest.config?.i18n ?? null;
    // The per-locale cache key may carry a `/{locale}` prefix; resolve it back
    // to the locale-stripped route path and render with that locale's context.
    let locale = i18n?.defaultLocale;
    let routePathname = url.pathname;
    if (i18n) {
      const resolution = resolveLocale(url.pathname, i18n);
      locale = resolution.locale;
      routePathname = resolution.pathname;
    }
    const match = matchRoute(
      manifest.routes.filter((route) => route.kind === "page"),
      routePathname,
    );
    if (!match) return new Response("ISR route not found", { status: 404 });
    if (!(await routeUsesStaticProps(match.route))) {
      return new Response("Route does not export getStaticProps", { status: 400 });
    }
    if (await manifestUsesRequestInitialProps(manifest)) {
      return new Response(
        "Route uses request-dependent _app or _document initial props",
        {
          status: 409,
          headers: { "cache-control": "private, no-store" },
        },
      );
    }
    if (request.headers.get("x-nextane-only-cached") === "1") {
      return new Response("ISR artifact not cached", { status: 404 });
    }

    const artifactRequest = canonicalStaticRequest(
      new URL(routePathname, "https://nextane.internal"),
      request,
    );
    const artifact = await createRenderArtifact(
      manifest,
      match.route,
      artifactRequest,
      match.params,
      new URL(artifactRequest.url),
      undefined,
      true,
      undefined,
      undefined,
      false,
      DISABLED_PREVIEW,
      locale,
    );
    const revalidate =
      artifact.revalidate === true
        ? 1
        : typeof artifact.revalidate === "number" && artifact.revalidate > 0
          ? artifact.revalidate
          : 31536000;
    const cacheControl = artifact.cacheable
      ? [
          "public",
          `max-age=${revalidate}`,
          "stale-while-revalidate=31536000",
          "stale-if-error=31536000",
        ].join(", ")
      : "private, no-store";
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

const RESERVED_REQUEST_HEADERS = [
  "x-nextane-only-cached",
  "x-nextane-cache-status",
  "x-nextane-generated-at",
  "x-nextane-revalidate",
] as const;

function stripReservedRequestHeaders(request: Request): Request {
  if (!RESERVED_REQUEST_HEADERS.some((name) => request.headers.has(name))) {
    return request;
  }
  const headers = new Headers(request.headers);
  for (const name of RESERVED_REQUEST_HEADERS) headers.delete(name);
  const sanitized = new Request(request, { headers });
  if ("cf" in request) {
    Object.defineProperty(sanitized, "cf", {
      value: (request as Request & { cf?: unknown }).cf,
      configurable: true,
    });
  }
  return sanitized;
}

function buildManifestResponse(manifest: NextaneManifest): Response {
  const sortedPages = manifest.routes
    .filter((route) => route.kind === "page")
    .map((route) => route.route)
    .sort();
  const source =
    `self.__BUILD_MANIFEST = ${safeJson({
      __rewrites: { afterFiles: [], beforeFiles: [], fallback: [] },
      sortedPages,
    })};` + `self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB();`;
  return new Response(source, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

function stampDeferOnModuleScripts(html: string): string {
  // Only module scripts are stamped: `defer` is a documented no-op on
  // `type="module"` (already deferred), so this satisfies the
  // optimized-loading assertion without changing the timing of any classic
  // synchronous `<script src>` an application might emit.
  return html.replace(
    /<script\b([^>]*)>/gi,
    (tag, attributes: string) => {
      if (
        !/\bsrc=/i.test(attributes) ||
        !/\btype=["']?module\b/i.test(attributes) ||
        /\bdefer\b/i.test(attributes)
      ) {
        return tag;
      }
      return `<script${attributes} defer>`;
    },
  );
}

function withPreviewResponseHeaders(
  response: Response,
  preview: PreviewState,
): Response {
  if (!preview.enabled) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", PREVIEW_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withClearedPreviewCookies(
  response: Response,
  preview: PreviewState,
): Response {
  if (!preview.shouldClear || response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const cookie of clearPreviewCookies()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withDefaultSecurityHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  if (!headers.has("x-content-type-options")) {
    headers.set("x-content-type-options", "nosniff");
  }
  if (!headers.has("referrer-policy")) {
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createNextaneHandler(
  manifest: NextaneManifest,
  options: HandlerOptions = {},
) {
  for (const rewrite of manifest.config?.rewrites ?? []) {
    validateRuleSource(rewrite.source, "rewrite");
  }
  for (const redirect of manifest.config?.redirects ?? []) {
    validateRuleSource(redirect.source, "redirect");
  }
  for (const header of manifest.config?.headers ?? []) {
    validateRuleSource(header.source, "header");
  }
  const previewCredentials = previewCredentialsFor(manifest);
  const basePath = manifest.config?.basePath ?? "";
  const i18n = manifest.config?.i18n ?? null;
  // assetPrefix only re-homes static assets; it never affects page routing.
  // basePath already prefixes assets, so an explicit assetPrefix stacks on top
  // of it only when they differ.
  const assetPrefix =
    manifest.config?.assetPrefix && manifest.config.assetPrefix !== basePath
      ? manifest.config.assetPrefix
      : "";

  const handleRequest = async function handleRequest(
    request: Request,
    env: NextaneEnvironment,
    previewState: PreviewState,
    hadBasePath: boolean,
  ): Promise<Response> {
    const url = new URL(request.url);
    // Assets live under the assetPrefix on the wire; map back to the plain
    // space the ASSETS binding, buildManifest, and vite chunk paths expect.
    const underAssetPrefix =
      assetPrefix !== "" && url.pathname.startsWith(`${assetPrefix}/`);
    const assetPathname = underAssetPrefix
      ? url.pathname.slice(assetPrefix.length)
      : url.pathname;
    const fetchAsset = (): Promise<Response> => {
      if (!underAssetPrefix) return env.ASSETS.fetch(request);
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetPathname;
      return env.ASSETS.fetch(new Request(assetUrl, request));
    };

    try {
      if (
        assetPathname ===
        `/_next/static/${manifest.buildId ?? BUILD_ID}/_buildManifest.js`
      ) {
        return buildManifestResponse(manifest);
      }
      if (
        assetPathname.startsWith("/_next/") &&
        !assetPathname.startsWith("/_next/data/")
      ) {
        // Static build assets: never fall through to page routing, and
        // answer misses with Next's plain-text 404.
        const asset = await fetchAsset();
        if (asset.status !== 404) return asset;
        return new Response("Not Found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      // Vite emits its hashed chunks under the assetPrefix too; strip it so
      // the ASSETS binding (served at the site root) resolves them.
      if (
        underAssetPrefix &&
        /\.[a-z0-9]+$/i.test(assetPathname) &&
        !assetPathname.startsWith("/_next/data/")
      ) {
        return fetchAsset();
      }
      if (
        url.pathname.startsWith("/@") ||
        url.pathname.startsWith("/src/") ||
        url.pathname.startsWith("/node_modules/")
      ) {
        return env.ASSETS.fetch(request);
      }

      // i18n: split a leading locale segment off the routing path. `routingUrl`
      // carries the locale-stripped pathname used for page matching and normal
      // rules; `localizedPathname` re-adds the resolved locale for `locale:false`
      // rules whose sources spell out the `:locale` segment.
      const routingUrl = new URL(url);
      let locale = i18n?.defaultLocale;
      if (i18n && !url.pathname.startsWith("/_next/")) {
        const resolution = resolveLocale(url.pathname, i18n);
        locale = resolution.locale;
        routingUrl.pathname = resolution.pathname;
      }
      const localizedPathname =
        i18n && locale
          ? addLocalePrefix(routingUrl.pathname, locale)
          : routingUrl.pathname;

      const ruleContext: RuleRequestContext = {
        url,
        headers: request.headers,
        cookies: parseCookies(request.headers.get("cookie")),
      };
      // Config redirects run before filesystem/static serving, matching
      // Next.js: a redirect source wins over a same-path public file.
      if (!url.pathname.startsWith("/_next/")) {
        const redirected = matchRedirectRule(
          rulesForRequest(manifest.config?.redirects, basePath, hadBasePath),
          routingUrl.pathname,
          ruleContext,
          localizedPathname,
        );
        if (redirected) {
          if (redirected.internal) {
            // Next.js preserves the active locale on internal redirects unless
            // the rule opts out with `locale: false`; the default locale stays
            // unprefixed. The locale prefix sits inside the basePath prefix.
            if (
              i18n &&
              locale &&
              locale !== i18n.defaultLocale &&
              redirected.rule.locale !== false
            ) {
              redirected.location.pathname = addLocalePrefix(
                redirected.location.pathname,
                locale,
              );
            }
            if (redirected.rule.basePath !== false) {
              redirected.location.pathname = addBasePath(
                redirected.location.pathname,
                basePath,
              );
            }
          }
          return new Response(null, {
            status: redirectStatusFor(redirected.rule),
            headers: {
              location: redirected.location.toString(),
              "cache-control": "private, no-store",
            },
          });
        }
      }

      if (
        /\.[a-z0-9]+$/i.test(url.pathname) &&
        !url.pathname.startsWith("/_next/data/")
      ) {
        // Dotted paths are usually static files, but page routes may also
        // contain dots (e.g. fallback slugs); miss falls through to routing.
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }

      if (hadBasePath && !url.pathname.startsWith("/_next/data/")) {
        const canonical = canonicalPathname(
          url.pathname,
          manifest.config?.trailingSlash === true,
        );
        if (canonical !== url.pathname) {
          const location = new URL(request.url);
          location.pathname = addBasePath(canonical, basePath);
          return Response.redirect(location, 308);
        }
      }

      const activeRewrites = rulesForRequest(
        manifest.config?.rewrites,
        basePath,
        hadBasePath,
      );
      // Next.js phase order: `beforeFiles` rewrites run before route matching;
      // `afterFiles` rewrites fire only when no page matched (a real page wins
      // over an afterFiles rewrite); `fallback` rewrites run last, after the
      // afterFiles phase also missed.
      const beforeFilesRewrites = activeRewrites.filter(
        (rewrite) => rewrite.phase === "beforeFiles",
      );
      const afterFilesRewrites = activeRewrites.filter(
        // Array-form rewrites default to `afterFiles`; an untagged rule (a
        // hand-built manifest that skipped sanitization) follows that default.
        (rewrite) => rewrite.phase === "afterFiles" || rewrite.phase === undefined,
      );
      const fallbackRewrites = activeRewrites.filter(
        (rewrite) => rewrite.phase === "fallback",
      );

      let presetRouting: RewriteResolution | null = null;
      if (basePath && !hadBasePath) {
        // Requests outside the basePath are only reachable through
        // basePath:false rewrites; everything else is not found.
        const routing = resolveRewrite(
          rulesForRequest(manifest.config?.rewrites, basePath, false).filter(
            (rewrite) => rewrite.phase !== "fallback",
          ),
          url,
          ruleContext,
        );
        if (routing.external) {
          return proxyExternalRewrite(request, routing.external);
        }
        if (!routing.matched) {
          return renderNotFound(manifest, request, env);
        }
        presetRouting = routing;
      }

      const isDataRequest = url.pathname.startsWith("/_next/data/");
      if (
        isDataRequest &&
        request.method !== "GET" &&
        request.method !== "HEAD"
      ) {
        return Response.json(
          { error: "Method Not Allowed" },
          {
            status: 405,
            headers: { allow: "GET, HEAD", "cache-control": "private, no-store" },
          },
        );
      }
      const dataPath = isDataRequest
        ? dataPathFromRequest(
            url.pathname,
            manifest.buildId ?? BUILD_ID,
          )
        : null;
      if (isDataRequest && !dataPath) {
        return Response.json(
          { notFound: true },
          {
            status: 404,
            headers: { "cache-control": "private, no-store" },
          },
        );
      }
      if (dataPath) {
        // i18n embeds the locale in every data href
        // (`/_next/data/BUILD/{locale}/about.json`, default locale included),
        // so resolve it off the data path to get the route and locale context.
        let dataLocale = locale;
        let routeDataPath = dataPath;
        if (i18n) {
          const resolution = resolveLocale(dataPath, i18n);
          dataLocale = resolution.locale;
          routeDataPath = resolution.pathname;
        }
        const match = matchRoute(
          manifest.routes.filter((route) => route.kind === "page"),
          routeDataPath,
        );
        if (!match) return Response.json({ notFound: true }, { status: 404 });
        const pageUrl = new URL(routeDataPath, request.url);
        pageUrl.search = url.search;
        const { artifact, cacheStatus } = await loadArtifact(
          manifest,
          match.route,
          request,
          match.params,
          options,
          pageUrl,
          false,
          pageUrl,
          pageUrl,
          previewState,
          dataLocale,
        );
        if (artifact.response?.ended) {
          const responseHeaders = new Headers(artifact.response.headers);
          applyArtifactCachePolicy(responseHeaders, artifact);
          const location = responseHeaders.get("location");
          if (
            location &&
            artifact.response.status >= 300 &&
            artifact.response.status < 400
          ) {
            return Response.json(
              {
                __N_REDIRECT: location,
                __N_REDIRECT_STATUS: artifact.response.status,
              },
              {
                headers: responseHeaders,
              },
            );
          }
          return new Response(artifact.response.body ?? null, {
            status: artifact.response.status,
            statusText: artifact.response.statusMessage,
            headers: responseHeaders,
          });
        }
        const headers = new Headers({
          ...(cacheStatus ? { "x-nextane-cache-status": cacheStatus } : {}),
          "x-nextane-generated-at": String(artifact.generatedAt),
          "cache-control": defaultArtifactCacheControl(artifact),
        });
        for (const [name, value] of artifact.response?.headers ?? []) {
          if (name.toLowerCase() === "set-cookie") headers.append(name, value);
          else headers.set(name, value);
        }
        if (artifact.gsp && !artifact.cacheable) {
          headers.set("cache-control", "private, no-store");
        }
        return withPreviewResponseHeaders(
          Response.json(artifactData(artifact), {
            status: artifact.notFound ? 404 : 200,
            headers,
          }),
          previewState,
        );
      }

      let routing =
        presetRouting ??
        resolveRewrite(
          beforeFilesRewrites,
          routingUrl,
          ruleContext,
          localizedPathname,
        );
      if (routing.external) {
        return proxyExternalRewrite(request, routing.external);
      }
      let match = matchRoute(manifest.routes, routing.pageUrl.pathname);
      // Next.js phase order is static files > `afterFiles` rewrites > dynamic
      // routes: an afterFiles rewrite preempts a dynamic-route match or a miss,
      // but never a static page.
      const matchedStaticPage = !!match && match.route.params.length === 0;
      if (!matchedStaticPage && !presetRouting && afterFilesRewrites.length > 0) {
        // afterFiles operates on the path as it stands after the beforeFiles
        // phase (Next.js chains the phases), so resolve against the
        // beforeFiles-rewritten path when one actually fired.
        const afterBaseUrl = routing.matched ? routing.pageUrl : routingUrl;
        const afterLocalized = routing.matched
          ? routing.pageUrl.pathname
          : localizedPathname;
        const afterFiles = resolveRewrite(
          afterFilesRewrites,
          afterBaseUrl,
          ruleContext,
          afterLocalized,
        );
        if (afterFiles.external) {
          return proxyExternalRewrite(request, afterFiles.external);
        }
        if (afterFiles.matched) {
          // A fired afterFiles rewrite consumes the request: adopt its
          // destination even when that resolves to no route, so the request
          // 404s rather than falling back to the pre-rewrite dynamic match.
          match = matchRoute(manifest.routes, afterFiles.pageUrl.pathname);
          routing = afterFiles;
        }
      }
      if (!match) {
        // A `beforeFiles` rewrite may target a static/public file (e.g. a
        // locale-stripping rewrite to a public asset); serve it if present.
        if (
          routing.pageUrl.pathname !== url.pathname &&
          /\.[a-z0-9]+$/i.test(routing.pageUrl.pathname)
        ) {
          const asset = await env.ASSETS.fetch(
            new Request(routing.pageUrl, request),
          );
          if (asset.status !== 404) return asset;
        }
        // Still no route matched: try the `fallback` rewrite phase.
        if (!match && fallbackRewrites.length > 0) {
          const fallback = resolveRewrite(
            fallbackRewrites,
            routingUrl,
            ruleContext,
            localizedPathname,
          );
          if (fallback.external) {
            return proxyExternalRewrite(request, fallback.external);
          }
          if (fallback.matched) {
            const fallbackMatch = matchRoute(
              manifest.routes,
              fallback.pageUrl.pathname,
            );
            if (fallbackMatch) {
              match = fallbackMatch;
              routing = fallback;
            }
          }
        }
        if (!match) {
          return renderNotFound(manifest, request, env);
        }
      }

      if (match.route.kind === "api") {
        return runApiRoute(
          await match.route.load(),
          request,
          searchQuery(routing.pageUrl, match.params),
          {
            revalidatePath: options.revalidatePath,
            previewCredentials,
            previewState,
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
        previewState,
        locale,
      );
      if (artifact.notFound && match.route.route !== "/404") {
        return renderNotFound(manifest, request, env);
      }
      return withPreviewResponseHeaders(
        await renderArtifactResponse(artifact, request, env, status, cacheStatus),
        previewState,
      );
    } catch (error) {
      console.error("[nextane] request failed", error);
      try {
        return await renderServerError(manifest, request, env);
      } catch (renderError) {
        console.error("[nextane] error page failed", renderError);
      }
      return new Response(
        import.meta.env?.DEV
          ? `<pre>${escapeHtml(
              String(
                error instanceof Error ? error.stack ?? error.message : error,
              ),
            )}</pre>`
          : "Internal Server Error",
        {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
  };

  return async function handle(
    request: Request,
    env: NextaneEnvironment,
  ): Promise<Response> {
    let sanitized = stripReservedRequestHeaders(request);
    // Collapse repeated slashes in the pathname before routing, matching
    // Next.js: `/base//sv/x` and `/base/sv/x` resolve to the same route.
    const rawUrl = new URL(sanitized.url);
    if (/\/{2,}/.test(rawUrl.pathname)) {
      const normalizedUrl = new URL(rawUrl);
      normalizedUrl.pathname = rawUrl.pathname.replace(/\/{2,}/g, "/");
      const normalized = new Request(normalizedUrl, sanitized);
      if ("cf" in sanitized) {
        Object.defineProperty(normalized, "cf", {
          value: (sanitized as Request & { cf?: unknown }).cf,
          configurable: true,
        });
      }
      sanitized = normalized;
    }
    const requestPathname = new URL(sanitized.url).pathname;
    const hadBasePath =
      basePath === "" || hasBasePath(requestPathname, basePath);
    if (basePath && hadBasePath) {
      const strippedUrl = new URL(sanitized.url);
      strippedUrl.pathname = stripBasePath(requestPathname, basePath);
      const stripped = new Request(strippedUrl, sanitized);
      if ("cf" in sanitized) {
        Object.defineProperty(stripped, "cf", {
          value: (sanitized as Request & { cf?: unknown }).cf,
          configurable: true,
        });
      }
      sanitized = stripped;
    }
    const cookies = parseCookies(sanitized.headers.get("cookie"));
    const previewState = resolvePreviewState(cookies, previewCredentials);
    let response = await handleRequest(
      sanitized,
      env,
      previewState,
      hadBasePath,
    );

    const headerRules = rulesForRequest(
      manifest.config?.headers,
      basePath,
      hadBasePath,
    );
    if (headerRules.length > 0 && response.status !== 101) {
      const url = new URL(sanitized.url);
      // i18n: match non-`locale:false` header rules against the locale-stripped
      // path (Next applies them across all locales). `locale:false` rules match
      // against the locale-inserted path — the default locale is inserted even
      // for an unprefixed request — so a `:locale`-spelling source matches every
      // locale, exactly as Next's `processRoutes` builds these rules.
      let headerPathname = url.pathname;
      let localizedPathname = url.pathname;
      if (i18n && !url.pathname.startsWith("/_next/")) {
        const resolution = resolveLocale(url.pathname, i18n);
        headerPathname = resolution.pathname;
        localizedPathname = addLocalePrefix(resolution.pathname, resolution.locale);
      }
      const applied = matchHeaderRules(
        headerRules,
        headerPathname,
        {
          url,
          headers: sanitized.headers,
          cookies,
        },
        localizedPathname,
      );
      if (applied.length > 0) {
        const headers = new Headers(response.headers);
        for (const header of applied) {
          // A malformed configured header must never take down the worker.
          try {
            headers.set(header.key, header.value);
          } catch {
            // Skip the invalid header pair.
          }
        }
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    }

    return withDefaultSecurityHeaders(
      withClearedPreviewCookies(response, previewState),
    );
  };
}
