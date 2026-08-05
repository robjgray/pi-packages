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
 * Loading is wired to `session_start` (which also fires on `/reload`, new,
 * resume, and fork), so edits to either file take effect on the next
 * `/reload` without a full restart.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PREFACE_FILENAME = "preface.md";

export class PrefaceSettings {
  private _content = "";
  private _sources: string[] = [];

  get content(): string {
    return this._content;
  }

  /** Absolute paths that contributed non-empty content, global first then project. */
  get sources(): string[] {
    return this._sources;
  }

  /** Read global + project files and cache the concatenation. Safe to call on every session_start. */
  load(cwd: string, agentDir: string): void {
    const globalPath = join(agentDir, PREFACE_FILENAME);
    const projectPath = join(cwd, ".pi", PREFACE_FILENAME);
    const globalText = readTextFile(globalPath);
    const projectText = readTextFile(projectPath);
    const sources: string[] = [];
    const parts: string[] = [];
    if (globalText.trim()) {
      sources.push(globalPath);
      parts.push(globalText);
    }
    if (projectText.trim()) {
      sources.push(projectPath);
      parts.push(projectText);
    }
    this._content = parts.join("\n\n");
    this._sources = sources;
  }
}

/** Read a file as UTF-8 text, returning `""` for missing/unreadable files. */
function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}
