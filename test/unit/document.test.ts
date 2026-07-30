import { describe, expect, it } from "vitest";
import {
  NextScript,
  serializeInlineNextData,
} from "nextane/document";

describe("custom Document inline data", () => {
  it("escapes every character that can break out of an inline script", () => {
    const value = {
      attack: "</script><script>alert('xss')</script>",
      html: "a&b>c",
      separators: "\u2028\u2029",
    };
    const serialized = serializeInlineNextData(value);

    expect(serialized).not.toMatch(/[<>&\u2028\u2029]/);
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u0026");
    expect(NextScript.getInlineScriptSource({ __NEXT_DATA__: value })).toBe(
      serialized,
    );
    expect(serializeInlineNextData(undefined)).toBe("null");
  });
});
