import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { writeSmokeManifest } from "../../scripts/upstream/manifest.mjs";
import { upstreamSmokeTestFiles } from "../../scripts/upstream/profiles.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

it("generates an exact allowlisted deploy manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nextane-manifest-test-"));
  temporaryDirectories.push(root);
  const sourceManifest = {
    version: 2,
    suites: {
      [upstreamSmokeTestFiles[0]]: { failed: ["known upstream marker"] },
      "test/e2e/not-selected/index.test.ts": { failed: ["not selected"] },
    },
    rules: { include: ["test/e2e/**/*.test.ts"], exclude: ["anything"] },
  };

  await fs.mkdir(path.join(root, "test"), { recursive: true });
  await fs.writeFile(
    path.join(root, "test/deploy-tests-manifest.json"),
    JSON.stringify(sourceManifest),
  );
  for (const testFile of upstreamSmokeTestFiles) {
    const destination = path.join(root, testFile);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "");
  }

  const output = path.join(root, "filtered.json");
  const manifest = await writeSmokeManifest(root, output);

  expect(Object.keys(manifest.suites)).toEqual(upstreamSmokeTestFiles);
  expect(manifest.rules).toEqual({
    include: upstreamSmokeTestFiles,
    exclude: [],
  });
  expect(manifest.suites[upstreamSmokeTestFiles[0]]).toEqual({
    failed: ["known upstream marker"],
  });
  expect(JSON.parse(await fs.readFile(output, "utf8"))).toEqual(manifest);
});
