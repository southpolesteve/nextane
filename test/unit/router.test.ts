import { createElement, use } from "octane";
import { prerender } from "octane/static";
import { describe, expect, it, vi } from "vitest";
import Router, {
  configureClientRouter,
  events,
  formatRouterHref,
  setRouterState,
  useRouter,
} from "../../src/runtime/router";
import { isSafeClientNavigationTarget } from "../../src/runtime/navigation";
import {
  runWithServerRouterState,
} from "../../src/runtime/router-server";

function state(route: string, asPath: string, trailingSlash = false) {
  setRouterState({
    route,
    pathname: route,
    query: {},
    asPath,
    basePath: "",
    isReady: true,
    isPreview: false,
    isFallback: false,
    trailingSlash,
  });
}

describe("Pages Router URL and event compatibility", () => {
  it("interpolates query-only URLs when the visible path matches the dynamic route", () => {
    state("/posts/[id]", "/posts/one");

    expect(formatRouterHref("?id=two")).toBe("/posts/two");
    expect(formatRouterHref({ query: { id: "three", view: "full" } })).toBe(
      "/posts/three?view=full",
    );
  });

  it("preserves the visible URL when a rewrite hides another route shape", () => {
    state("/internal/[id]/page", "/public/one");

    expect(formatRouterHref("?id=two")).toBe("?id=two");
    expect(formatRouterHref({ query: { id: "two" } })).toBe(
      "/public/one?id=two",
    );
  });

  it("supports the deprecated route-change callback alongside Router.events", () => {
    const modern = vi.fn();
    const legacy = vi.fn();
    events.on("routeChangeComplete", modern);
    Router.onRouteChangeComplete = legacy;

    events.emit("routeChangeComplete", "/next");

    expect(modern).toHaveBeenCalledWith("/next");
    expect(legacy).toHaveBeenCalledWith("/next");
    events.off("routeChangeComplete", modern);
    Router.onRouteChangeComplete = null;
  });

  it("normalizes internal links according to trailingSlash without rewriting files or external URLs", () => {
    state("/about", "/about/", true);

    expect(formatRouterHref("/about?hello=world")).toBe(
      "/about/?hello=world",
    );
    expect(formatRouterHref("/catch-all/hello.world/")).toBe(
      "/catch-all/hello.world",
    );
    expect(formatRouterHref("https://nextjs.org/")).toBe(
      "https://nextjs.org/",
    );

    state("/about", "/about", false);
    expect(formatRouterHref("/about/?hello=world")).toBe(
      "/about?hello=world",
    );
  });

  it("interpolates dynamic string hrefs from their query parameters", () => {
    state("/", "/", false);

    expect(formatRouterHref("/lang/[lang]/about?lang=en")).toBe(
      "/lang/en/about",
    );
    expect(formatRouterHref("/docs/[...slug]?slug=one&slug=two&view=full")).toBe(
      "/docs/one/two?view=full",
    );
    expect(formatRouterHref("/blog/[post]")).toBe("/blog/[post]");
  });

  it("blocks executable and browser-obfuscated navigation schemes", async () => {
    const navigate = vi.fn(async () => true);
    configureClientRouter({
      navigate,
      prefetch: async () => {},
    });

    for (const target of [
      "javascript:alert(1)",
      " JAVA\nSCRIPT:alert(1)",
      "\u0000java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      expect(isSafeClientNavigationTarget(target)).toBe(false);
      expect(await Router.push(target)).toBe(false);
      expect(await Router.replace("/safe", target)).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();

    for (const target of [
      "/internal?hello=world",
      "https://example.com/path",
      "http://example.com/path",
      "mailto:test@example.com",
      "tel:+15555550123",
    ]) {
      expect(isSafeClientNavigationTarget(target)).toBe(true);
    }
    expect(await Router.push("/safe")).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      "/safe",
      "push",
      undefined,
      "/safe",
    );
  });

  it("isolates router state across deterministically overlapping SSR renders", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const makeState = (asPath: string) => ({
      route: "/posts/[id]",
      pathname: "/posts/[id]",
      query: { id: asPath.slice(1) },
      asPath,
      basePath: "",
      isReady: true,
      isPreview: false,
      isFallback: false,
      trailingSlash: false,
    });

    const first = runWithServerRouterState(makeState("/first"), async () => {
      firstStarted();
      await firstGate;
      return { asPath: Router.asPath, query: Router.query };
    });
    await started;
    const second = runWithServerRouterState(makeState("/second"), async () => {
      expect(Router.asPath).toBe("/second");
      releaseFirst();
      await Promise.resolve();
      return { asPath: Router.asPath, query: Router.query };
    });

    await expect(first).resolves.toEqual({
      asPath: "/first",
      query: { id: "first" },
    });
    await expect(second).resolves.toEqual({
      asPath: "/second",
      query: { id: "second" },
    });
  });

  it("provides request-local router state through suspended Octane renders", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const makeState = (asPath: string, isFallback: boolean) => ({
      route: "/posts/[id]",
      pathname: "/posts/[id]",
      query: { id: asPath.slice(1) },
      asPath,
      basePath: "",
      isReady: true,
      isPreview: false,
      isFallback,
      trailingSlash: false,
    });
    function Probe({ gate }: { gate: Promise<void> }) {
      use(gate);
      const router = useRouter();
      return createElement(
        "p",
        {},
        `${router.asPath}:${router.query.id}:${router.isFallback}`,
      );
    }
    const render = (
      routerState: ReturnType<typeof makeState>,
      gate: Promise<void>,
    ) =>
      runWithServerRouterState(routerState, () =>
        prerender(Probe as never, { gate }),
      );

    const first = render(makeState("/first", true), firstGate);
    const second = render(makeState("/second", false), secondGate);
    releaseSecond();
    expect((await second).html).toContain("<p>/second:second:false</p>");
    releaseFirst();
    expect((await first).html).toContain("<p>/first:first:true</p>");
  });
});

