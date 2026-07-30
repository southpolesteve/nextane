#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const exampleRoot = path.join(
  repositoryRoot,
  "examples",
  "with-typescript-nextane",
);

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: exampleRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(" ")} failed`);
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["ci"]);
run(npm, ["run", "typecheck"]);
run(npm, ["run", "build"]);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object");
      server.close((error) =>
        error ? reject(error) : resolve(address.port),
      );
    });
  });
}

async function waitForServer(origin, process, logs) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Example server exited early\n${logs.join("")}`);
    }
    try {
      const response = await fetch(origin);
      if (response.status > 0) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${origin}\n${logs.join("")}`);
}

async function stop(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const logs = [];
const server = spawn(
  process.execPath,
  [
    path.join(exampleRoot, "node_modules", "vite", "bin", "vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  {
    cwd: exampleRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => logs.push(String(chunk)));
server.stderr.on("data", (chunk) => logs.push(String(chunk)));

let browser;
try {
  await waitForServer(origin, server, logs);

  const home = await fetch(origin);
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.match(homeHtml, /Hello Nextane/);
  assert.match(homeHtml, /Home \| Nextane \+ TypeScript Example/);

  const users = await fetch(`${origin}/users`);
  const usersHtml = await users.text();
  assert.equal(users.status, 200);
  assert.match(usersHtml, /101.*Alice/);
  assert.match(usersHtml, /104.*Dave/);

  const detail = await fetch(`${origin}/users/101`);
  const detailHtml = await detail.text();
  assert.equal(detail.status, 200);
  assert.match(detailHtml, /Detail for Alice/);

  const missing = await fetch(`${origin}/users/999`);
  assert.equal(missing.status, 404);

  const api = await fetch(`${origin}/api/users`);
  assert.equal(api.status, 200);
  const apiUsers = await api.json();
  assert.equal(apiUsers.length, 4);
  assert.deepEqual(apiUsers[0], { id: 101, name: "Alice" });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(() => {
    window.__migrationMarker = "preserve-me";
  });

  await page.locator('header a[href="/users"]').click();
  await page.locator("h1", { hasText: "Users List" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__migrationMarker),
    "preserve-me",
  );
  assert.equal(
    await page.title(),
    "Users List | Nextane + TypeScript Example",
  );

  await page.locator('a[href="/users/101"]').click();
  await page.locator("h1", { hasText: "Detail for Alice" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__migrationMarker),
    "preserve-me",
  );

  await page.goBack();
  await page.locator("h1", { hasText: "Users List" }).waitFor();

  console.log(
    JSON.stringify({
      source: "vercel/next.js examples/with-typescript",
      sourceVersion: "v16.2.2",
      directRendering: ["index", "getStaticProps", "getStaticPaths"],
      apiRoute: "passed",
      fallbackFalse404: "passed",
      softNavigation: "passed",
      browserBack: "passed",
      head: "passed",
    }),
  );
} finally {
  await browser?.close();
  await stop(server);
}
