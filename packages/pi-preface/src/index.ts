/**
 * pi-preface — top-of-mind injection for pi.
 *
 * Registers two extension handlers against the public `ExtensionAPI`:
 *
 *   - `session_start` → (re)load the preface content from disk (global +
 *     project). `session_start` fires on startup and on `/reload`, so edits to
 *     the markdown files are picked up without a full restart.
 *   - `context`       → before every LLM call, compose the `<preface>` block
 *     from the cached content and prepend it to the latest user-side message.
 *     The transform is transient: it shapes what the provider sees, never the
 *     persisted transcript (the agent loop uses `transformContext` only for the
 *     `convertToLlm` step).
 *
 * Visibility: the injection itself is transient and never appears in the TUI.
 * So that the user can see preface is active, a one-time `preface` custom entry
 * is appended on a fresh session (`startup`/`new`) — a single dim line
 * `preface: <path(s)>` rendered in the transcript, not sent to the LLM. It does
 * not repeat per turn or per reload, keeping the transcript uncluttered.
 *
 * No tools, no commands — preface is a listener only, which is why the package
 * has no `@sinclair/typebox` dependency.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { composePrefaceBlock } from "#src/content";
import { injectPreface } from "#src/inject";
import { PrefaceSettings } from "#src/settings";

/** Data persisted with the `preface` custom entry (UI-only, not sent to the LLM). */
interface PrefaceEntryData {
  /** Display-friendly paths that contributed, global first then project. */
  sources: string[];
  /** Total character count of the concatenated preface content. */
  chars: number;
}

const ENTRY_TYPE = "preface";
/** Session-start reasons that begin a fresh transcript, where the notice belongs. */
const FRESH_START_REASONS = new Set(["startup", "new"]);

export default function (pi: ExtensionAPI): void {
  const settings = new PrefaceSettings();

  // One-time, UI-only notice. No background (dimmer than the skill block) so it
  // reads as a quiet status line, not a prominent card.
  pi.registerEntryRenderer<PrefaceEntryData>(ENTRY_TYPE, (entry, _opts, theme) => {
    const data = entry.data;
    if (!data || data.sources.length === 0) return undefined;
    const box = new Box(1, 1, (text) => text);
    box.addChild(
      new Text(
        theme.fg("accent", "preface:") + theme.fg("dim", ` ${data.sources.join(" + ")}`),
        0,
        0,
      ),
    );
    return box;
  });

  pi.on("session_start", (event, ctx) => {
    settings.load(ctx.cwd, getAgentDir());
    if (settings.content && FRESH_START_REASONS.has(event.reason)) {
      pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, {
        sources: settings.sources.map((p) => displayPath(p, ctx.cwd)),
        chars: settings.content.length,
      });
    }
  });

  pi.on("context", (event) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return; // nothing configured — leave the context untouched
    return { messages: injectPreface(event.messages, block) };
  });
}

/** Shorten an absolute path for display: project files relative to cwd, global files tilde-expanded. */
function displayPath(path: string, cwd: string): string {
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  const home = process.env.HOME ?? "";
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}