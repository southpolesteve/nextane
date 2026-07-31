import {
  hydrateRoot,
  type ComponentBody,
  type Root,
} from "octane";
import {
  appLoader,
  basePath,
  errorLoader,
  pageLoaders,
  routes,
} from "virtual:nextane-client-manifest";
import { matchRoute } from "./routing/match";
import Router, {
  configureClientRouter,
  setRouterState,
} from "./runtime/router";
import {
  addBasePath,
  isSafeClientNavigationTarget,
  stripBasePath,
} from "./runtime/navigation";
import {
  DefaultNotFound,
  DefaultServerError,
} from "./runtime/default-error";
import type {
  NextaneData,
  ParsedUrlQuery,
  TransitionOptions,
} from "./types";

interface PageModule {
  default: ComponentBody<Record<string, unknown>>;
}

interface AppModule {
  default: ComponentBody<{
    Component: ComponentBody<Record<string, unknown>>;
    pageProps: Record<string, unknown>;
    router: typeof Router;
  }>;
}

interface PageDataPayload {
  pageProps?: Record<string, unknown>;
  notFound?: boolean;
  __N_REDIRECT?: string;
  __N_REDIRECT_STATUS?: number;
  [key: string]: unknown;
}

const inFlightPageData = new Map<
  string,
  Promise<{ ok: boolean; status: number; payload: PageDataPayload }>
>();
const routerDataCache: Record<string, PageDataPayload> = {};

const dataElement = document.getElementById("__NEXT_DATA__");
const container = document.getElementById("__next");

if (!dataElement?.textContent || !container) {
  throw new Error("[nextane] Missing __NEXT_DATA__ or #__next");
}

const initialData = JSON.parse(dataElement.textContent) as NextaneData;
window.__NEXT_DATA__ = initialData;

const initialLoader =
  pageLoaders[initialData.page] ??
  (initialData.page === "/404"
    ? async () => ({ default: DefaultNotFound })
    : initialData.page === "/500" || initialData.page === "/_error"
      ? errorLoader ?? (async () => ({ default: DefaultServerError }))
      : undefined);
if (!initialLoader) {
  throw new Error(`[nextane] No client page loader for ${initialData.page}`);
}

const [initialPageModule, loadedAppModule] = await Promise.all([
  initialLoader() as Promise<unknown> as Promise<PageModule>,
  appLoader ? (appLoader() as Promise<unknown> as Promise<AppModule>) : Promise.resolve(null),
]);

const App = loadedAppModule?.default;
const initialProps = initialData.props.pageProps;

function queryFromUrl(url: URL, params: ParsedUrlQuery): ParsedUrlQuery {
  const query: ParsedUrlQuery = {};
  for (const [key, value] of url.searchParams) {
    const previous = query[key];
    if (previous === undefined) query[key] = value;
    else if (Array.isArray(previous)) query[key] = [...previous, value];
    else query[key] = [previous, value];
  }
  return { ...query, ...params };
}

function applyRouterState(url: URL, route: string, params: ParsedUrlQuery) {
  setRouterState({
    route,
    pathname: route,
    query: queryFromUrl(url, params),
    asPath: `${stripBasePath(url.pathname, basePath)}${url.search}${url.hash}`,
    basePath,
    isReady: true,
    isPreview: false,
    isFallback: false,
    trailingSlash: initialData.trailingSlash,
  });
}

const initialUrl = new URL(window.location.href);
setRouterState({
  route: initialData.page,
  pathname: initialData.page,
  query: initialData.query,
  asPath: `${stripBasePath(initialUrl.pathname, basePath)}${initialUrl.search}${initialUrl.hash}`,
  basePath,
  isReady: true,
  isPreview: false,
  isFallback: initialData.isFallback,
  trailingSlash: initialData.trailingSlash,
});

const root: Root = App
  ? hydrateRoot(container, App, {
      ...initialData.props,
      Component: initialPageModule.default,
      pageProps: initialProps,
      router: Router,
    })
  : hydrateRoot(container, initialPageModule.default, initialProps);

function dataUrl(url: URL, buildId: string): string {
  const pathname = url.pathname === "/" ? "/index" : url.pathname.replace(/\/$/, "");
  return `${basePath}/_next/data/${buildId}${pathname}.json${url.search}`;
}

