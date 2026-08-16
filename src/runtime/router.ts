import {
  createElement,
  useSyncExternalStore,
} from "octane";
import type {
  NextaneRouter,
  ParsedUrlQuery,
  TransitionOptions,
  UrlObject,
} from "../types";
import { isSafeClientNavigationTarget } from "./navigation";

type RouterEvent =
  | "routeChangeStart"
  | "beforeHistoryChange"
  | "routeChangeComplete"
  | "routeChangeError"
  | "hashChangeStart"
  | "hashChangeComplete";

type RouterEventHandler = (...args: unknown[]) => void;

class RouterEvents {
  readonly #handlers = new Map<RouterEvent, Set<RouterEventHandler>>();

  on(event: RouterEvent, handler: RouterEventHandler) {
    const handlers = this.#handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(event, handlers);
  }

  off(event: RouterEvent, handler: RouterEventHandler) {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event: RouterEvent, ...args: unknown[]) {
    for (const handler of this.#handlers.get(event) ?? []) handler(...args);
  }
}

export interface RouterState {
  route: string;
  pathname: string;
  query: ParsedUrlQuery;
  asPath: string;
  basePath: string;
  locale?: string;
  locales?: string[];
  defaultLocale?: string;
  isReady: boolean;
  isPreview: boolean;
  isFallback: boolean;
  trailingSlash?: boolean;
}

type Navigate = (
  url: string,
  mode: "push" | "replace",
  options?: TransitionOptions,
  sourceUrl?: string,
) => Promise<boolean>;

interface RouterRuntimeStore {
  events: RouterEvents;
  listeners: Set<() => void>;
  navigate: Navigate | null;
  prefetchRoute: ((url: string) => Promise<void>) | null;
  legacyRouteChangeComplete: RouterEventHandler | null;
  serverStateProvider?: () => RouterState | undefined;
  state: RouterState;
}

const routerGlobal = globalThis as typeof globalThis & {
  __nextaneRouterRuntime__?: RouterRuntimeStore;
};
const runtime =
  routerGlobal.__nextaneRouterRuntime__ ??
  (routerGlobal.__nextaneRouterRuntime__ = {
    events: new RouterEvents(),
    listeners: new Set(),
    navigate: null,
    prefetchRoute: null,
    legacyRouteChangeComplete: null,
    state: {
      route: "/",
      pathname: "/",
      query: {},
      asPath: "/",
      basePath: "",
      isReady: false,
      isPreview: false,
      isFallback: false,
      trailingSlash: false,
    },
  });
const events = runtime.events;
const listeners = runtime.listeners;

function currentState(): RouterState {
  return runtime.serverStateProvider?.() ?? runtime.state;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function routeMatchesVisiblePath(route: string, pathname: string): boolean {
  const routeParts = route.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (routeParts.length !== pathParts.length) return false;
  return routeParts.every(
    (part, index) =>
      /^\[[^[]+\]$/.test(part) || part === pathParts[index],
  );
}

function interpolateRouteQuery(
  route: string,
  query: NonNullable<UrlObject["query"]>,
): string {
  let result = "";
  let cursor = 0;

  while (cursor < route.length) {
    const opening = route.indexOf("[", cursor);
    if (opening === -1) break;
    const closing = route.indexOf("]", opening + 1);
    if (closing === -1) break;

    result += route.slice(cursor, opening);
    const name = route.slice(opening + 1, closing);
    const replacement = query[name];
    if (replacement === undefined || Array.isArray(replacement)) {
      result += route.slice(opening, closing + 1);
    } else {
      delete query[name];
      result += encodeURIComponent(String(replacement));
    }
    cursor = closing + 1;
  }

  return `${result}${route.slice(cursor)}`;
}

function formatUrlObject(value: UrlObject): string {
  const state = currentState();
  const current = new URL(state.asPath, "https://nextane.local");
  const query = { ...(value.query ?? {}) };
  let pathname = value.pathname ?? current.pathname;

  if (
    !value.pathname &&
    routeMatchesVisiblePath(state.route, current.pathname)
  ) {
    pathname = interpolateRouteQuery(state.route, query);
  }

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) search.append(name, String(item));
    }
  }
  const serialized = search.toString();
  const hash = value.hash
    ? value.hash.startsWith("#")
      ? value.hash
      : `#${value.hash}`
    : "";
  return normalizeTrailingSlash(
    `${pathname}${serialized ? `?${serialized}` : ""}${hash}`,
  );
}

