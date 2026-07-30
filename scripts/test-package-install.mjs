#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function run(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal ?? code}\n${stdout}\n${stderr}`,
        ),
      );
    });
  });
}

async function writeFiles(root, files) {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const filePath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, source);
    }),
  );
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(url, child, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Fixture server exited early\n${logs.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}\n${logs.join("")}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "nextane-package-smoke-"),
);
const applicationRoot = path.join(temporaryRoot, "app");
let server;

try {
  const packed = await run(
    "npm",
    ["pack", "--json", "--pack-destination", temporaryRoot],
    repositoryRoot,
    { capture: true },
  );
  const [{ filename }] = JSON.parse(packed.stdout);
  const relativeTarball = `../${filename}`;

  await writeFiles(applicationRoot, {
    "package.json": `${JSON.stringify(
      {
        name: "nextane-package-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          nextane: `file:${relativeTarball}`,
          octane: "0.1.19",
          "@octanejs/vite-plugin": "0.1.19",
          "@cloudflare/vite-plugin": "1.48.0",
        },
        devDependencies: {
          "@cloudflare/workers-types": "5.20260729.1",
          "@types/node": "^24.0.0",
          typescript: "^5.9.3",
          vite: "^8.1.5",
          wrangler: "4.115.0",
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          types: ["@cloudflare/workers-types", "vite/client"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
        },
        include: ["client.ts", "worker.ts", "vite.config.ts", "pages/api"],
      },
      null,
      2,
    )}\n`,
    "vite.config.ts": `import { cloudflare } from "@cloudflare/vite-plugin";
import { octane } from "@octanejs/vite-plugin";
import { defineConfig } from "vite";
import { nextane } from "nextane";

export default defineConfig({
  plugins: [...octane(), nextane(), cloudflare()],
});
`,
    "wrangler.jsonc": `${JSON.stringify(
      {
        name: "nextane-package-smoke",
        main: "./worker.ts",
        compatibility_date: "2026-07-29",
        compatibility_flags: ["nodejs_compat"],
        cache: { enabled: true },
        exports: {
          default: { type: "worker", cache: { enabled: false } },
          IsrArtifact: { type: "worker", cache: { enabled: true } },
        },
        assets: {
          directory: "./dist/client",
          binding: "ASSETS",
          not_found_handling: "none",
          run_worker_first: true,
        },
      },
      null,
      2,
    )}\n`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!--nextane-head-->
    <!--nextane-styles-->
  </head>
  <body>
    <div id="__next"></div>
    <!--nextane-data-->
    <script type="module" src="/client.ts"></script>
  </body>
</html>
`,
    "client.ts": `import "nextane/client";\n`,
    "worker.ts": `export { default, IsrArtifact } from "nextane/worker";\n`,
    "pages/index.tsrx": `import Link from "nextane/link";

export async function getStaticProps() {
  return {
    props: { headline: "Installed from an npm tarball" },
    revalidate: 30,
  };
}

export default function Home({ headline }) {
  return (
    <main>
      <h1 id="headline">{headline}</h1>
      <Link href="/posts/hello" id="post-link">Read the seeded post</Link>
    </main>
  );
}
`,
    "pages/posts/[slug].tsrx": `import Link from "nextane/link";
import { useRouter } from "nextane/router";

export async function getStaticPaths() {
  return {
    paths: [{ params: { slug: "hello" } }],
    fallback: true,
  };
}

export async function getStaticProps({ params }) {
  return {
    props: { slug: params.slug, generatedAt: Date.now() },
    revalidate: 30,
  };
}

export default function Post({ slug, generatedAt }) {
  const router = useRouter();
  if (router.isFallback) return <p id="fallback">fallback</p>;
  return (
    <main>
      <h1 id="post">Post: {slug}</h1>
      <p id="generated-at">{generatedAt}</p>
      <Link href="/">Home</Link>
    </main>
  );
}
`,
    "pages/api/hello.ts": `import type {
  NextApiRequest,
  NextApiResponse,
} from "nextane/types";

export default function handler(
  request: NextApiRequest,
  response: NextApiResponse,
) {
  response.status(200).json({
    hello: request.query.name ?? "world",
  });
}
`,
  });

  await run("npm", ["install", "--no-audit", "--no-fund"], applicationRoot);
  await run("npm", ["run", "typecheck"], applicationRoot);
  await run("npm", ["run", "build"], applicationRoot);

  const port = await freePort();
  const logs = [];
  server = spawn(
    process.execPath,
    [
      path.join(applicationRoot, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: applicationRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => logs.push(String(chunk)));
  server.stderr.on("data", (chunk) => logs.push(String(chunk)));

  const origin = `http://127.0.0.1:${port}`;
  await waitForServer(origin, server, logs);

  const home = await fetch(origin);
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.match(homeHtml, /Installed from an npm tarball/);
  assert.equal(home.headers.get("x-powered-by"), "Nextane");

  const api = await fetch(`${origin}/api/hello?name=package`);
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { hello: "package" });

  const initialLazy = await fetch(`${origin}/posts/lazy`);
  const initialLazyHtml = await initialLazy.text();
  assert.equal(initialLazy.status, 200);
  assert.match(initialLazyHtml, /id="fallback"/);
  assert.match(initialLazyHtml, /"isFallback":true/);

  const lazyData = await fetch(
    `${origin}/_next/data/development/posts/lazy.json`,
  );
  const lazyGeneratedAt = lazyData.headers.get("x-nextane-generated-at");
  assert.equal(lazyData.status, 200);
  const lazyPayload = await lazyData.json();
  assert.equal(lazyPayload.pageProps.slug, "lazy");
  assert.equal(typeof lazyPayload.pageProps.generatedAt, "number");
  assert.equal(lazyPayload.__N_SSG, true);

  const completedLazy = await fetch(`${origin}/posts/lazy`);
  const completedLazyHtml = await completedLazy.text();
  assert.equal(completedLazy.status, 200);
  assert.match(completedLazyHtml, /id="post">Post: [\s\S]*lazy/);
  assert.match(completedLazyHtml, /"isFallback":false/);
  assert.equal(
    completedLazy.headers.get("x-nextane-generated-at"),
    lazyGeneratedAt,
  );

  console.log(
    JSON.stringify({
      package: filename,
      installRoot: applicationRoot,
      typecheck: "passed",
      build: "passed",
      runtime: {
        home: home.status,
        api: api.status,
        fallbackShell: true,
        sharedIsrArtifact: true,
      },
    }),
  );
} finally {
  if (server) await stop(server);
  if (process.env.NEXTANE_KEEP_PACKAGE_FIXTURE === "1") {
    console.error(`Kept package fixture at ${temporaryRoot}`);
  } else {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
