import { describe, expect, it } from "vitest";
import {
  namespaceIsrCacheRequest,
  restoreIsrArtifactRequest,
} from "../../src/server/isr-cache";

describe("Workers ISR cache namespaces", () => {
  it("uses the natural URL cache key to isolate every build", async () => {
    const canonical = new Request(
      "https://nextane.internal/posts/octane?attacker=ignored",
      {
        headers: { "x-nextane-only-cached": "1" },
      },
    );

    const first = namespaceIsrCacheRequest(canonical, "build-one");
    const second = namespaceIsrCacheRequest(canonical, "build/two");

    expect(first.url).toBe(
      "https://nextane.internal/_nextane/isr/build-one/posts/octane",
    );
    expect(second.url).toBe(
      "https://nextane.internal/_nextane/isr/build%2Ftwo/posts/octane",
    );
    expect(first.url).not.toBe(second.url);

    const restored = restoreIsrArtifactRequest(first, "build-one");
    expect(restored.url).toBe("https://nextane.internal/posts/octane");
    expect(restored.headers.get("x-nextane-only-cached")).toBe("1");
  });

  it("rejects cache requests from another build namespace", () => {
    const request = new Request(
      "https://nextane.internal/_nextane/isr/old-build/",
    );
    expect(() => restoreIsrArtifactRequest(request, "current-build")).toThrow(
      "outside the current build namespace",
    );
  });
});
