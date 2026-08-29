import { describe, expect, it } from "vitest";
import {
  evaluateRuleConditions,
  matchRuleSource,
  substituteDestination,
  type RuleRequestContext,
} from "../../src/server/route-rules";

function ctx(url: string, headers: Record<string, string> = {}): RuleRequestContext {
  return { url: new URL(url), headers: new Headers(headers), cookies: {} };
}

describe("route-rules source matching", () => {
  it("matches the bare parent path for optional and catch-all params", () => {
    // path-to-regexp folds the delimiter into the optional group, so the
    // section root matches with the param absent.
    expect(matchRuleSource("/blog/:slug*", "/blog")).toEqual({ slug: "" });
    expect(matchRuleSource("/blog/:slug*", "/blog/a/b")).toEqual({ slug: "a/b" });
    expect(matchRuleSource("/post/:id?", "/post")).toEqual({ id: "" });
    expect(matchRuleSource("/post/:id?", "/post/7")).toEqual({ id: "7" });
    expect(matchRuleSource("/:lang?/blog", "/blog")).toEqual({ lang: "" });
    expect(matchRuleSource("/:lang?/blog", "/en/blog")).toEqual({ lang: "en" });
    // `+` still requires at least one segment.
    expect(matchRuleSource("/blog/:slug+", "/blog")).toBe(null);
    expect(matchRuleSource("/blog/:slug+", "/blog/a")).toEqual({ slug: "a" });
  });

  it("folds the delimiter out of the destination for an absent catch-all param", () => {
    expect(substituteDestination("/news/:slug*", { slug: "" })).toBe("/news");
    expect(substituteDestination("/news/:slug*", { slug: "a/b" })).toBe("/news/a/b");
    expect(substituteDestination("/x/:rest*", { rest: "" })).toBe("/x");
    expect(substituteDestination("/x/:rest*", { rest: "a" })).toBe("/x/a");
  });
});

describe("route-rules has conditions", () => {
  it("exposes a value-less matched condition value under its key", () => {
    expect(
      evaluateRuleConditions(
        { has: [{ type: "header", key: "tenant" }] },
        ctx("https://x/p", { tenant: "acme" }),
      ),
    ).toEqual({ tenant: "acme" });
  });

  it("evaluates a repeated query parameter by its last value only", () => {
    // Next tests only the last value; a matching earlier value must not pass.
    expect(
      evaluateRuleConditions(
        { has: [{ type: "query", key: "role", value: "admin" }] },
        ctx("https://x/x?role=admin&role=user"),
      ),
    ).toBe(null);
    expect(
      evaluateRuleConditions(
        { has: [{ type: "query", key: "role", value: "admin" }] },
        ctx("https://x/x?role=user&role=admin"),
      ),
    ).toEqual({});
  });
});
