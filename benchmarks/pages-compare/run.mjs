import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(benchmarkRoot, "../..");
const runs = Number(process.env.NEXTANE_BENCH_RUNS ?? 7);
const requestRounds = Number(process.env.NEXTANE_BENCH_REQUEST_ROUNDS ?? 5);
const requestsPerRound = Number(process.env.NEXTANE_BENCH_REQUESTS ?? 500);
const requestConcurrency = Number(process.env.NEXTANE_BENCH_CONCURRENCY ?? 16);
const warmRequestCount = Number(process.env.NEXTANE_BENCH_WARM_REQUESTS ?? 2_000);
const skipBuilds = process.env.NEXTANE_BENCH_SKIP_BUILDS === "1";

const bin = (name) => path.join(benchmarkRoot, "node_modules", ".bin", name);
const rootBin = (name) => path.join(projectRoot, "node_modules", ".bin", name);
const vinextRepository = process.env.NEXTANE_BENCH_VINEXT_REPO
  ? path.resolve(process.env.NEXTANE_BENCH_VINEXT_REPO)
  : null;
const vinextPackagePath = vinextRepository
  ? path.join(vinextRepository, "packages/vinext/package.json")
  : path.join(benchmarkRoot, "node_modules/vinext/package.json");
const vinextCli =
  process.env.NEXTANE_BENCH_VINEXT_CLI ?? bin("vinext");

const projects = {
  nextjs: {
    label: "Next.js",
    cwd: path.join(benchmarkRoot, "nextjs"),
    clean: ".next",
    build: [bin("next"), ["build"]],
    start: [bin("next"), ["start", "-p", "4211", "-H", "127.0.0.1"]],
    url: "http://127.0.0.1:4211",
    clientDir: ".next/static",
    serverDir: ".next/server",
  },
  vinext: {
    label: "Vinext",
    cwd: path.join(benchmarkRoot, "vinext"),
    clean: "dist",
    build: [vinextCli, ["build"]],
    start: [vinextCli, ["start", "-p", "4212", "-H", "127.0.0.1"]],
    url: "http://127.0.0.1:4212",
    clientDir: "dist/client",
    serverDir: "dist/server",
  },
  nextane: {
    label: "Nextane",
    cwd: path.join(benchmarkRoot, "nextane"),
    clean: "dist",
    build: [bin("vite"), ["build", "--config", "vite.config.ts"]],
    start: [
      rootBin("wrangler"),
      [
        "dev",
        "--config",
        "dist/nextane_render_benchmark/wrangler.json",
        "--port",
        "4213",
        "--ip",
        "127.0.0.1",
        "--inspector-port",
        "9313",
        "--log-level",
        "error",
        "--show-interactive-dev-session",
        "false",
      ],
    ],
    url: "http://127.0.0.1:4213",
    clientDir: "dist/client",
    serverDir: "dist/nextane_render_benchmark",
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function clean(project) {
  rmSync(path.join(project.cwd, project.clean), { recursive: true, force: true });
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return {
    runs: values.map((value) => Math.round(value * 10) / 10),
    mean: Math.round(mean * 10) / 10,
    median: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted.at(-1) * 10) / 10,
    stddev: Math.round(Math.sqrt(variance) * 10) / 10,
  };
}

function rotate(values, index) {
  const offset = index % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

function measureBuilds() {
  const keys = Object.keys(projects);
  const timings = Object.fromEntries(keys.map((key) => [key, []]));

  console.log("Warming production builds...");
  for (let warmup = 0; warmup < 2; warmup += 1) {
    for (const key of keys) {
      const project = projects[key];
      clean(project);
      run(project.build[0], project.build[1], { cwd: project.cwd });
    }
  }

  console.log(`Measuring ${runs} production builds per framework...`);
  for (let round = 0; round < runs; round += 1) {
    for (const key of rotate(keys, round)) {
      const project = projects[key];
      clean(project);
      const startedAt = performance.now();
      run(project.build[0], project.build[1], { cwd: project.cwd });
      const elapsed = performance.now() - startedAt;
      timings[key].push(elapsed);
      console.log(`  ${round + 1}/${runs} ${project.label}: ${elapsed.toFixed(1)} ms`);
    }
  }

  return Object.fromEntries(
    keys.map((key) => [key, summarize(timings[key])]),
  );
}

function artifactSize(directory) {
  let raw = 0;
  let gzip = 0;
  let files = 0;
  const fileNames = [];

  function walk(current) {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else if (/\.(?:js|mjs|css)$/.test(entry)) {
        const contents = readFileSync(fullPath);
        raw += contents.byteLength;
        gzip += gzipSync(contents).byteLength;
        files += 1;
        fileNames.push(path.relative(directory, fullPath));
      }
    }
  }

  walk(directory);
  return { raw, gzip, files, fileNames };
}

async function waitForServer(project, process, timeout = 60_000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`${project.label} server exited before becoming ready`);
    }
    try {
      const response = await fetch(project.url, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) return;
    } catch {
      // Continue polling until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${project.label} server did not become ready`);
}

