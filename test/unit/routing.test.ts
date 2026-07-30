import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoute } from "../../src/routing/match";
import { scanPages } from "../../src/routing/scan";

describe("Pages Router discovery", () => {
  it("discovers, classifies, and prioritizes familiar page conventions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nextane-routing-"));
    const pages = path.join(root, "pages");
    await mkdir(path.join(pages, "api"), { recursive: true });
    await mkdir(path.join(pages, "posts"), { recursive: true });
    await Promise.all([
      writeFile(path.join(pages, "index.tsrx"), ""),
      writeFile(path.join(pages, "_app.tsrx"), ""),
      writeFile(path.join(pages, "posts", "new.tsrx"), ""),
      writeFile(path.join(pages, "posts", "[slug].tsrx"), ""),
      writeFile(path.join(pages, "api", "hello.ts"), ""),
    ]);

    const routes = await scanPages(root);
    expect(routes.map(({ route, kind }) => [route, kind])).toEqual([
      ["/", "page"],
      ["/api/hello", "api"],
      ["/posts/new", "page"],
      ["/posts/[slug]", "page"],
    ]);
  });

  it("matches dynamic, catch-all, optional catch-all, and decoded params", () => {
    const routes = [
      {
        route: "/posts/[slug]",
        regexSource: "^/posts/([^/]+)/?$",
        params: [{ name: "slug", kind: "single" as const }],
      },
      {
        route: "/docs/[...parts]",
        regexSource: "^/docs/(.+)/?$",
        params: [{ name: "parts", kind: "catchAll" as const }],
      },
      {
        route: "/shop/[[...parts]]",
        regexSource: "^/shop(?:/(.*))?/?$",
        params: [{ name: "parts", kind: "optionalCatchAll" as const }],
      },
    ];

    expect(matchRoute(routes, "/posts/hello%20octane")?.params).toEqual({
      slug: "hello octane",
    });
    expect(matchRoute(routes, "/docs/a/b")?.params).toEqual({
      parts: ["a", "b"],
    });
    expect(matchRoute(routes, "/shop")?.params).toEqual({});
  });
});
