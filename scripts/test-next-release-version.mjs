import assert from "node:assert/strict";
import test from "node:test";

import { nextReleaseVersion } from "./next-release-version.mjs";

test("uses a local version that has not been published yet", () => {
  assert.equal(nextReleaseVersion("0.1.1", "0.1.0"), "0.1.1");
});

test("increments the published patch when the repository is current", () => {
  assert.equal(nextReleaseVersion("0.1.1", "0.1.1"), "0.1.2");
});

test("increments from the registry when the repository is behind", () => {
  assert.equal(nextReleaseVersion("0.1.1", "0.1.4"), "0.1.5");
});

test("respects an explicit newer minor version", () => {
  assert.equal(nextReleaseVersion("0.2.0", "0.1.9"), "0.2.0");
});

test("rejects prerelease and malformed versions", () => {
  assert.throws(() => nextReleaseVersion("0.1.1-beta.1", "0.1.0"));
  assert.throws(() => nextReleaseVersion("latest", "0.1.0"));
});