function startServer(project) {
  const process = spawn(project.start[0], project.start[1], {
    cwd: project.cwd,
    detached: true,
    env: {
      ...globalThis.process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  process.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  process.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  process.benchmarkOutput = () => output;
  return process;
}

function stopServer(process) {
  if (!process || process.exitCode !== null) return;
  try {
    globalThis.process.kill(-process.pid, "SIGTERM");
  } catch {
    try {
      process.kill("SIGTERM");
    } catch {
      // The benchmark owns only the process it spawned.
    }
  }
}

async function browserMetrics(browser, project) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const jsBodies = new Map();
  const bodyPromises = [];

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!/\.js(?:$|\?)/.test(url.pathname)) return;
    bodyPromises.push(
      response
        .body()
        .then((body) => jsBodies.set(response.url(), body))
        .catch(() => undefined),
    );
  });

  const response = await page.goto(project.url, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`${project.label} browser load failed`);
  await Promise.all(bodyPromises);

  const title = await page.title();
  const normalizedText = (await page.locator("main").innerText()).replace(
    /Server-rendered at \S+/,
    "Server-rendered at <timestamp>",
  );
  await page.getByRole("button", { name: "Count: 0" }).click();
  await page.getByRole("button", { name: "Count: 1" }).waitFor();

  const resourceTiming = await page.evaluate(() => {
    const resources = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes(".js"))
      .map((entry) => ({
        name: entry.name,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      }));
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      resources,
      navigation: navigation
        ? {
            transferSize: navigation.transferSize,
            encodedBodySize: navigation.encodedBodySize,
            decodedBodySize: navigation.decodedBodySize,
          }
        : null,
    };
  });

  const bodies = [...jsBodies.entries()];
  const requestedJs = {
    files: bodies.length,
    raw: bodies.reduce((total, [, body]) => total + body.byteLength, 0),
    gzip: bodies.reduce(
      (total, [, body]) => total + gzipSync(body).byteLength,
      0,
    ),
    urls: bodies.map(([url, body]) => ({
      url: new URL(url).pathname,
      raw: body.byteLength,
      gzip: gzipSync(body).byteLength,
    })),
  };

  const htmlResponse = await fetch(project.url, {
    headers: { "accept-encoding": "identity" },
  });
  const html = Buffer.from(await htmlResponse.arrayBuffer());
  await context.close();

  return {
    title,
    normalizedText,
    hydration: "Count: 0 → Count: 1",
    requestedJs,
    resourceTiming,
    html: {
      raw: html.byteLength,
      gzip: gzipSync(html).byteLength,
    },
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function requestRound(project) {
  let cursor = 0;
  const latencies = [];
  const startedAt = performance.now();
  const workers = Array.from({ length: requestConcurrency }, async () => {
    while (true) {
      const requestIndex = cursor;
      cursor += 1;
      if (requestIndex >= requestsPerRound) return;
      const requestStartedAt = performance.now();
      const response = await fetch(`${project.url}/?request=${requestIndex}`);
      if (!response.ok) throw new Error(`${project.label} returned ${response.status}`);
      await response.arrayBuffer();
      latencies.push(performance.now() - requestStartedAt);
    }
  });
  await Promise.all(workers);
  const elapsed = performance.now() - startedAt;
  const sorted = latencies.sort((left, right) => left - right);
  return {
    requestsPerSecond: (requestsPerRound / elapsed) * 1000,
    meanLatency: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50Latency: percentile(sorted, 0.5),
    p95Latency: percentile(sorted, 0.95),
    p99Latency: percentile(sorted, 0.99),
  };
}

async function warmRequests(project, count = warmRequestCount) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: requestConcurrency }, async () => {
      while (true) {
        const requestIndex = cursor;
        cursor += 1;
        if (requestIndex >= count) return;
        const response = await fetch(`${project.url}/?warm=${requestIndex}`);
        if (!response.ok) throw new Error(`${project.label} warmup failed`);
        await response.arrayBuffer();
      }
    }),
  );
}

