/**
 * pi-preface — top-of-mind injection for pi.
 *
 * Registers extension handlers against the public `ExtensionAPI`:
 *
 *   - `session_start` → (re)load the preface content from disk (global +
 *     project). `session_start` fires on startup and on `/reload`, so edits to
 *     the markdown files are picked up without a full restart.
 *   - `context`       → before every LLM call, compose the `<preface>` block
 *     from the cached content and prepend it to the latest user-side message.
 *     The transform is transient: it shapes what the provider sees, never the
 *     persisted transcript (the agent loop uses `transformContext` only for the
 *     `convertToLlm` step). The same event also appends a `preface` custom
 *     entry so the user can see exactly when/where preface fired in the
 *     transcript history.
 *
 * Visibility: every send appends one `[preface]` block (rendered in the
 * `[skill]` vein — purple `customMessageBg`) naming the contributing file(s) by
 * absolute path. The block is a custom entry — UI-only, not sent to the LLM —
 * so the indicator costs zero model tokens. It IS persisted to the session
 * JSONL (one line per send), which is the deliberate trade: a visible per-send
 * history record at the cost of some transcript/file clutter.
 *
 * No tools, no commands — preface is a listener only.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { composePrefaceBlock } from "#src/content";
import { injectPreface } from "#src/inject";
import { PrefaceSettings } from "#src/settings";

const ENTRY_TYPE = "preface";

/** Data persisted with each `preface` entry (UI-only, not sent to the LLM). */
interface PrefaceEntryData {
  globalPath: string | undefined;
  projectPath: string | undefined;
}

export default function (pi: ExtensionAPI): void {
  const settings = new PrefaceSettings();

  // `[skill]`-vein renderer: purple background, `[preface]` label, absolute
  // path line(s) labelled by layer. Matches the SkillInvocationMessageComponent
  // styling so it reads as the same category of artifact.
  pi.registerEntryRenderer<PrefaceEntryData>(ENTRY_TYPE, (entry, _opts, theme) => {
    const d = entry.data;
    if (!d || (!d.globalPath && !d.projectPath)) return undefined;
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    const label = theme.fg("customMessageLabel", "\x1b[1m[preface]\x1b[22m");
    const lines: string[] = [];
    if (d.globalPath) lines.push(`Preface (Global): ${d.globalPath}`);
    if (d.projectPath) lines.push(`Preface (Project): ${d.projectPath}`);
    box.addChild(new Text(`${label} ${theme.fg("customMessageText", lines[0])}`, 0, 0));
    for (const line of lines.slice(1)) {
      box.addChild(new Text(theme.fg("customMessageText", line), 0, 0));
    }
    return box;
  });

  pi.on("session_start", (_event, ctx) => {
    settings.load(ctx.cwd, getAgentDir());
  });

  pi.on("context", (event, ctx) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return; // nothing configured — leave the context untouched
    // Visible per-send record in the transcript (persisted, UI-only).
    pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, {
      globalPath: settings.globalPath,
      projectPath: settings.projectPath,
    });
    return { messages: injectPreface(event.messages, block) };
  });
}