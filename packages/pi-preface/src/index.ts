/**
 * pi-preface — top-of-mind injection for pi.
 *
 * Registers extension handlers against the public `ExtensionAPI`:
 *
 *   - `session_start` → (re)load the preface content from disk (global +
 *     project). `session_start` fires on startup and on `/reload`, so edits to
 *     the markdown files are picked up without a full restart.
 *   - `context`       → before every LLM call, compose the `<preface>` block
 *     from the cached content and inject it. Two paths depending on the latest
 *     message's role:
 *       - `user` (first gen of a turn / steer): prepend the block into the user
 *         message. Clean for all providers.
 *       - `toolResult` (tool rounds): append a SEPARATE `user` message carrying
 *         the block — but only on `openai-completions` (ollama), where the
 *         converter keeps it distinct from tool content. On Anthropic this
 *         would break role alternation, so tool rounds are skipped there.
 *     The transform is transient: it shapes what the provider sees, never the
 *     persisted transcript. The same event also appends a `preface` custom
 *     entry so the user can see exactly when/where preface fired.
 *
 * No tools, no commands — preface is a listener only.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { composePrefaceBlock } from "#src/content";
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

  pi.on("context", (event, ctx) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return;

    const last = event.messages[event.messages.length - 1];
    const entryData: PrefaceEntryData = {
      globalPath: settings.globalPath,
      projectPath: settings.projectPath,
    };

    if (last.role === "user") {
      // Prepend into the user message — clean for all providers.
      pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, entryData);
      return { messages: injectPreface(event.messages, block) };
    }

    if (last.role === "toolResult" && ctx.model?.api === "openai-completions") {
      // Append a separate user message after tool results. On openai-completions
      // (ollama), the converter emits it as a standalone role:"user" param — the
      // preface text never enters any tool result's content. Gated to
      // openai-completions because Anthropic rejects consecutive user messages.
      pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, entryData);
      return {
        messages: [
          ...event.messages,
          { role: "user", content: [{ type: "text", text: block }], timestamp: Date.now() },
        ],
      };
    }

    // Other providers + toolResult latest: skip (no safe injection path).
  });
}