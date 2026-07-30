import { hydrateRoot, type ComponentBody, type Root } from "octane";
import {
  appLoader,
  pageLoaders,
  routes,
} from "virtual:nextane-client-manifest";
import { matchRoute } from "./routing/match";
import Router, {
  configureClientRouter,
  setRouterState,
} from "./runtime/router";
import { DefaultNotFound } from "./runtime/default-error";
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
    asPath: `${url.pathname}${url.search}${url.hash}`,
    basePath: "",
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
  asPath: `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`,
  basePath: "",
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
  return `/_next/data/${buildId}${pathname}.json${url.search}`;
}

async function loadNavigation(url: URL) {
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

  if (!data.ok && data.status !== 404) return null;
  routerDataCache[new URL(dataHref, window.location.href).href] = data.payload;

  return { match, pageModule, payload: data.payload };
}

async function navigate(
  href: string,
  mode: "push" | "replace",
  options: TransitionOptions = {},
  sourceHref = href,
  hardReloadOnFailure = true,
): Promise<boolean> {
  const url = new URL(href, window.location.href);
  const sourceUrl = new URL(
    sourceHref.includes("[") ? href : sourceHref,
    window.location.href,
  );
  const eventUrl = `${url.pathname}${url.search}${url.hash}`;
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return false;
  }

  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    if (url.hash) {
      Router.events.emit("hashChangeStart", eventUrl, { shallow: options.shallow ?? false });
      if (mode === "replace") window.history.replaceState({}, "", url);
      else window.history.pushState({}, "", url);
      document.querySelector(url.hash)?.scrollIntoView();
      Router.events.emit("hashChangeComplete", eventUrl, { shallow: options.shallow ?? false });
      return true;
    }
  }

  Router.events.emit("routeChangeStart", eventUrl, {
    shallow: options.shallow ?? false,
  });

  try {
    const loaded = await loadNavigation(sourceUrl);
    if (!loaded) {
      if (hardReloadOnFailure) window.location.assign(url.href);
      return false;
    }

    if (loaded.payload.__N_REDIRECT) {
      window.location.assign(loaded.payload.__N_REDIRECT);
      return false;
    }

    Router.events.emit("beforeHistoryChange", eventUrl, {
      shallow: options.shallow ?? false,
    });
    if (mode === "replace") window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);

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
    Router.events.emit("routeChangeComplete", eventUrl, {
      shallow: options.shallow ?? false,
    });
    return true;
  } catch (error) {
    Router.events.emit("routeChangeError", error, eventUrl, {
      shallow: options.shallow ?? false,
    });
    throw error;
  }
}

configureClientRouter({
  navigate,
  async prefetch(href) {
    const url = new URL(href, window.location.href);
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
  if (initialData.isFallback) {
    void navigate(
      window.location.href,
      "replace",
      { scroll: false },
      initialData.resolvedPath ?? window.location.href,
      false,
    );
    return;
  }
  if (initialData.gsp) {
    const match = matchRoute(routes, initialUrl.pathname);
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

window.addEventListener("popstate", () => {
  void navigate(window.location.href, "replace", { scroll: false });
});

document.documentElement.dataset.nextaneHydrated = "true";
window.dispatchEvent(new Event("nextane:hydrated"));
