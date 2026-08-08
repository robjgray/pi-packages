import { describe, expect, it } from "vitest";
import {
  composePrefaceBlock,
  MAX_BYTES,
  TURN_CONTEXT_TAG,
  truncateUtf8,
} from "#src/content";
import type { PrefaceEntry } from "#src/schema";

function entry(when: PrefaceEntry["when"], body: string): PrefaceEntry {
  return { when, body };
}

describe("composePrefaceBlock", () => {
  it("returns empty string for an empty entries array", () => {
    expect(composePrefaceBlock([])).toBe("");
  });

  it("returns empty string when all bodies are whitespace-only", () => {
    expect(composePrefaceBlock([entry("always", "   \n\t  "), entry("skill_launched", "\n")])).toBe("");
  });

  it("wraps a single entry body in the turn-context tag", () => {
    const block = composePrefaceBlock([entry("always", "be careful")]);
    expect(block).toBe(`<${TURN_CONTEXT_TAG}>\nbe careful\n</${TURN_CONTEXT_TAG}>`);
  });

  it("trims each body before wrapping", () => {
    const block = composePrefaceBlock([entry("always", "  be careful  ")]);
    expect(block).toBe(`<${TURN_CONTEXT_TAG}>\nbe careful\n</${TURN_CONTEXT_TAG}>`);
  });

  it("concatenates multiple active entries in declaration order, blank-line separated", () => {
    const block = composePrefaceBlock([
      entry("always", "first"),
      entry("skill_launched", "second"),
      entry("always", "third"),
    ]);
    expect(block).toBe(`<${TURN_CONTEXT_TAG}>\nfirst\n\nsecond\n\nthird\n</${TURN_CONTEXT_TAG}>`);
  });

  it("drops entries whose body is empty but keeps non-empty siblings", () => {
    const block = composePrefaceBlock([
      entry("always", "keep"),
      entry("skill_launched", "   "),
      entry("always", "keep2"),
    ]);
    expect(block).toBe(`<${TURN_CONTEXT_TAG}>\nkeep\n\nkeep2\n</${TURN_CONTEXT_TAG}>`);
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
