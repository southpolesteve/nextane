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