function aggregateRounds(rounds) {
  const keys = [
    "requestsPerSecond",
    "meanLatency",
    "p50Latency",
    "p95Latency",
    "p99Latency",
  ];
  return Object.fromEntries(
    keys.map((key) => [
      key,
      Math.round(
        [...rounds]
          .map((round) => round[key])
          .sort((left, right) => left - right)[Math.floor(rounds.length / 2)] *
          10,
      ) / 10,
    ]),
  );
}

function readVersion(packagePath) {
  return JSON.parse(readFileSync(packagePath, "utf8")).version;
}

function gitHash(repository) {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "uncommitted";
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function markdown(results) {
  const lines = [
    "# Pages rendering benchmark",
    "",
    `Generated ${results.generatedAt} on ${results.system.cpu}.`,
    "",
    "## Results",
    "",
    "| Metric | Next.js | Vinext | Nextane |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [label, read] of [
    ["Production build, median", (r) => `${r.build.median.toFixed(1)} ms`],
    ["Cold-page JS, raw", (r) => formatBytes(r.browser.requestedJs.raw)],
    ["Cold-page JS, gzip", (r) => formatBytes(r.browser.requestedJs.gzip)],
    ["SSR HTML, raw", (r) => formatBytes(r.browser.html.raw)],
    ["SSR HTML, gzip", (r) => formatBytes(r.browser.html.gzip)],
    ["Local SSR requests/sec, median", (r) => r.requests.requestsPerSecond.toFixed(1)],
    ["Local SSR p50", (r) => `${r.requests.p50Latency.toFixed(1)} ms`],
    ["Client artifact JS/CSS, gzip", (r) => formatBytes(r.artifacts.client.gzip)],
    ["Server artifact JS/CSS, gzip", (r) => formatBytes(r.artifacts.server.gzip)],
  ]) {
    lines.push(
      `| ${label} | ${read(results.projects.nextjs)} | ${read(results.projects.vinext)} | ${read(results.projects.nextane)} |`,
    );
  }
  lines.push(
    "",
    "All three produced the same normalized visible text and hydrated `Count: 0` to",
    "`Count: 1`. Browser JavaScript counts only unique `.js` responses requested",
    "by a cold page load; gzip is calculated per requested file.",
    "",
    "Next.js and Vinext used their local Node production servers. Nextane used",
    "local workerd. Throughput therefore compares the current product stacks, not",
    "isolated renderer speed. Server artifact layouts are also not equivalent.",
    "",
    "## Versions",
    "",
    `- Next.js ${results.versions.nextjs}`,
    `- React ${results.versions.react}`,
    `- Vinext ${results.versions.vinext} (${results.versions.vinextCommit})`,
    `- Octane ${results.versions.octane}`,
    `- Nextane ${results.versions.nextaneCommit}`,
    "",
  );
  return lines.join("\n");
}

