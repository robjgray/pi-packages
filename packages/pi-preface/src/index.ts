/**
 * pi-preface — top-of-mind injection for pi.
 *
 * Three extension handlers:
 *
 *   - `before_agent_start` → append a brief `<turn-context>` explanation to
 *     the system prompt (once per user turn, persists across tool rounds via
 *     `prepareNextTurn`). Tells the model to recognize the wrapper as
 *     operational context, not as a user request or tool output.
 *
 *   - `context` → before every LLM call, if the latest message is a `user`
 *     message (first generation of a turn), prepend the `<turn-context>`
 *     wrapper to it. Transient — shapes what the provider sees, never the
 *     persisted transcript. Tool rounds are NOT handled here (injecting into
 *     `toolResult` contaminates tool output on ollama).
 *
 *   - `before_provider_request` → on tool-round generations (latest payload
 *     message is `role: "tool"`), insert a `role: "system"` message carrying
 *     the `<turn-context>` wrapper into the OpenAI payload. On ollama, the
 *     `collate` function hoists system messages to the top and merges them
 *     with the base system prompt — the text never enters any `tool` message's
 *     content, so no contamination. The model reads it as standing system
 *     context, not as a new user instruction. Fires per-generation, transient
 *     (payload is rebuilt each call, no accumulation).
 *
 * A `preface` custom entry is appended each generation (from whichever handler
 * fired) for transcript visibility.
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

/** Minimal shape of the OpenAI payload we need to inspect/modify. */
interface OpenAIPayload {
  messages: Array<{ role: string; content?: string }>;
  [key: string]: unknown;
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
    return { systemPrompt: event.systemPrompt + TURN_CONTEXT_EXPLANATION };
  });

  // First generation (latest is user): prepend the wrapper into the user message.
  pi.on("context", (event) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return;
    const last = event.messages[event.messages.length - 1];
    if (last.role !== "user") return; // tool rounds handled by before_provider_request
    pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, {
      globalPath: settings.globalPath,
      projectPath: settings.projectPath,
    });
    return { messages: injectPreface(event.messages, block) };
  });

  // Tool rounds (latest payload message is role: "tool"): insert a system
  // message. On ollama, collate hoists it to the top and merges it with the
  // base system prompt — no contamination, no "new user instruction" effect.
  pi.on("before_provider_request", (event, ctx) => {
    const block = composePrefaceBlock(settings.content);
    if (!block) return;
    if (ctx.model?.api !== "openai-completions") return; // system hoisting is ollama/OpenAI-compatible
    const payload = event.payload as OpenAIPayload;
    if (payload.messages.length === 0) return;
    const lastMsg = payload.messages[payload.messages.length - 1];
    if (lastMsg.role !== "tool") return; // first-gen (user) already handled by context event
    pi.appendEntry<PrefaceEntryData>(ENTRY_TYPE, {
      globalPath: settings.globalPath,
      projectPath: settings.projectPath,
    });
    return {
      ...payload,
      messages: [...payload.messages, { role: "system", content: block }],
    };
  });
}