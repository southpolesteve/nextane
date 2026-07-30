import { readdir } from "node:fs/promises";
import path from "node:path";
import type { RouteParam, ScannedRoute } from "./types.ts";

const PAGE_EXTENSIONS = new Set([".tsrx", ".tsx", ".jsx", ".ts", ".js"]);
const SPECIAL_PAGES = new Set(["/_app", "/_document", "/_error"]);

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(filePath);
      if (!entry.isFile() || !PAGE_EXTENSIONS.has(path.extname(entry.name))) return [];
      if (entry.name.endsWith(".d.ts")) return [];
      return [filePath];
    }),
  );
  return nested.flat();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSegment(segment: string, params: RouteParam[]): { regex: string; score: number } {
  const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(segment);
  if (optionalCatchAll) {
    params.push({ name: optionalCatchAll[1], kind: "optionalCatchAll" });
    return { regex: "(?:/(.*))?", score: 0 };
  }

  const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
  if (catchAll) {
    params.push({ name: catchAll[1], kind: "catchAll" });
    return { regex: "/(.+)", score: 1 };
  }

  const dynamic = /^\[(.+)\]$/.exec(segment);
  if (dynamic) {
    params.push({ name: dynamic[1], kind: "single" });
    return { regex: "/([^/]+)", score: 2 };
  }

  return { regex: `/${escapeRegex(segment)}`, score: 3 };
}

function fileToRoute(pagesDirectory: string, filePath: string): ScannedRoute | null {
  const relative = path.relative(pagesDirectory, filePath);
  const withoutExtension = relative.slice(0, -path.extname(relative).length);
  const sourceSegments = withoutExtension.split(path.sep);
  const isIndex = sourceSegments.at(-1) === "index";
  const routeSegments = isIndex ? sourceSegments.slice(0, -1) : sourceSegments;
  const route = `/${routeSegments.join("/")}` || "/";

  if (SPECIAL_PAGES.has(route)) return null;

  const params: RouteParam[] = [];
  const score: number[] = [];
  let regex = "^";
  for (const segment of routeSegments) {
    const parsed = parseSegment(segment, params);
    regex += parsed.regex;
    score.push(parsed.score);
  }
  regex += route === "/" ? "/?$" : "/?$";

  return {
    kind: route === "/api" || route.startsWith("/api/") ? "api" : "page",
    route,
    filePath,
    regexSource: regex,
    params,
    score,
  };
}

function compareRoutes(left: ScannedRoute, right: ScannedRoute): number {
  const max = Math.max(left.score.length, right.score.length);
  for (let index = 0; index < max; index += 1) {
    const leftScore = left.score[index] ?? 4;
    const rightScore = right.score[index] ?? 4;
    if (leftScore !== rightScore) return rightScore - leftScore;
  }
  return left.route.localeCompare(right.route);
}

export async function scanPages(root: string): Promise<ScannedRoute[]> {
  const pagesDirectory = path.join(root, "pages");
  const files = await walk(pagesDirectory);
  return files
    .map((filePath) => fileToRoute(pagesDirectory, filePath))
    .filter((route): route is ScannedRoute => route !== null)
    .sort(compareRoutes);
}

export async function findSpecialPage(root: string, name: "_app" | "_document" | "_error") {
  const pagesDirectory = path.join(root, "pages");
  const files = await walk(pagesDirectory);
  return files.find((filePath) => {
    const relative = path.relative(pagesDirectory, filePath);
    const withoutExtension = relative.slice(0, -path.extname(relative).length);
    return withoutExtension === name;
  });
}
