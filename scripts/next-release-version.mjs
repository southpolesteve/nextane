import { pathToFileURL } from "node:url";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(
      `Expected a stable semantic version, received "${version}"`,
    );
  }

  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

export function nextReleaseVersion(currentVersion, publishedVersion) {
  const current = parseVersion(currentVersion);
  const published = parseVersion(publishedVersion);

  if (compareVersions(current, published) > 0) {
    return currentVersion;
  }

  return `${published[0]}.${published[1]}.${published[2] + 1}`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(nextReleaseVersion(process.argv[2], process.argv[3]));
}