function normalizeTrailingSlash(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /^(?:[a-z]+:)?\/\//i.test(value)
  ) {
    return value;
  }
  const boundary = value.search(/[?#]/);
  const pathname = boundary === -1 ? value : value.slice(0, boundary);
  const suffix = boundary === -1 ? "" : value.slice(boundary);
  if (pathname === "/") return value;
  const segmentEnd = pathname.endsWith("/")
    ? pathname.length - 1
    : pathname.length;
  const segmentStart = pathname.lastIndexOf("/", segmentEnd - 1) + 1;
  const fileLike = pathname.slice(segmentStart, segmentEnd).includes(".");
  let withoutTrailingSlash = pathname;
  while (
    withoutTrailingSlash.length > 1 &&
    withoutTrailingSlash.endsWith("/")
  ) {
    withoutTrailingSlash = withoutTrailingSlash.slice(0, -1);
  }
  const normalized =
    currentState().trailingSlash && !fileLike
      ? pathname.endsWith("/")
        ? pathname
        : `${pathname}/`
      : withoutTrailingSlash;
  return `${normalized}${suffix}`;
}

export function formatRouterHref(value: UrlObject | string): string {
  if (typeof value !== "string") return formatUrlObject(value);
  if (
    value.startsWith("?") &&
    routeMatchesVisiblePath(
      currentState().route,
      new URL(currentState().asPath, "https://nextane.local").pathname,
    )
  ) {
    return formatUrlObject({
      query: Object.fromEntries(new URLSearchParams(value.slice(1))),
    });
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return normalizeTrailingSlash(value);
  }

  const url = new URL(value, "https://nextane.local");
  const interpolated = url.pathname.replace(
    /\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]/g,
    (segment, optionalCatchAll: string, catchAll: string, single: string) => {
      const name = optionalCatchAll ?? catchAll ?? single;
      const values = url.searchParams.getAll(name);
      if (values.length === 0) return segment;
      url.searchParams.delete(name);
      return values
        .flatMap((item) =>
          optionalCatchAll || catchAll ? item.split("/") : [item],
        )
        .map((item) => encodeURIComponent(item))
        .join("/");
    },
  );
  const search = url.searchParams.toString();
  return normalizeTrailingSlash(
    `${interpolated}${search ? `?${search}` : ""}${url.hash}`,
  );
}

export function setRouterState(nextState: RouterState) {
  runtime.state = nextState;
  notify();
}

/** @internal Installed only by the server runtime to provide request-local state. */
export function configureServerRouterStateProvider(
  provider: () => RouterState | undefined,
) {
  runtime.serverStateProvider = provider;
}

export function configureClientRouter(options: {
  navigate: Navigate;
  prefetch: (url: string) => Promise<void>;
}) {
  runtime.navigate = options.navigate;
  runtime.prefetchRoute = options.prefetch;
}

const Router: NextaneRouter & {
  events: RouterEvents;
  onRouteChangeComplete: RouterEventHandler | null;
} = {
  get route() {
    return currentState().route;
  },
  get pathname() {
    return currentState().pathname;
  },
  get query() {
    return currentState().query;
  },
  get asPath() {
    return currentState().asPath;
  },
  get basePath() {
    return currentState().basePath;
  },
  get locale() {
    return currentState().locale;
  },
  get locales() {
    return currentState().locales;
  },
  get defaultLocale() {
    return currentState().defaultLocale;
  },
  get isReady() {
    return currentState().isReady;
  },
  get isPreview() {
    return currentState().isPreview;
  },
  get isFallback() {
    return currentState().isFallback;
  },
  get onRouteChangeComplete() {
    return runtime.legacyRouteChangeComplete;
  },
  set onRouteChangeComplete(handler) {
    if (runtime.legacyRouteChangeComplete) {
      events.off("routeChangeComplete", runtime.legacyRouteChangeComplete);
    }
    runtime.legacyRouteChangeComplete = handler;
    if (handler) events.on("routeChangeComplete", handler);
  },
  events,
  async push(url, as, options) {
    const href = formatRouterHref(url);
    const destination = as ? formatRouterHref(as) : href;
    if (
      !isSafeClientNavigationTarget(href) ||
      !isSafeClientNavigationTarget(destination)
    ) {
      return false;
    }
    if (!runtime.navigate) return false;
    return runtime.navigate(destination, "push", options, href);
  },
  async replace(url, as, options) {
    const href = formatRouterHref(url);
    const destination = as ? formatRouterHref(as) : href;
    if (
      !isSafeClientNavigationTarget(href) ||
      !isSafeClientNavigationTarget(destination)
    ) {
      return false;
    }
    if (!runtime.navigate) return false;
    return runtime.navigate(destination, "replace", options, href);
  },
  async prefetch(url) {
    const href = formatRouterHref(url);
    if (!isSafeClientNavigationTarget(href)) return;
    await runtime.prefetchRoute?.(href);
  },
  back() {
    if (typeof window !== "undefined") window.history.back();
  },
  reload() {
    if (typeof window !== "undefined") window.location.reload();
  },
};

export function useRouter(): NextaneRouter {
  if (typeof window !== "undefined") {
    useSyncExternalStore(
      subscribe,
      currentState,
      currentState,
    );
  }
  return Router;
}

export function withRouter<Props extends Record<string, unknown>>(
  Component: (props: Props & { router: NextaneRouter }) => unknown,
) {
  return function WithRouter(props: Props) {
    return createElement(Component as never, {
      ...props,
      router: useRouter(),
    });
  };
}

export { events };
export default Router;
