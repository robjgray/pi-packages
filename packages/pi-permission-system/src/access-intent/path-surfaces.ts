/**
 * File tools that only read — never write — the filesystem.
 * Only these tools are eligible for the Pi infrastructure auto-allow.
 */
export const READ_ONLY_PATH_BEARING_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "find",
  "grep",
  "ls",
]);

export const PATH_BEARING_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "find",
  "grep",
  "ls",
]);

/**
 * Surfaces whose patterns are matched against filesystem paths and therefore
 * fold case (and separators) on Windows: the path-bearing tools plus the
 * cross-cutting `path` gate, the `external_directory` boundary gate, and the
 * `bash_path` gate (bash redirect-target tokens). Membership also drives
 * `evaluateAnyValue` (last-match-wins across path aliases) in the manager;
 * non-path surfaces use `evaluateFirst`.
 */
export const PATH_SURFACES: ReadonlySet<string> = new Set([
  ...PATH_BEARING_TOOLS,
  "external_directory",
  "path",
  "bash_path",
]);