async function loadNavigation(url: URL) {
  if ((url.pathname.replace(/\/+$/, "") || "/") === "/_error") {
    // Next exposes /_error as a pushable route that renders the 404/error
    // page client-side while the browser URL keeps the masked asPath.
    const notFoundLoader = pageLoaders["/404"];
    const pageModule = (notFoundLoader
      ? await notFoundLoader()
      : { default: DefaultNotFound }) as unknown as PageModule;
    return {
      match: {
        route: { route: "/404", regexSource: "^/404/?$", params: [] },
        params: {},
      },
      pageModule,
      payload: { notFound: true } as PageDataPayload,
    };
  }
  const match = matchRoute(routes, url.pathname);
  if (!match) return null;
  const loader = pageLoaders[match.route.route];
  if (!loader) return null;

  const dataHref = dataUrl(
    url,
    window.__NEXT_DATA__?.buildId ?? "development",
  );
  let dataRequest = inFlightPageData.get(dataHref);
  if (!dataRequest) {
    dataRequest = fetch(dataHref, {
      headers: { "x-nextane-navigation": "1" },
    }).then(async (response) => {
      const source = await response.text();
      let payload: PageDataPayload = {};
      try {
        payload = JSON.parse(source) as PageDataPayload;
      } catch {
        // A failed data request may contain an HTML error page. Returning a
        // non-OK empty payload lets navigate() perform Next's hard-reload
        // recovery instead of surfacing an unhandled JSON parse rejection.
      }
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    });
    inFlightPageData.set(dataHref, dataRequest);
    const clearRequest = () => {
      if (inFlightPageData.get(dataHref) === dataRequest) {
        inFlightPageData.delete(dataHref);
      }
    };
    void dataRequest.then(clearRequest, clearRequest);
  }

  const [data, pageModule] = await Promise.all([
    dataRequest,
    loader() as Promise<unknown> as Promise<PageModule>,
  ]);

  if (!data.ok && data.status !== 404) return { failed: true as const };
  routerDataCache[new URL(dataHref, window.location.href).href] = data.payload;

  return { match, pageModule, payload: data.payload };
}

interface ActiveNavigation {
  eventUrl: string;
  shallow: boolean;
  cancelled: boolean;
}

let activeNavigation: ActiveNavigation | null = null;

function cancelActiveNavigation() {
  if (!activeNavigation) return;
  activeNavigation.cancelled = true;
  const error = Object.assign(new Error("Route Cancelled"), {
    cancelled: true,
  });
  Router.events.emit("routeChangeError", error, activeNavigation.eventUrl, {
    shallow: activeNavigation.shallow,
  });
  activeNavigation = null;
}

