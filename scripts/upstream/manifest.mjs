#!/usr/bin/env node

/**
 * Generate a deploy manifest containing only Nextane's first Pages Router
 * smoke suites.
 *
 * Adapted from Vinext's `scripts/nextjs-deploy-manifest.mjs` (MIT).
 * See scripts/upstream/README.md for provenance.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { upstreamSmokeTestFiles } from "./profiles.mjs";

export async function writeSmokeManifest(nextjsDirectory, outputFile) {
  const nextjsRoot = path.resolve(nextjsDirectory);
  const outputPath = path.resolve(outputFile);
  const sourcePath = path.join(
    nextjsRoot,
    "test",
    "deploy-tests-manifest.json",
  );
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));

  if (source.version !== 2) {
    throw new Error(
      `Expected Next.js deploy manifest version 2, got ${source.version}`,
    );
  }

  for (const testFile of upstreamSmokeTestFiles) {
    await fs.access(path.join(nextjsRoot, testFile));
  }

  const suites = Object.fromEntries(
    upstreamSmokeTestFiles.map((testFile) => [
      testFile,
      source.suites?.[testFile] ?? {},
    ]),
  );

  const manifest = {
    version: 2,
    suites,
    rules: {
      include: upstreamSmokeTestFiles,
      exclude: [],
    },
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function main() {
  const [, , nextjsDirectory, outputFile] = process.argv;
  if (!nextjsDirectory || !outputFile) {
    console.error(
      "Usage: node scripts/upstream/manifest.mjs <nextjs-dir> <output-json>",
    );
    process.exitCode = 1;
    return;
  }

  const manifest = await writeSmokeManifest(nextjsDirectory, outputFile);
  console.log(
    `Wrote ${Object.keys(manifest.suites).length} suites to ${path.resolve(outputFile)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
