#!/usr/bin/env node

/**
 * Deterministically migrate one isolated Next.js deploy-test fixture to
 * Octane-native Nextane.
 *
 * This intentionally supports only the allowlisted smoke profiles in
 * profiles.mjs. Unknown fixtures fail closed instead of receiving a broad,
 * lossy source rewrite.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { upstreamSmokeSuites } from "./profiles.mjs";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".tsrx"]);
const COMPONENT_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

async function exists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function detectProfile(root) {
  const matches = [];
  for (const suite of upstreamSmokeSuites) {
    if (
      (
        await Promise.all(
          suite.signatures.map((signature) =>
            exists(path.join(root, signature)),
          ),
        )
      ).every(Boolean)
    ) {
      matches.push(suite);
    }
  }

  if (matches.length > 1) {
    const mostSpecific = Math.max(
      ...matches.map((match) => match.signatures.length),
    );
    const specificMatches = matches.filter(
      (match) => match.signatures.length === mostSpecific,
    );
    if (specificMatches.length === 1) return specificMatches[0];
  }

  if (matches.length !== 1) {
    const details =
      matches.length === 0
        ? "no supported profile matched"
        : `ambiguous profiles: ${matches.map((match) => match.id).join(", ")}`;
    throw new Error(
      `Refusing to adapt ${root}: ${details}. Supported profiles: ${upstreamSmokeSuites
        .map((suite) => suite.id)
        .join(", ")}`,
    );
  }
  return matches[0];
}

async function walk(directory) {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "dist"
    ) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(filePath)));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function containsJsx(source) {
  return /<>|<\/?[A-Za-z][A-Za-z0-9.-]*(?:\s|>|\/)/.test(source);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function renameComponentSources(root, profile) {
  const pagesRoot = path.join(root, "pages");
  const extraRoots = (
    profile.id === "404-page-router"
      ? ["components"]
      : profile.componentRoots ?? []
  ).map((directory) => path.join(root, directory));
  const roots = [pagesRoot, ...extraRoots];
  const renames = new Map();

  for (const filePath of await walk(root)) {
    const extension = path.extname(filePath);
    if (!COMPONENT_EXTENSIONS.includes(extension)) continue;
    if (!roots.some((candidate) => filePath === candidate || isInside(candidate, filePath))) {
      continue;
    }
    if (isInside(path.join(pagesRoot, "api"), filePath)) continue;

    const source = await fs.readFile(filePath, "utf8");
    if (!containsJsx(source)) continue;

    const destination = filePath.slice(0, -extension.length) + ".tsrx";
    if (destination === filePath) continue;
    await fs.rename(filePath, destination);
    renames.set(filePath, destination);
  }

  return renames;
}

function resolveRenamedSpecifier(filePath, specifier, renames) {
  if (!specifier.startsWith(".")) return specifier;
  const resolved = path.resolve(path.dirname(filePath), specifier);

  if (renames.has(resolved)) {
    const nextExtension = path.extname(renames.get(resolved));
    return specifier.slice(0, -path.extname(specifier).length) + nextExtension;
  }

  if (path.extname(specifier)) return specifier;
  for (const extension of COMPONENT_EXTENSIONS) {
    if (renames.has(`${resolved}${extension}`)) return `${specifier}.tsrx`;
    if (renames.has(path.join(resolved, `index${extension}`))) {
      return `${specifier}/index.tsrx`;
    }
  }
  return specifier;
}

function rewriteImports(source, filePath, renames, profile) {
  let next = source
    .replace(
      /import\s+type\s+\{[^}]+\}\s+from\s+["']next["'];?\s*/g,
      "",
    )
    .replace(/(["'])next\/head\1/g, '"nextane/head"')
    .replace(/(["'])next\/link\1/g, '"nextane/link"')
    .replace(/(["'])next\/router\1/g, '"nextane/router"')
    .replace(/(["'])next\/document\1/g, '"nextane/document"')
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+["']react["']/g,
      'import {$1} from "octane"',
    )
    .replace(
      /import\s+React\s+from\s+["']react["']/g,
      'import * as React from "octane"',
    );

  for (const specifier of profile.stripSideEffectImports ?? []) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(
      new RegExp(`import\\s+["']${escaped}["'];?\\s*`, "g"),
      "",
    );
  }

  next = next.replace(
    /((?:from\s+|import\s*\(|require\s*\()\s*)(["'])([^"']+)\2/g,
    (match, prefix, quote, specifier) =>
      `${prefix}${quote}${resolveRenamedSpecifier(
        filePath,
        specifier,
        renames,
      )}${quote}`,
  );
  return next;
}

async function rewriteSources(root, renames, profile) {
  for (const filePath of await walk(root)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) continue;
    const source = await fs.readFile(filePath, "utf8");
    const rewritten = rewriteImports(source, filePath, renames, profile);
    if (rewritten !== source) await fs.writeFile(filePath, rewritten);
  }
}

async function copyOverlay(nextaneRoot, profile, fixtureRoot) {
  const overlayRoot = path.join(
    nextaneRoot,
    "test",
    "upstream",
    "adaptations",
    profile.id,
  );
  if (!(await exists(overlayRoot))) return [];

  const copied = [];
  for (const sourcePath of await walk(overlayRoot)) {
    const relative = path.relative(overlayRoot, sourcePath);
    const destination = path.join(fixtureRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(sourcePath, destination);
    copied.push(relative);
  }
  return copied;
}

function aliasEntries(nextaneRoot) {
  const source = path.join(nextaneRoot, "src");
  const octane = path.join(nextaneRoot, "node_modules", "octane", "dist");
  return [
    ["nextane/head", path.join(source, "runtime", "head.tsrx")],
    ["nextane/document", path.join(source, "runtime", "document.tsrx")],
    ["nextane/link", path.join(source, "runtime", "link.tsrx")],
    ["nextane/router", path.join(source, "runtime", "router.ts")],
    ["nextane/client", path.join(source, "client.ts")],
    ["nextane/server", path.join(source, "server", "handler.ts")],
    ["nextane/types", path.join(source, "types.ts")],
    ["nextane", path.join(source, "index.ts")],
    ["octane/static", path.join(octane, "static", "index.js")],
    ["octane/server", path.join(octane, "server", "index.js")],
    ["octane", path.join(octane, "index.js")],
  ];
}

function viteConfig(nextaneRoot) {
  const cloudflareUrl = pathToFileURL(
    path.join(
      nextaneRoot,
      "node_modules",
      "@cloudflare",
      "vite-plugin",
      "dist",
      "index.mjs",
    ),
  ).href;
  const octanePluginUrl = pathToFileURL(
    path.join(
      nextaneRoot,
      "node_modules",
      "@octanejs",
      "vite-plugin",
      "src",
      "index.js",
    ),
  ).href;
  const nextanePluginUrl = pathToFileURL(
    path.join(nextaneRoot, "src", "plugin.ts"),
  ).href;
  const aliases = aliasEntries(nextaneRoot)
    .map(
      ([find, replacement]) =>
        `{ find: ${JSON.stringify(find)}, replacement: ${JSON.stringify(replacement)} }`,
    )
    .join(",\n      ");

  return `// Generated by scripts/upstream/adapt-fixture.mjs.
import { cloudflare } from ${JSON.stringify(cloudflareUrl)};
import { octane } from ${JSON.stringify(octanePluginUrl)};
import { nextane } from ${JSON.stringify(nextanePluginUrl)};

export default {
  plugins: [
    ...octane(),
    nextane(),
    cloudflare({ configPath: "nextane-upstream.wrangler.jsonc" }),
  ],
  resolve: {
    alias: [
      ${aliases}
    ],
  },
  build: { sourcemap: false },
};
`;
}

function workerSource(nextaneRoot) {
  const handlerUrl = pathToFileURL(
    path.join(nextaneRoot, "src", "server", "handler.ts"),
  ).href;
  return `// Generated by scripts/upstream/adapt-fixture.mjs.
import {
  config,
  loadApp,
  loadDocument,
  loadError,
  preview,
  routes,
} from "virtual:nextane-server-manifest";
import {
  createIsrArtifactHandler,
  createNextaneHandler,
} from ${JSON.stringify(handlerUrl)};

const manifest = {
  routes,
  loadApp,
  loadDocument,
  loadError,
  config,
  preview,
};
const handleArtifact = createIsrArtifactHandler(manifest);
const artifactCache = new Map();
const artifactLoads = new Map();

function maxAge(cacheControl) {
  const match = /(?:^|,)\\s*max-age=(\\d+)/i.exec(cacheControl ?? "");
  return match ? Number(match[1]) : 0;
}

async function loadCachedArtifact(request) {
  const key = new URL(request.url).pathname;
  const cached = artifactCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const headers = new Headers(cached.headers);
    headers.set("x-cache-status", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }
  if (request.headers.get("x-nextane-only-cached") === "1") {
    return new Response("ISR artifact not cached", { status: 404 });
  }

  let pending = artifactLoads.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await handleArtifact(request);
      const body = await response.text();
      const headers = [...response.headers.entries()];
      const entry = {
        body,
        headers,
        status: response.status,
        expiresAt:
          Date.now() + maxAge(response.headers.get("cache-control")) * 1000,
      };
      artifactCache.set(key, entry);
      return entry;
    })();
    artifactLoads.set(key, pending);
    void pending.finally(() => artifactLoads.delete(key));
  }
  const loaded = await pending;
  const headers = new Headers(loaded.headers);
  headers.set("x-cache-status", "MISS");
  return new Response(loaded.body, { status: loaded.status, headers });
}

const handle = createNextaneHandler(manifest, {
  loadCachedArtifact,
  revalidatePath(pathname, options) {
    if (options?.unstable_onlyGenerated && !artifactCache.has(pathname)) {
      return true;
    }
    artifactCache.delete(pathname);
    return true;
  },
});

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
`;
}

function htmlShell() {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" data-next-head=""><meta name="viewport" content="width=device-width" data-next-head=""><!--nextane-head-->
    <!--nextane-styles-->
  </head>
  <body>
    <div id="__next"></div>
    <!--nextane-data-->
    <script type="module" src="/nextane-upstream-client.ts"></script>
  </body>
</html>
`;
}

async function writeScaffolding(root, nextaneRoot, profile) {
  const compatibilityDate = "2026-07-29";
  const clientUrl = pathToFileURL(
    path.join(nextaneRoot, "src", "client.ts"),
  ).href;
  await Promise.all([
    fs.writeFile(
      path.join(root, "nextane-upstream.vite.config.mjs"),
      viteConfig(nextaneRoot),
    ),
    fs.writeFile(
      path.join(root, "nextane-upstream-worker.ts"),
      workerSource(nextaneRoot),
    ),
    fs.writeFile(path.join(root, "index.html"), htmlShell()),
    fs.writeFile(
      path.join(root, "nextane-upstream-client.ts"),
      `// Generated by scripts/upstream/adapt-fixture.mjs.\nimport ${JSON.stringify(clientUrl)};\n`,
    ),
    fs.writeFile(
      path.join(root, "nextane-upstream.wrangler.jsonc"),
      `${JSON.stringify(
        {
          name: "nextane-upstream",
          main: "nextane-upstream-worker.ts",
          compatibility_date: compatibilityDate,
          compatibility_flags: ["nodejs_compat"],
          assets: {
            directory: "dist/client",
            binding: "ASSETS",
            run_worker_first: true,
          },
        },
        null,
        2,
      )}\n`,
    ),
  ]);
}

export async function adaptFixture({
  root,
  nextaneRoot,
  expectedProfile,
}) {
  const fixtureRoot = path.resolve(root);
  const repositoryRoot = path.resolve(nextaneRoot);
  const profile = await detectProfile(fixtureRoot);
  if (expectedProfile && profile.id !== expectedProfile) {
    throw new Error(
      `Expected fixture profile ${expectedProfile}, detected ${profile.id}`,
    );
  }

  const renames = await renameComponentSources(fixtureRoot, profile);
  await rewriteSources(fixtureRoot, renames, profile);
  const overlays = await copyOverlay(repositoryRoot, profile, fixtureRoot);
  await writeScaffolding(fixtureRoot, repositoryRoot, profile);
  await fs.mkdir(path.join(fixtureRoot, ".next"), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, ".next", "trace"), "");

  const report = {
    profile: profile.id,
    renamed: [...renames.entries()].map(([from, to]) => ({
      from: path.relative(fixtureRoot, from),
      to: path.relative(fixtureRoot, to),
    })),
    overlays,
    warmupPaths: profile.warmupPaths ?? [],
  };
  await fs.writeFile(
    path.join(fixtureRoot, ".nextane-upstream-adaptation.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

async function main() {
  let root = process.cwd();
  let nextaneRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../..",
  );
  let expectedProfile;

  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--root") root = process.argv[++index];
    else if (argument === "--nextane-root") {
      nextaneRoot = process.argv[++index];
    } else if (argument === "--profile") {
      expectedProfile = process.argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  const report = await adaptFixture({ root, nextaneRoot, expectedProfile });
  console.log(JSON.stringify(report));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
