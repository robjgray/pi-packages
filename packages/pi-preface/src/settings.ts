/**
 * settings.ts — Layered loader for the preface content files.
 *
 * Mirrors pi's layered config convention (global provides a baseline, project
 * adds project-specific context), but for free-form markdown rather than JSON:
 *
 *   1. Global:    `<agentDir>/preface.md`   (~/.pi/agent/preface.md)
 *   2. Project:   `<cwd>/.pi/preface.md`
 *
 * The two are concatenated (global first, then project, separated by a blank
 * line) so a project *adds* reminders without losing the global baseline. A
 * missing file is silent (`""`); a read error is silent too, so a malformed
 * permissions state never blocks startup. When both are absent/empty,
 * `content` is `""` and the extension is a no-op — presence of content is the
 * enabled flag (no separate JSON, per YAGNI).
 *
 * `globalPath` / `projectPath` expose the absolute path of each contributing
 * file (undefined when that layer is absent/empty) so the footer notice can
 * label them without re-deriving the paths.
 *
 * Loading is wired to `session_start` (which also fires on `/reload`, new,
 * resume, and fork), so edits to either file take effect on the next
 * `/reload` without a full restart.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PREFACE_FILENAME = "preface.md";

export class PrefaceSettings {
  private _content = "";
  private _globalPath: string | undefined;
  private _projectPath: string | undefined;

  get content(): string {
    return this._content;
  }

  /** Absolute path of the contributing global file, or undefined if absent/empty. */
  get globalPath(): string | undefined {
    return this._globalPath;
  }

  /** Absolute path of the contributing project file, or undefined if absent/empty. */
  get projectPath(): string | undefined {
    return this._projectPath;
  }

  /** Read global + project files and cache the concatenation. Safe to call on every session_start. */
  load(cwd: string, agentDir: string): void {
    const globalPath = join(agentDir, PREFACE_FILENAME);
    const projectPath = join(cwd, ".pi", PREFACE_FILENAME);
    const globalText = readTextFile(globalPath);
    const projectText = readTextFile(projectPath);
    const parts: string[] = [];
    this._globalPath = undefined;
    this._projectPath = undefined;
    if (globalText.trim()) {
      this._globalPath = globalPath;
      parts.push(globalText);
    }
    if (projectText.trim()) {
      this._projectPath = projectPath;
      parts.push(projectText);
    }
    this._content = parts.join("\n\n");
  }
}

/** Read a file as UTF-8 text, returning `""` for missing/unreadable files. */
function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    // ENOENT is the expected "no file configured" case — silent. Anything else
    // (permissions, encoding, EISDIR) would silently no-op the extension, so
    // warn so the user can diagnose it instead of guessing why preface is off.
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      console.warn(`pi-preface: could not read ${path}: ${(err as Error).message}`);
    }
    return "";
  }
}