describe("withLocalePrefix", () => {
  it("prefixes non-default locales and leaves the default unprefixed", async () => {
    const { withLocalePrefix } = await import("../../src/runtime/navigation");
    // No i18n configured (defaultLocale undefined) -> unchanged.
    expect(withLocalePrefix("/foo", undefined, undefined, undefined)).toBe(
      "/foo",
    );
    // Explicit non-default locale prop.
    expect(withLocalePrefix("/to-new", "nl", "en", "en")).toBe("/nl/to-new");
    // Explicit default locale stays unprefixed.
    expect(withLocalePrefix("/to-new", "en", "en", "en")).toBe("/to-new");
    // No prop -> current locale (non-default) prefixes.
    expect(withLocalePrefix("/dynamic/1", undefined, "de", "default")).toBe(
      "/de/dynamic/1",
    );
    // locale: false opts out.
    expect(withLocalePrefix("/x", false, "de", "default")).toBe("/x");
    // Root href.
    expect(withLocalePrefix("/", "de", "default", "default")).toBe("/de");
    // Query/hash preserved.
    expect(withLocalePrefix("/p?a=1#h", "de", "en", "en")).toBe(
      "/de/p?a=1#h",
    );
    // External/relative untouched.
    expect(withLocalePrefix("https://x/y", "de", "en", "en")).toBe(
      "https://x/y",
    );
    // Protocol-relative external hrefs are left alone (not turned into
    // `/de//cdn.example.com/x`).
    expect(withLocalePrefix("//cdn.example.com/x", "de", "en", "en")).toBe(
      "//cdn.example.com/x",
    );
  });
});

describe("next/navigation compatibility", () => {
  it("segment hooks return the Pages Router constants", async () => {
    const { useSelectedLayoutSegment, useSelectedLayoutSegments } =
      await import("../../src/runtime/app-navigation");
    expect(useSelectedLayoutSegment()).toBe(null);
    expect(useSelectedLayoutSegments()).toEqual([]);
  });

  it("usePathname strips query and hash from the current URL", async () => {
    const { usePathname } = await import("../../src/runtime/app-navigation");
    setRouterState({
      route: "/blog/[slug]",
      pathname: "/blog/[slug]",
      query: { slug: "hi" },
      asPath: "/blog/hi?ref=1#frag",
      basePath: "",
      isReady: true,
      isPreview: false,
      isFallback: false,
    });
    expect(usePathname()).toBe("/blog/hi");
  });

  it("usePathname returns null for a dynamic route while falling back", async () => {
    const { usePathname } = await import("../../src/runtime/app-navigation");
    setRouterState({
      route: "/blog/[slug]",
      pathname: "/blog/[slug]",
      query: {},
      asPath: "/blog/[slug]",
      basePath: "",
      isReady: false,
      isPreview: false,
      isFallback: true,
    });
    expect(usePathname()).toBe(null);
  });

  it("useSearchParams reflects the current query and is empty before ready", async () => {
    const { useSearchParams } = await import("../../src/runtime/app-navigation");
    setRouterState({
      route: "/",
      pathname: "/",
      query: { a: "1", b: "2" },
      asPath: "/?a=1&b=2",
      basePath: "",
      isReady: true,
      isPreview: false,
      isFallback: false,
    });
    expect(useSearchParams().get("a")).toBe("1");
    expect(useSearchParams().get("b")).toBe("2");

    setRouterState({
      route: "/",
      pathname: "/",
      query: {},
      asPath: "/?a=1",
      basePath: "",
      isReady: false,
      isPreview: false,
      isFallback: false,
    });
    expect(useSearchParams().toString()).toBe("");
  });

  it("useParams extracts dynamic route params", async () => {
    const { useParams } = await import("../../src/runtime/app-navigation");
    setRouterState({
      route: "/[slug]/about",
      pathname: "/[slug]/about",
      query: { slug: "blog", extra: "ignored" },
      asPath: "/blog/about",
      basePath: "",
      isReady: true,
      isPreview: false,
      isFallback: false,
    });
    expect(useParams()).toEqual({ slug: "blog" });

    setRouterState({
      route: "/[slug]/about",
      pathname: "/[slug]/about",
      query: {},
      asPath: "/blog/about",
      basePath: "",
      isReady: false,
      isPreview: false,
      isFallback: false,
    });
    expect(useParams()).toBe(null);
  });

  it("useRouter adapts navigation onto the singleton Pages Router", async () => {
    const { useRouter: useAppRouter } = await import(
      "../../src/runtime/app-navigation"
    );
    const navigate = vi.fn(async () => true);
    configureClientRouter({ navigate, prefetch: async () => {} });
    setRouterState({
      route: "/",
      pathname: "/",
      query: {},
      asPath: "/",
      basePath: "",
      isReady: true,
      isPreview: false,
      isFallback: false,
    });
    const appRouter = useAppRouter();
    await appRouter.push("/next");
    expect(navigate).toHaveBeenCalledWith(
      "/next",
      "push",
      { scroll: undefined },
      "/next",
    );
  });
});
