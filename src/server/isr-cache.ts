const ISR_CACHE_PREFIX = "/_nextane/isr";

function buildPrefix(buildId: string): string {
  return `${ISR_CACHE_PREFIX}/${encodeURIComponent(buildId)}`;
}

/**
 * Give every deployment a distinct URL in the Workers cache. This uses the
 * default URL cache key instead of `cf.cacheKey`, which is Enterprise-only.
 */
export function namespaceIsrCacheRequest(
  request: Request,
  buildId: string,
): Request {
  const url = new URL(request.url);
  url.pathname = `${buildPrefix(buildId)}${url.pathname}`;
  url.search = "";
  return new Request(url, request);
}

/** Restore the canonical page URL before the cached entrypoint renders it. */
export function restoreIsrArtifactRequest(
  request: Request,
  buildId: string,
): Request {
  const url = new URL(request.url);
  const prefix = buildPrefix(buildId);
  if (!url.pathname.startsWith(`${prefix}/`)) {
    throw new Error("ISR cache request is outside the current build namespace");
  }
  url.pathname = url.pathname.slice(prefix.length);
  url.search = "";
  return new Request(url, request);
}
