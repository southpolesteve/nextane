import { describe, expect, it, vi } from "vitest";
import Router, {
  events,
  formatRouterHref,
  setRouterState,
} from "../../src/runtime/router";

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
});
