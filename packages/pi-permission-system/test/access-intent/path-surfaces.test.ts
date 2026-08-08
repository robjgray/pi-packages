import { describe, expect, test } from "vitest";

import {
  PATH_BEARING_TOOLS,
  PATH_SURFACES,
  READ_ONLY_PATH_BEARING_TOOLS,
} from "#src/access-intent/path-surfaces";

describe("PATH_BEARING_TOOLS", () => {
  test("contains the expected tool names", () => {
    for (const tool of ["read", "write", "edit", "find", "grep", "ls"]) {
      expect(PATH_BEARING_TOOLS.has(tool)).toBe(true);
    }
  });

  test("does not contain bash or mcp", () => {
    expect(PATH_BEARING_TOOLS.has("bash")).toBe(false);
    expect(PATH_BEARING_TOOLS.has("mcp")).toBe(false);
  });
});

describe("READ_ONLY_PATH_BEARING_TOOLS", () => {
  test("contains read, find, grep, ls", () => {
    for (const tool of ["read", "find", "grep", "ls"]) {
      expect(READ_ONLY_PATH_BEARING_TOOLS.has(tool)).toBe(true);
    }
  });

  test("does not contain write or edit", () => {
    expect(READ_ONLY_PATH_BEARING_TOOLS.has("write")).toBe(false);
    expect(READ_ONLY_PATH_BEARING_TOOLS.has("edit")).toBe(false);
  });
});

describe("PATH_SURFACES", () => {
  test("contains the path-bearing tools plus the cross-cutting gates", () => {
    for (const surface of [
      "read",
      "write",
      "edit",
      "find",
      "grep",
      "ls",
      "external_directory",
      "path",
      "bash_path",
    ]) {
      expect(PATH_SURFACES.has(surface)).toBe(true);
    }
  });

  test("does not contain bash or mcp", () => {
    expect(PATH_SURFACES.has("bash")).toBe(false);
    expect(PATH_SURFACES.has("mcp")).toBe(false);
  });

  // B′: `bash_path` is a path surface so its patterns fold case/separators on
  // Windows and use last-match-wins-across-aliases (evaluateAnyValue) rather
  // than evaluateFirst — the same path semantics as `path` and the tools.
  test("contains bash_path (win32 fold + last-match-wins-across-aliases)", () => {
    expect(PATH_SURFACES.has("bash_path")).toBe(true);
  });
});
