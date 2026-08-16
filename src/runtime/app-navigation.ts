import { useRouter as usePagesRouter } from "./router";
import type { ParsedUrlQuery } from "../types";

/**
 * Pages Router-compatible subset of `next/navigation`.
 *
 * These App Router hooks are also importable from Pages Router pages. Next
 * mounts them on top of the Pages Router: the layout-segment hooks have no
 * app segments to report and therefore return their empty constants, while
 * `usePathname`/`useSearchParams`/`useParams`/`useRouter` adapt the singleton
 * Pages Router. They are built on the reactive `useRouter` so they re-render on
 * client navigation and remain safe during server rendering.
 */

/** Always `null` in the Pages Router — there are no App Router layout segments. */
export function useSelectedLayoutSegment(): string | null {
  return null;
}

/** Always empty in the Pages Router — there are no App Router layout segments. */
export function useSelectedLayoutSegments(): string[] {
  return [];
}

/** The current URL pathname with the query string and hash removed. */
export function usePathname(): string | null {
  const router = usePagesRouter();
  if (router.pathname.includes("[") && router.isFallback) return null;
  try {
    return new URL(router.asPath, "http://n").pathname;
  } catch {
    // Matches Next's fallback for invalid asPath values such as "//".
    return "/";
  }
}

/** The current query string as `URLSearchParams`. Empty until the router is ready. */
export function useSearchParams(): URLSearchParams {
  const router = usePagesRouter();
  if (!router.isReady || !router.query) return new URLSearchParams();
  try {
    return new URL(router.asPath, "http://n").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** The current dynamic route params, or `null` before the router is ready. */
export function useParams(): ParsedUrlQuery | null {
  const router = usePagesRouter();
  if (!router.isReady || !router.query) return null;
  const params: ParsedUrlQuery = {};
  for (const key of dynamicRouteParamKeys(router.pathname)) {
    const value = router.query[key];
    if (value !== undefined) params[key] = value;
  }
  return params;
}

export interface AppRouterInstance {
  back(): void;
  forward(): void;
  refresh(): void;
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  prefetch(href: string): void;
}

/** An App Router-shaped adapter over the singleton Pages Router. */
export function useRouter(): AppRouterInstance {
  const router = usePagesRouter();
  return {
    back() {
      router.back();
    },
    forward() {
      if (typeof window !== "undefined") window.history.forward();
    },
    refresh() {
      router.reload();
    },
    push(href, options) {
      void router.push(href, undefined, { scroll: options?.scroll });
    },
    replace(href, options) {
      void router.replace(href, undefined, { scroll: options?.scroll });
    },
    prefetch(href) {
      void router.prefetch(href);
    },
  };
}

/** Extract `[param]`, `[...param]`, and `[[...param]]` names from a route. */
function dynamicRouteParamKeys(route: string): string[] {
  const keys: string[] = [];
  const pattern = /\[\[?\.{0,3}([^\]/]+?)\]?\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(route)) !== null) keys.push(match[1]);
  return keys;
}
