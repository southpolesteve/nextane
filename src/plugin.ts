import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { HmrContext, Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { findSpecialPage, scanPages } from "./routing/scan.ts";

const CLIENT_MANIFEST_ID = "virtual:nextane-client-manifest";
const SERVER_MANIFEST_ID = "virtual:nextane-server-manifest";
const RESOLVED_CLIENT_MANIFEST_ID = `\0${CLIENT_MANIFEST_ID}`;
const RESOLVED_SERVER_MANIFEST_ID = `\0${SERVER_MANIFEST_ID}`;
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PUBLIC_RUNTIME_ALIASES = [
  ["nextane/client", "src/client.ts"],
  ["nextane/document", "src/runtime/document.tsrx"],
  ["nextane/head", "src/runtime/head.tsrx"],
  ["nextane/link", "src/runtime/link.tsrx"],
  ["nextane/router", "src/runtime/router.ts"],
  ["nextane/server", "src/server/handler.ts"],
  ["nextane/types", "src/types.ts"],
  ["nextane/worker", "worker.ts"],
].map(([find, source]) => ({
  find,
  replacement: path.join(PACKAGE_ROOT, source),
}));

interface RoutingConfig {
  rewrites: Array<{ source: string; destination: string }>;
  crossOrigin?: string;
  trailingSlash: boolean;
}

async function loadRoutingConfig(root: string): Promise<RoutingConfig> {
  const candidates = [
    "nextane.config.cjs",
    "next.config.cjs",
    "nextane.config.js",
    "next.config.js",
    "nextane.config.mjs",
    "next.config.mjs",
  ];
  const configPath = candidates
    .map((candidate) => path.join(root, candidate))
    .find(existsSync);
  if (!configPath) return { rewrites: [], trailingSlash: false };

  let loaded: unknown;
  try {
    const require = createRequire(path.join(root, "__nextane_config__.cjs"));
    delete require.cache[require.resolve(configPath)];
    loaded = require(configPath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_REQUIRE_ESM"
    ) {
      throw error;
    }
    loaded = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
  }

  let nextConfig =
    loaded &&
    typeof loaded === "object" &&
    "default" in loaded
      ? (loaded as { default: unknown }).default
      : loaded;
  if (typeof nextConfig === "function") {
    nextConfig = await nextConfig("phase-production-build", {
      defaultConfig: {},
    });
  }
  const config =
    nextConfig && typeof nextConfig === "object"
      ? (nextConfig as Record<string, unknown>)
      : {};
  const rewriteValue =
    typeof config.rewrites === "function" ? await config.rewrites() : [];
  const rewriteGroups =
    Array.isArray(rewriteValue)
      ? rewriteValue
      : rewriteValue && typeof rewriteValue === "object"
        ? [
            ...(Array.isArray((rewriteValue as Record<string, unknown>).beforeFiles)
              ? ((rewriteValue as Record<string, unknown>).beforeFiles as unknown[])
              : []),
            ...(Array.isArray((rewriteValue as Record<string, unknown>).afterFiles)
              ? ((rewriteValue as Record<string, unknown>).afterFiles as unknown[])
              : []),
            ...(Array.isArray((rewriteValue as Record<string, unknown>).fallback)
              ? ((rewriteValue as Record<string, unknown>).fallback as unknown[])
              : []),
          ]
        : [];
  const rewrites = rewriteGroups.flatMap((rewrite) => {
    if (
      !rewrite ||
      typeof rewrite !== "object" ||
      typeof (rewrite as Record<string, unknown>).source !== "string" ||
      typeof (rewrite as Record<string, unknown>).destination !== "string"
    ) {
      return [];
    }
    return [
      {
        source: (rewrite as { source: string }).source,
        destination: (rewrite as { destination: string }).destination,
      },
    ];
  });

  return {
    rewrites,
    trailingSlash: config.trailingSlash === true,
    ...(typeof config.crossOrigin === "string"
      ? { crossOrigin: config.crossOrigin }
      : {}),
  };
}

function viteFileId(filePath: string): string {
  return `/@fs${filePath.split(path.sep).join("/")}`;
}

function serializePublicRoute(route: {
  route: string;
  regexSource: string;
  params: unknown;
}): string {
  return JSON.stringify({
    route: route.route,
    regexSource: route.regexSource,
    params: route.params,
  });
}

async function clientManifestSource(root: string): Promise<string> {
  const routes = (await scanPages(root)).filter((route) => route.kind === "page");
  const appPath = await findSpecialPage(root, "_app");
  const errorPath = await findSpecialPage(root, "_error");

  const loaderEntries = routes.map(
    (route) =>
      `${JSON.stringify(route.route)}: () => import(${JSON.stringify(viteFileId(route.filePath))})`,
  );

  return `
export const routes = [${routes.map(serializePublicRoute).join(",")}];
export const pageLoaders = {${loaderEntries.join(",")}};
export const appLoader = ${
    appPath ? `() => import(${JSON.stringify(viteFileId(appPath))})` : "null"
  };
export const errorLoader = ${
    errorPath ? `() => import(${JSON.stringify(viteFileId(errorPath))})` : "null"
  };
`;
}

async function serverManifestSource(
  root: string,
  buildId: string,
): Promise<string> {
  const routes = await scanPages(root);
  const appPath = await findSpecialPage(root, "_app");
  const documentPath = await findSpecialPage(root, "_document");
  const errorPath = await findSpecialPage(root, "_error");
  const routingConfig = await loadRoutingConfig(root);

  const routeEntries = routes.map(
    (route, index) =>
      `{...${serializePublicRoute(route)}, kind:${JSON.stringify(route.kind)}, load: () => import(${JSON.stringify(viteFileId(route.filePath))}), id:${index}}`,
  );

  return `
export const buildId = ${JSON.stringify(buildId)};
export const routes = [${routeEntries.join(",")}];
export const loadApp = ${
    appPath ? `() => import(${JSON.stringify(viteFileId(appPath))})` : "null"
  };
export const loadDocument = ${
    documentPath ? `() => import(${JSON.stringify(viteFileId(documentPath))})` : "null"
  };
export const loadError = ${
    errorPath ? `() => import(${JSON.stringify(viteFileId(errorPath))})` : "null"
  };
export const config = ${JSON.stringify(routingConfig)};
`;
}

function invalidateManifest(server: ViteDevServer, id: string) {
  const module = server.moduleGraph.getModuleById(id);
  if (module) server.moduleGraph.invalidateModule(module);
}

export function nextane(): Plugin {
  let config: ResolvedConfig;
  const buildId = process.env.NEXTANE_BUILD_ID ?? randomUUID();

  return {
    name: "nextane",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: PUBLIC_RUNTIME_ALIASES,
        },
        optimizeDeps: {
          exclude: [
            "nextane",
            "nextane/client",
            "nextane/document",
            "nextane/head",
            "nextane/link",
            "nextane/router",
            "nextane/server",
            "nextane/types",
            "nextane/worker",
            "octane",
          ],
        },
      };
    },
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      if (id === CLIENT_MANIFEST_ID) return RESOLVED_CLIENT_MANIFEST_ID;
      if (id === SERVER_MANIFEST_ID) return RESOLVED_SERVER_MANIFEST_ID;
      return null;
    },
    load(id) {
      if (id === RESOLVED_CLIENT_MANIFEST_ID) return clientManifestSource(config.root);
      if (id === RESOLVED_SERVER_MANIFEST_ID) {
        return serverManifestSource(config.root, buildId);
      }
      return null;
    },
    configureServer(server) {
      const pagesDirectory = path.join(config.root, "pages");
      server.watcher.add(pagesDirectory);
      const refresh = (filePath: string) => {
        if (!filePath.startsWith(pagesDirectory)) return;
        invalidateManifest(server, RESOLVED_CLIENT_MANIFEST_ID);
        invalidateManifest(server, RESOLVED_SERVER_MANIFEST_ID);
        server.ws.send({ type: "full-reload", path: "*" });
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);
    },
    handleHotUpdate(context: HmrContext) {
      if (context.file.startsWith(path.join(config.root, "pages"))) {
        invalidateManifest(context.server, RESOLVED_CLIENT_MANIFEST_ID);
        invalidateManifest(context.server, RESOLVED_SERVER_MANIFEST_ID);
      }
    },
  };
}

export default nextane;
