/**
 * settings.ts — Layered loader for `preface.json`.
 *
 * Mirrors pi's layered config convention (global provides a baseline, project
 * adds project-specific entries), but for structured JSON:
 *
 *   1. Global:    `<agentDir>/preface.json`   (~/.pi/agent/preface.json)
 *   2. Project:   `<cwd>/.pi/preface.json`
 *
 * Each file is parsed via the lenient `parsePrefaceConfig`; the two layers'
 * entries are concatenated global-then-project by declaration order. A missing
 * file is silent; a malformed file or entry degrades to the valid entries plus
 * warnings (never throws, never blocks the session).
 *
 * `globalPath` / `projectPath` expose the absolute path of each contributing
 * file (undefined when that layer is absent or contributed no valid entries)
 * so the footer notice can label them without re-deriving the paths.
 *
 * Loading is wired to `session_start` (which also fires on `/reload`, new,
 * resume, and fork), so edits to either file take effect on the next
 * `/reload` without a full restart.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PrefaceEntry, parsePrefaceConfig } from "#src/schema";

const PREFACE_FILENAME = "preface.json";

export class PrefaceSettings {
  private _entries: PrefaceEntry[] = [];
  private _globalPath: string | undefined;
  private _projectPath: string | undefined;
  private _warnings: string[] = [];

  get entries(): PrefaceEntry[] {
    return this._entries;
  }

  /** Absolute path of the contributing global file, or undefined if absent/empty. */
  get globalPath(): string | undefined {
    return this._globalPath;
  }

  /** Absolute path of the contributing project file, or undefined if absent/empty. */
  get projectPath(): string | undefined {
    return this._projectPath;
  }

  /** Warnings collected from the last load (malformed JSON, unknown `when`, missing `body`). */
  get warnings(): string[] {
    return this._warnings;
  }

  /** Read global + project files and cache the concatenated entries. Safe to call on every session_start. */
  load(cwd: string, agentDir: string): void {
    const globalPath = join(agentDir, PREFACE_FILENAME);
    const projectPath = join(cwd, ".pi", PREFACE_FILENAME);

    this._entries = [];
    this._globalPath = undefined;
    this._projectPath = undefined;
    this._warnings = [];

    const globalResult = readPrefaceFile(globalPath);
    if (globalResult) {
      this._globalPath = applyLayer(globalResult, globalPath, this._entries, this._warnings);
    }

    const projectResult = readPrefaceFile(projectPath);
    if (projectResult) {
      this._projectPath = applyLayer(projectResult, projectPath, this._entries, this._warnings);
    }
  }
}

/** The decoded JSON of a `preface.json` file, or an error from decoding. */
interface PrefaceFileResult {
  raw: unknown;
  error?: string;
}

/** Set the path for a layer when it contributed at least one valid entry. Returns the path or undefined. */
function applyLayer(
  result: PrefaceFileResult,
  path: string,
  entries: PrefaceEntry[],
  warnings: string[],
): string | undefined {
  if (result.error) {
    warnings.push(`${path}: ${result.error}`);
    return undefined;
  }
  const parsed = parsePrefaceConfig(result.raw);
  for (const warning of parsed.warnings) {
    warnings.push(`${path}: ${warning}`);
  }
  entries.push(...parsed.entries);
  return parsed.entries.length > 0 ? path : undefined;
}

/** Read and JSON-decode a `preface.json` file. Returns `undefined` for a missing file (silent). */
function readPrefaceFile(path: string): PrefaceFileResult | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    // ENOENT is the expected "no file configured" case — silent. Anything else
    // (permissions, encoding, EISDIR) would silently no-op the layer, so warn
    // so the user can diagnose it instead of guessing why preface is off.
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      console.warn(`pi-preface: could not read ${path}: ${(err as Error).message}`);
    }
    return undefined;
  }
  try {
    return { raw: JSON.parse(text) };
  } catch (err) {
    return { raw: undefined, error: `malformed JSON: ${(err as Error).message}` };
  }
}
