#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workflowRoot = path.join(repositoryRoot, ".github", "workflows");

function job(source, name) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `workflow is missing the ${name} job`);
  const bodyStart = start + marker.length;
  const nextJob = source.slice(bodyStart).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJob === -1
    ? source.slice(bodyStart)
    : source.slice(bodyStart, bodyStart + nextJob);
}

const workflowFiles = (await fs.readdir(workflowRoot))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

for (const filename of workflowFiles) {
  const source = await fs.readFile(path.join(workflowRoot, filename), "utf8");
  for (const match of source.matchAll(/^\s*-\s+uses:\s+([^#\s]+)/gm)) {
    assert.match(
      match[1],
      /^[^@\s]+@[0-9a-f]{40}$/,
      `${filename} action is not pinned to a full commit: ${match[1]}`,
    );
  }
}

const ci = await fs.readFile(path.join(workflowRoot, "ci.yml"), "utf8");
assert.match(ci, /\npermissions:\n  contents: read\n/);

const test = job(ci, "test");
assert.doesNotMatch(test, /\b(?:contents|id-token): write\b/);
assert.match(test, /npm ci --ignore-scripts/);
assert.match(test, /npm audit --audit-level=high/);
assert.doesNotMatch(test, /npm audit[^\n]*--omit=dev/);
assert.match(test, /npm pack \\\n\s+--ignore-scripts/);
assert.match(
  test,
  /node scripts\/test-package-install\.mjs "\$RUNNER_TEMP\/\$tarball"/,
);
assert.match(test, /node scripts\/verify-package-files\.mjs/);
assert.match(test, /npm view "nextane@\$version" version/);
assert.match(test, /Resuming the reserved but unpublished release/);

const reserve = job(ci, "reserve");
assert.match(reserve, /needs: test/);
assert.match(reserve, /permissions:\n\s+contents: write/);
assert.doesNotMatch(reserve, /\bid-token: write\b/);
assert.match(reserve, /git push origin "refs\/tags\/\$tag"/);

const publish = job(ci, "publish");
assert.match(publish, /needs:\n\s+- test\n\s+- reserve/);
assert.match(publish, /contents: read/);
assert.match(publish, /id-token: write/);
assert.doesNotMatch(publish, /contents: write/);
assert.doesNotMatch(publish, /actions\/checkout@/);
assert.doesNotMatch(publish, /\bnpm (?:ci|install)\b/);
assert.match(publish, /test "\$TARBALL" = "nextane-\$VERSION\.tgz"/);
assert.match(publish, /tar -xOf "release\/\$TARBALL" package\/package\.json/);
assert.match(publish, /Downloaded package identity does not match/);
assert.match(publish, /npm view "nextane@\$VERSION" version/);
assert.match(
  publish,
  /npm publish "release\/\$TARBALL" --access public --provenance --ignore-scripts/,
);

console.log(
  `Verified least-privilege release boundaries and action pins in ${workflowFiles.length} workflows.`,
);
