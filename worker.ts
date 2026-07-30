import { WorkerEntrypoint } from "cloudflare:workers";
import {
  buildId,
  config,
  loadApp,
  loadDocument,
  loadError,
  routes,
} from "virtual:nextane-server-manifest";
import {
  cacheTagForPath,
  createIsrArtifactHandler,
  createNextaneHandler,
  type NextaneEnvironment,
} from "./src/server/handler";
import {
  namespaceIsrCacheRequest,
  restoreIsrArtifactRequest,
} from "./src/server/isr-cache";

const manifest = {
  buildId,
  routes,
  loadApp,
  loadDocument,
  loadError,
  config,
};
const handleIsrArtifact = createIsrArtifactHandler(manifest);
const runtimeCaches = caches as CacheStorage & { default: Cache };

async function loadLocalArtifact(request: Request): Promise<Response> {
  const cacheRequest = namespaceIsrCacheRequest(request, buildId);
  const cached = await runtimeCaches.default.match(cacheRequest);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-cache-status", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
  if (request.headers.get("x-nextane-only-cached") === "1") {
    return new Response("ISR artifact not cached", { status: 404 });
  }

  const response = await handleIsrArtifact(request);
  if (response.ok) {
    await runtimeCaches.default.put(cacheRequest, response.clone());
  }
  const missHeaders = new Headers(response.headers);
  missHeaders.set("x-cache-status", "MISS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: missHeaders,
  });
}

export class IsrArtifact extends WorkerEntrypoint<NextaneEnvironment> {
  fetch(request: Request) {
    return handleIsrArtifact(restoreIsrArtifactRequest(request, buildId));
  }
}

export default {
  fetch(request: Request, env: NextaneEnvironment, ctx: ExecutionContext) {
    const handle = createNextaneHandler(manifest, {
      async loadCachedArtifact(artifactRequest) {
        if (import.meta.env.DEV) return loadLocalArtifact(artifactRequest);
        return ctx.exports.IsrArtifact.fetch(
          namespaceIsrCacheRequest(artifactRequest, buildId),
        );
      },
      async revalidatePath(pathname) {
        if (import.meta.env.DEV) {
          const canonical = new Request(
            new URL(pathname, "https://nextane.internal"),
          );
          return runtimeCaches.default.delete(
            namespaceIsrCacheRequest(canonical, buildId),
          );
        }
        if (!ctx.cache) return false;
        const result = await ctx.cache.purge({
          tags: [cacheTagForPath(pathname)],
        });
        return result.success;
      },
    });
    return handle(request, env);
  },
};
