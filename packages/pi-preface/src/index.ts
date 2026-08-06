/**
 * pi-preface — top-of-mind injection for pi.
 *
 * Two extension handlers:
 *
 *   - `before_agent_start` → append a brief `<turn-context>` explanation to
 *     the system prompt (once per user turn, persists across tool rounds via
 *     `prepareNextTurn`). This tells the model to recognize the wrapper as
 *     operational context, not as a user request or tool output.
 *   - `context` → before every LLM call, compose the `<turn-context>` wrapper
 *     from the cached preface content and prepend it to the latest message's
 *     content (user or toolResult). The transform is transient — it shapes
 *     what the provider sees, never the persisted transcript. A `preface`
 *     custom entry is appended each generation for transcript visibility.
 *
 * This matches goose's TOM pattern (wrap + system-prompt explanation + metadata
 * content) adapted for pi's separate-toolResult architecture.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { composePrefaceBlock, TURN_CONTEXT_EXPLANATION } from "#src/content";
import { injectPreface } from "#src/inject";
import { PrefaceSettings } from "#src/settings";

const ENTRY_TYPE = "preface";

interface PrefaceEntryData {
  globalPath: string | undefined;
  projectPath: string | undefined;
}

export default function (pi: ExtensionAPI): void {
  const settings = new PrefaceSettings();

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

  pi.on("before_agent_start", (event) => {
    // Append the <turn-context> tag explanation to the system prompt. This
    // fires once per user turn and persists across tool rounds (prepareNextTurn
    // re-asserts the override). The explanation is brief — the actual preface
    // content rides in the messages via the context event, not here.
    return { systemPrompt: event.systemPrompt + TURN_CONTEXT_EXPLANATION };
  });

  pi.on("context", (event) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return;
    pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, {
      globalPath: settings.globalPath,
      projectPath: settings.projectPath,
    });
    return { messages: injectPreface(event.messages, block) };
  });
}