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
const localArtifactCache = new Map<
  string,
  { body: string; headers: [string, string][]; expiresAt: number }
>();

function maxAge(cacheControl: string | null): number {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl ?? "");
  return match ? Number(match[1]) : 0;
}

async function loadLocalArtifact(request: Request): Promise<Response> {
  const key = `${buildId}:${new URL(request.url).pathname}`;
  const cached = localArtifactCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const headers = new Headers(cached.headers);
    headers.set("x-cache-status", "HIT");
    return new Response(cached.body, { headers });
  }
  if (request.headers.get("x-nextane-only-cached") === "1") {
    return new Response("ISR artifact not cached", { status: 404 });
  }

  const response = await handleIsrArtifact(request);
  const body = await response.text();
  const headers = [...response.headers.entries()];
  localArtifactCache.set(key, {
    body,
    headers,
    expiresAt: Date.now() + maxAge(response.headers.get("cache-control")) * 1000,
  });
  const missHeaders = new Headers(headers);
  missHeaders.set("x-cache-status", "MISS");
  return new Response(body, { status: response.status, headers: missHeaders });
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
        localArtifactCache.delete(`${buildId}:${pathname}`);
        if (import.meta.env.DEV) return true;
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
