import { describe, expect, it } from "vitest";
import {
  composeForemostBlock,
  FOREMOST_TAG,
  MAX_BYTES,
  truncateUtf8,
} from "#src/content";

describe("composeForemostBlock", () => {
  it("returns empty string for empty or whitespace-only content", () => {
    expect(composeForemostBlock("")).toBe("");
    expect(composeForemostBlock("   \n\t  \n")).toBe("");
  });

  it("wraps trimmed content in the foremost tag", () => {
    const block = composeForemostBlock("  be careful  ");
    expect(block).toBe(`<${FOREMOST_TAG}>\nbe careful\n</${FOREMOST_TAG}>`);
  });

  it("preserves inner whitespace and newlines", () => {
    const block = composeForemostBlock("line one\nline two");
    expect(block).toContain("line one\nline two");
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
    // "é" is 2 bytes in UTF-8; "café" = c(1) a(1) f(1) é(2) = 5 bytes.
    // A 4-byte cut must drop the é entirely rather than splitting it.
    expect(truncateUtf8("café", 4)).toBe("caf");
  });

  it("respects MAX_BYTES without splitting a 4-byte emoji", () => {
    // "a" + 😀 (4 bytes) = 5 bytes. A 4-byte cut keeps "a", drops the emoji.
    expect(truncateUtf8("a😀", 4)).toBe("a");
  });

  it("truncates a large string to at most MAX_BYTES", () => {
    const big = "x".repeat(MAX_BYTES + 1000);
    const out = truncateUtf8(big, MAX_BYTES);
    const bytes = new TextEncoder().encode(out).length;
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
  });
});
