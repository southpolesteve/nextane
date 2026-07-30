import { createElement, useSyncExternalStore } from "octane";
import type {
  NextaneRouter,
  ParsedUrlQuery,
  TransitionOptions,
  UrlObject,
} from "../types";

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

function formatUrlObject(value: UrlObject): string {
  const current = new URL(runtime.state.asPath, "https://nextane.local");
  const query = { ...(value.query ?? {}) };
  let pathname = value.pathname ?? current.pathname;

  if (
    !value.pathname &&
    routeMatchesVisiblePath(runtime.state.route, current.pathname)
  ) {
    pathname = runtime.state.route.replace(
      /\[([^\]]+)\]/g,
      (segment, name: string) => {
        const replacement = query[name];
        if (
          replacement === undefined ||
          Array.isArray(replacement)
        ) {
          return segment;
        }
        delete query[name];
        return encodeURIComponent(String(replacement));
      },
    );
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
  const fileLike = /\/[^/]+\.[^/]+\/?$/.test(pathname);
  const normalized =
    runtime.state.trailingSlash && !fileLike
      ? pathname.endsWith("/")
        ? pathname
        : `${pathname}/`
      : pathname.replace(/\/+$/, "");
  return `${normalized}${suffix}`;
}

export function formatRouterHref(value: UrlObject | string): string {
  if (typeof value !== "string") return formatUrlObject(value);
  if (
    value.startsWith("?") &&
    routeMatchesVisiblePath(
      runtime.state.route,
      new URL(runtime.state.asPath, "https://nextane.local").pathname,
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
    return runtime.state.route;
  },
  get pathname() {
    return runtime.state.pathname;
  },
  get query() {
    return runtime.state.query;
  },
  get asPath() {
    return runtime.state.asPath;
  },
  get basePath() {
    return runtime.state.basePath;
  },
  get isReady() {
    return runtime.state.isReady;
  },
  get isPreview() {
    return runtime.state.isPreview;
  },
  get isFallback() {
    return runtime.state.isFallback;
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
    if (!runtime.navigate) {
      if (typeof window !== "undefined") window.location.assign(destination);
      return false;
    }
    return runtime.navigate(destination, "push", options, href);
  },
  async replace(url, as, options) {
    const href = formatRouterHref(url);
    const destination = as ? formatRouterHref(as) : href;
    if (!runtime.navigate) {
      if (typeof window !== "undefined") window.location.replace(destination);
      return false;
    }
    return runtime.navigate(destination, "replace", options, href);
  },
  async prefetch(url) {
    await runtime.prefetchRoute?.(formatRouterHref(url));
  },
  back() {
    if (typeof window !== "undefined") window.history.back();
  },
  reload() {
    if (typeof window !== "undefined") window.location.reload();
  },
};

export function useRouter(): NextaneRouter {
  // SSR reads the request-scoped state already installed by the page render.
  // Calling Octane's client hook from an uncompiled helper module has no active
  // hook frame on the server; the subscription is only needed after hydration.
  if (typeof window !== "undefined") {
    useSyncExternalStore(
      subscribe,
      () => runtime.state,
      () => runtime.state,
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
