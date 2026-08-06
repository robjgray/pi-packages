import { describe, expect, it } from "vitest";
import { composePrefaceBlock, MAX_BYTES, TURN_CONTEXT_TAG, truncateUtf8 } from "#src/content";

describe("composePrefaceBlock", () => {
  it("returns empty string for empty or whitespace-only content", () => {
    expect(composePrefaceBlock("")).toBe("");
    expect(composePrefaceBlock("   \n\t  \n")).toBe("");
  });

  it("wraps trimmed content in the turn-context tag", () => {
    const block = composePrefaceBlock("  be careful  ");
    expect(block).toBe(`<${TURN_CONTEXT_TAG}>\nbe careful\n</${TURN_CONTEXT_TAG}>`);
  });
});

describe("truncateUtf8", () => {
  it("returns the string unchanged when under the byte limit", () => {
    expect(truncateUtf8("short", 100)).toBe("short");
  });

  it("truncates ASCII at the byte boundary", () => {
    expect(truncateUtf8("abcdef", 3)).toBe("abc");
  });

  it("does not split a multibyte codepoint (UTF-8 safe)", () => {
    expect(truncateUtf8("café", 4)).toBe("caf");
  });

  it("respects MAX_BYTES without splitting a 4-byte emoji", () => {
    expect(truncateUtf8("a😀", 4)).toBe("a");
  });

  it("truncates a large string to at most MAX_BYTES", () => {
    const big = "x".repeat(MAX_BYTES + 1000);
    const out = truncateUtf8(big, MAX_BYTES);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX_BYTES);
  });
});