async function navigate(
  href: string,
  mode: "push" | "replace",
  options: TransitionOptions = {},
  sourceHref = href,
  hardReloadOnFailure = true,
): Promise<boolean> {
  if (
    !isSafeClientNavigationTarget(href) ||
    !isSafeClientNavigationTarget(sourceHref)
  ) {
    return false;
  }
  // Resolve relative and hash-only hrefs against the route-space location so
  // basePath is never doubled when re-prefixing for the browser URL.
  const routeSpaceBase = new URL(
    `${stripBasePath(window.location.pathname, basePath)}${window.location.search}${window.location.hash}`,
    window.location.href,
  );
  const url = new URL(href, routeSpaceBase);
  const sourceUrl = new URL(
    sourceHref.includes("[") ? href : sourceHref,
    routeSpaceBase,
  );
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return false;
  }
  const browserHref = `${addBasePath(url.pathname, basePath)}${url.search}${url.hash}`;
  const browserUrl = new URL(browserHref, window.location.href);
  const eventUrl = browserHref;
  const shallow = options.shallow ?? false;

  if (
    browserUrl.pathname === window.location.pathname &&
    url.search === window.location.search
  ) {
    if (url.hash) {
      const state = {
        url: `${sourceUrl.pathname}${sourceUrl.search}${url.hash}`,
        as: `${url.pathname}${url.search}${url.hash}`,
        options: {},
        __N: true,
        key: "",
      };
      Router.events.emit("hashChangeStart", eventUrl, { shallow });
      if (mode === "replace") window.history.replaceState(state, "", browserUrl);
      else window.history.pushState(state, "", browserUrl);
      document.querySelector(url.hash)?.scrollIntoView();
      Router.events.emit("hashChangeComplete", eventUrl, { shallow });
      return true;
    }
    // Same asPath with a (possibly) different route: replace the current
    // history entry instead of pushing a duplicate, like Next.js.
    mode = "replace";
  }

  cancelActiveNavigation();
  const navigation: ActiveNavigation = {
    eventUrl,
    shallow,
    cancelled: false,
  };
  activeNavigation = navigation;

  Router.events.emit("routeChangeStart", eventUrl, { shallow });

  try {
    const loaded = await loadNavigation(sourceUrl);
    if (navigation.cancelled) return false;
    if (loaded && "failed" in loaded) {
      if (activeNavigation === navigation) activeNavigation = null;
      const error = new Error("Failed to load static props");
      Router.events.emit("routeChangeError", error, eventUrl, { shallow });
      if (hardReloadOnFailure) window.location.assign(browserUrl.href);
      return false;
    }
    if (!loaded) {
      if (activeNavigation === navigation) activeNavigation = null;
      if (hardReloadOnFailure) window.location.assign(browserUrl.href);
      return false;
    }

    if (loaded.payload.__N_REDIRECT) {
      if (activeNavigation === navigation) activeNavigation = null;
      if (isSafeClientNavigationTarget(loaded.payload.__N_REDIRECT)) {
        window.location.assign(loaded.payload.__N_REDIRECT);
      }
      return false;
    }

    Router.events.emit("beforeHistoryChange", eventUrl, { shallow });
    const historyState = {
      url: `${sourceUrl.pathname}${sourceUrl.search}`,
      as: `${url.pathname}${url.search}${url.hash}`,
      options: {},
      __N: true,
      key: "",
    };
    if (mode === "replace") {
      window.history.replaceState(historyState, "", browserUrl);
    } else {
      window.history.pushState(historyState, "", browserUrl);
    }

    const notFound = loaded.payload.notFound === true;
    const notFoundLoader = pageLoaders["/404"];
    const nextPageModule = notFound
      ? notFoundLoader
        ? ((await notFoundLoader()) as unknown as PageModule)
        : ({ default: DefaultNotFound } satisfies PageModule)
      : loaded.pageModule;
    const pageProps = notFound
      ? { statusCode: 404 }
      : loaded.payload.pageProps ?? {};
    const route = notFound ? "/404" : loaded.match.route.route;
    const appProps = { ...loaded.payload } as Record<string, unknown>;
    delete appProps.pageProps;
    delete appProps.notFound;
    delete appProps.__N_REDIRECT;
    delete appProps.__N_REDIRECT_STATUS;
    applyRouterState(url, route, loaded.match.params);
    if (App) {
      root.render(App, {
        ...appProps,
        Component: nextPageModule.default,
        pageProps,
        router: Router,
      });
    } else {
      root.render(nextPageModule.default, pageProps);
    }

    window.__NEXT_DATA__ = {
      ...(window.__NEXT_DATA__ as NextaneData),
      page: route,
      query: queryFromUrl(url, loaded.match.params),
      props: { ...appProps, pageProps },
    };

    if (options.scroll !== false) window.scrollTo({ top: 0, left: 0 });
    if (activeNavigation === navigation) activeNavigation = null;
    Router.events.emit("routeChangeComplete", eventUrl, { shallow });
    return true;
  } catch (error) {
    if (activeNavigation === navigation) activeNavigation = null;
    Router.events.emit("routeChangeError", error, eventUrl, { shallow });
    throw error;
  }
}

configureClientRouter({
  navigate,
  async prefetch(href) {
    if (!isSafeClientNavigationTarget(href)) return;
    const url = new URL(
      href,
      new URL(
        stripBasePath(window.location.pathname, basePath),
        window.location.href,
      ),
    );
    await loadNavigation(url);
  },
});

(Router as typeof Router & { sdc: Record<string, PageDataPayload> }).sdc =
  routerDataCache;
window.next = { router: Router };

queueMicrotask(() => {
  window.__NEXT_HYDRATED = true;
  window.__NEXT_HYDRATED_CB?.();
});

setTimeout(() => {
  const currentPath = `${stripBasePath(window.location.pathname, basePath)}${window.location.search}${window.location.hash}`;
  if (initialData.isFallback) {
    void navigate(
      currentPath,
      "replace",
      { scroll: false },
      initialData.resolvedPath ?? currentPath,
      false,
    );
    return;
  }
  if (initialData.gsp) {
    const match = matchRoute(routes, stripBasePath(initialUrl.pathname, basePath));
    if (match) {
      applyRouterState(initialUrl, match.route.route, match.params);
      if (App) {
        root.render(App, {
          ...initialData.props,
          Component: initialPageModule.default,
          pageProps: initialProps,
          router: Router,
        });
      } else {
        root.render(initialPageModule.default, initialProps);
      }
    }
  }
}, 0);

window.addEventListener("popstate", (event) => {
  const state = event.state as
    | { url?: string; as?: string; __N?: boolean }
    | null;
  const currentPath = `${stripBasePath(window.location.pathname, basePath)}${window.location.search}${window.location.hash}`;
  if (state?.__N && typeof state.url === "string") {
    void navigate(state.as ?? currentPath, "replace", { scroll: false }, state.url);
    return;
  }
  void navigate(currentPath, "replace", { scroll: false });
});

document.documentElement.dataset.nextaneHydrated = "true";
window.dispatchEvent(new Event("nextane:hydrated"));
