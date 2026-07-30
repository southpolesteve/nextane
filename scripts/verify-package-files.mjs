#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

function loadPackResult() {
  const manifestPath = process.argv[2];
  if (manifestPath) {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const results = loadPackResult();
assert.equal(results.length, 1, "npm pack must produce exactly one package");
const [packed] = results;
const packageManifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(packed.name, "nextane");
assert.equal(packed.version, packageManifest.version);
assert.equal(packed.entryCount, packed.files.length);
assert.equal(packed.bundled.length, 0, "release must not bundle dependencies");
assert.ok(packed.entryCount <= 100, "release contains unexpectedly many files");
assert.ok(
  packed.unpackedSize <= 1024 * 1024,
  "release unexpectedly exceeds 1 MiB unpacked",
);
for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
  assert.equal(
    packageManifest.scripts?.[lifecycle],
    undefined,
    `release must not define an npm ${lifecycle} lifecycle script`,
  );
}

const exactFiles = new Set([
  "LICENSE",
  "MIGRATION_PROMPT.md",
  "README.md",
  "SECURITY.md",
  "package.json",
  "worker.d.ts",
  "worker.ts",
]);
const allowedPrefixes = ["docs/", "package-dist/", "src/"];
const sensitiveName =
  /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|\.dev\.vars$|id_rsa$|[^/]+\.(?:key|pem|p12|pfx))$/i;

for (const file of packed.files) {
  assert.equal(typeof file.path, "string");
  assert.ok(
    exactFiles.has(file.path) ||
      allowedPrefixes.some((prefix) => file.path.startsWith(prefix)),
    `unexpected file in release: ${file.path}`,
  );
  assert.ok(
    !file.path.startsWith("/") &&
      !file.path.includes("\\") &&
      !file.path.split("/").includes(".."),
    `unsafe package path: ${file.path}`,
  );
  assert.ok(!sensitiveName.test(file.path), `sensitive file in release: ${file.path}`);
  assert.equal(
    file.mode & 0o022,
    0,
    `group/world-writable file in release: ${file.path}`,
  );
}

for (const required of exactFiles) {
  assert.ok(
    packed.files.some((file) => file.path === required),
    `required release file is missing: ${required}`,
  );
}

console.log(
  JSON.stringify({
    package: packed.id,
    filename: packed.filename,
    files: packed.entryCount,
    unpackedSize: packed.unpackedSize,
    integrity: packed.integrity,
  }),
);