async function main() {
  const previousResultsPath = path.join(benchmarkRoot, "results/latest.json");
  const previousResults =
    skipBuilds && existsSync(previousResultsPath)
      ? JSON.parse(readFileSync(previousResultsPath, "utf8"))
      : null;
  const buildResults = previousResults
    ? Object.fromEntries(
        Object.keys(projects).map((key) => [
          key,
          previousResults.projects[key].build,
        ]),
      )
    : measureBuilds();
  const artifacts = Object.fromEntries(
    Object.entries(projects).map(([key, project]) => [
      key,
      {
        client: artifactSize(path.join(project.cwd, project.clientDir)),
        server: artifactSize(path.join(project.cwd, project.serverDir)),
      },
    ]),
  );

  console.log("Starting local production servers...");
  const servers = Object.fromEntries(
    Object.entries(projects).map(([key, project]) => [key, startServer(project)]),
  );

  try {
    await Promise.all(
      Object.entries(projects).map(async ([key, project]) => {
        try {
          await waitForServer(project, servers[key]);
        } catch (error) {
          throw new Error(
            `${error.message}\n${servers[key].benchmarkOutput()}`,
          );
        }
      }),
    );

    const browser = await chromium.launch();
    const browserResults = {};
    try {
      for (const [key, project] of Object.entries(projects)) {
        browserResults[key] = await browserMetrics(browser, project);
      }
    } finally {
      await browser.close();
    }

    const normalizedText = Object.values(browserResults).map(
      (result) => result.normalizedText,
    );
    if (new Set(normalizedText).size !== 1) {
      throw new Error("The three benchmark pages did not render equivalent visible text");
    }

    const requestResults = Object.fromEntries(
      Object.keys(projects).map((key) => [key, []]),
    );
    const projectKeys = Object.keys(projects);
    console.log("Warming local production request paths...");
    for (const key of projectKeys) await warmRequests(projects[key]);
    console.log(`Running ${requestRounds} local SSR request rounds...`);
    for (let round = 0; round < requestRounds; round += 1) {
      for (const key of rotate(projectKeys, round)) {
        const result = await requestRound(projects[key]);
        requestResults[key].push(result);
        console.log(
          `  ${round + 1}/${requestRounds} ${projects[key].label}: ${result.requestsPerSecond.toFixed(1)} req/s`,
        );
      }
    }

    const results = {
      generatedAt: new Date().toISOString(),
      methodology: {
        buildRuns: runs,
        buildMeasurementsReused: Boolean(previousResults),
        requestRounds,
        requestsPerRound,
        requestConcurrency,
        warmRequestCount,
        buildOrder: "rotated each round",
      },
      system: {
        platform: `${os.platform()} ${os.arch()}`,
        node: globalThis.process.version,
        cpu: os.cpus()[0]?.model ?? "unknown",
        logicalCpus: os.cpus().length,
        memoryBytes: os.totalmem(),
      },
      versions: {
        nextjs: readVersion(path.join(benchmarkRoot, "node_modules/next/package.json")),
        react: readVersion(path.join(benchmarkRoot, "node_modules/react/package.json")),
        vinext: readVersion(vinextPackagePath),
        vinextCommit: vinextRepository ? gitHash(vinextRepository) : "npm package",
        octane: readVersion(path.join(projectRoot, "node_modules/octane/package.json")),
        nextaneCommit: readVersion(path.join(projectRoot, "package.json")),
      },
      projects: Object.fromEntries(
        Object.keys(projects).map((key) => [
          key,
          {
            build: buildResults[key],
            artifacts: artifacts[key],
            browser: browserResults[key],
            requests: {
              ...aggregateRounds(requestResults[key]),
              rounds: requestResults[key],
            },
          },
        ]),
      ),
    };

    const resultsDirectory = path.join(benchmarkRoot, "results");
    mkdirSync(resultsDirectory, { recursive: true });
    writeFileSync(
      path.join(resultsDirectory, "latest.json"),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    writeFileSync(path.join(resultsDirectory, "latest.md"), `${markdown(results)}\n`);
    console.log(`Wrote ${path.join(resultsDirectory, "latest.md")}`);
  } finally {
    for (const server of Object.values(servers)) stopServer(server);
  }
}

await main();
