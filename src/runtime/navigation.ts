const UNSAFE_NAVIGATION_SCHEMES = new Set([
  "data",
  "javascript",
  "vbscript",
]);

/**
 * Extract a URL scheme after ignoring ASCII controls and whitespace. Removing
 * those characters inside the would-be scheme also catches browser-normalized
 * variants such as `java\nscript:`.
 */
function normalizedScheme(value: string): string | null {
  const candidate = value.replace(/^[\u0000-\u0020\u007f-\u009f]+/, "");
  const colon = candidate.indexOf(":");
  if (colon < 0) return null;
  const prefix = candidate
    .slice(0, colon)
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  return /^[a-z][a-z0-9+.-]*$/i.test(prefix) ? prefix.toLowerCase() : null;
}

export function isSafeClientNavigationTarget(value: string): boolean {
  const scheme = normalizedScheme(value);
  return scheme === null || !UNSAFE_NAVIGATION_SCHEMES.has(scheme);
}

export function hasBasePath(pathname: string, basePath: string): boolean {
  if (!basePath) return false;
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function stripBasePath(pathname: string, basePath: string): string {
  if (!hasBasePath(pathname, basePath)) return pathname;
  return pathname.slice(basePath.length) || "/";
}

/**
 * Prefix a route-space path with the basePath. Deliberately NOT idempotent,
 * matching Next.js: pushing an already-prefixed path is treated as a route
 * named like the basePath and prefixes again.
 */
export function addBasePath(target: string, basePath: string): string {
  if (!basePath || !target.startsWith("/")) return target;
  const boundary = target.search(/[?#]/);
  const pathname = boundary === -1 ? target : target.slice(0, boundary);
  const suffix = boundary === -1 ? "" : target.slice(boundary);
  return `${pathname === "/" ? basePath : `${basePath}${pathname}`}${suffix}`;
}
