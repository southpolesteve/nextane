#!/usr/bin/env node

/**
 * Local entrypoint for Nextane's filtered Next.js deploy-test smoke run.
 *
 * The Next.js checkout must already be installed/built. The tested baseline is
 * v16.2.6; set NEXTANE_ALLOW_NEXT_REF_MISMATCH=1 only for harness development.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSmokeManifest } from "./manifest.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const nextaneRoot = path.resolve(scriptDirectory, "../..");

async function readNextVersion(nextjsRoot) {
  const packageFile = path.join(nextjsRoot, "packages", "next", "package.json");
  const pkg = JSON.parse(await fs.readFile(packageFile, "utf8"));
  return pkg.version;
}

async function run() {
  const [, , nextjsArgument, ...extraArguments] = process.argv;
  if (!nextjsArgument) {
    console.error(
      "Usage: node scripts/upstream/run.mjs <prepared-nextjs-dir> [run-tests args...]",
    );
    process.exitCode = 1;
    return;
  }

  const nextjsRoot = path.resolve(nextjsArgument);
  await fs.access(path.join(nextjsRoot, "run-tests.js"));
  const nextVersion = await readNextVersion(nextjsRoot);
  const expectedVersion = process.env.NEXTANE_NEXT_VERSION ?? "16.2.6";
  if (
    nextVersion !== expectedVersion &&
    process.env.NEXTANE_ALLOW_NEXT_REF_MISMATCH !== "1"
  ) {
    throw new Error(
      `Expected Next.js ${expectedVersion}, found ${nextVersion}. ` +
        "Use a v16.2.6 checkout or explicitly set NEXTANE_ALLOW_NEXT_REF_MISMATCH=1 for harness development.",
    );
  }

  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nextane-upstream-"),
  );
  const manifestPath = path.join(temporaryRoot, "deploy-manifest.json");
  await writeSmokeManifest(nextjsRoot, manifestPath);

  const argumentsForRunner =
    extraArguments.length > 0
      ? extraArguments
      : ["--timings", "--retries", "0", "-c", "1", "--type", "e2e"];

  const child = spawn(process.execPath, ["run-tests.js", ...argumentsForRunner], {
    cwd: nextjsRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ADAPTER_DIR: nextaneRoot,
      NEXTANE_DIR: nextaneRoot,
      NEXT_E2E_TEST_TIMEOUT:
        process.env.NEXT_E2E_TEST_TIMEOUT ?? "240000",
      NEXT_EXTERNAL_TESTS_FILTERS: manifestPath,
      NEXT_PRIVATE_TEST_MODE: "deploy",
      NEXT_TEST_MODE: "deploy",
      NEXT_TEST_CONCURRENCY: process.env.NEXT_TEST_CONCURRENCY ?? "1",
      NEXT_TEST_DEPLOY_SCRIPT_PATH: path.join(
        scriptDirectory,
        "e2e-deploy.sh",
      ),
      NEXT_TEST_DEPLOY_LOGS_SCRIPT_PATH: path.join(
        scriptDirectory,
        "e2e-logs.sh",
      ),
      NEXT_TEST_CLEANUP_SCRIPT_PATH: path.join(
        scriptDirectory,
        "e2e-cleanup.sh",
      ),
      NEXT_TEST_JOB: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      IS_TURBOPACK_TEST: "1",
    },
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Next.js test runner exited on ${signal}`));
      else resolve(code ?? 1);
    });
  });

  await fs.rm(temporaryRoot, { recursive: true, force: true });
  process.exitCode = exitCode;
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
