/**
 * pi-preface — situational top-of-mind injection for pi.
 *
 * Each `preface.json` entry declares an activation condition (`when`):
 *
 *   - `"always"` — injected every generation regardless of skill state.
 *   - `"skill_launched"` — injected only while the sticky `skillLaunched` flag
 *     is true (flips the first time any skill is invoked and stays true for
 *     the rest of the session).
 *
 * Five extension handlers:
 *
 *   - `session_start` → reload settings, reset condition state, and seed from
 *     session history on `resume`/`fork` (so a resumed session that previously
 *     invoked a skill is active from turn one).
 *   - `before_agent_start` → cache skill `filePath`s from
 *     `systemPromptOptions.skills` and append the `<turn-context>` explanation
 *     to the system prompt (once per agent start).
 *   - `context` → before each LLM call, scan the latest user message for a
 *     `<skill>` block (a `/skill:<known>` expansion) and flip the flag if
 *     found; compute active entries; on first generation (latest is `user`)
 *     prepend the wrapper. Tool rounds are NOT handled here (injecting into
 *     `toolResult` contaminates tool output on ollama).
 *   - `before_provider_request` → on tool-round generations (latest payload
 *     message is `role: "tool"`), insert a `role: "system"` message carrying
 *     the wrapper into the OpenAI payload (ollama hoists/merges it — no
 *     contamination). First-gen is handled by the `context` event.
 *   - `tool_call` → on a `read` of a cached skill `filePath` (an actual
 *     `SKILL.md`), flip the flag. Reads of other skill assets do NOT flip.
 *
 * A `preface` custom entry is appended each generation (from whichever handler
 * fired) for transcript visibility.
 */

import { resolve } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import {
  ConditionState,
  extractMessageText,
  matchReadToSkill,
  scanUserMessageForSkill,
  seedFromHistory,
} from "#src/conditions";
import { composePrefaceBlock, TURN_CONTEXT_EXPLANATION } from "#src/content";
import { injectPreface } from "#src/inject";
import { type PrefaceEntry } from "#src/schema";
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

/** Entries active under the current condition state: `always` plus any `skill_launched` once the flag is true. */
function activeEntries(entries: PrefaceEntry[], state: ConditionState): PrefaceEntry[] {
  return entries.filter(
    (e) => e.when === "always" || (e.when === "skill_launched" && state.skillLaunched),
  );
}

export default function (pi: ExtensionAPI): void {
  const settings = new PrefaceSettings();
  const state = new ConditionState();
  let skillFilePaths = new Set<string>();

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

  pi.on("session_start", (event, ctx) => {
    settings.load(ctx.cwd, getAgentDir());
    for (const warning of settings.warnings) {
      console.warn(`pi-preface: ${warning}`);
    }
    state.reset();
    // Resume/fork: seed the flag from history so a prior skill invocation is
    // active from turn one. Reload/startup/new start clean (re-invocation re-flips).
    if (event.reason === "resume" || event.reason === "fork") {
      seedFromHistory(ctx.sessionManager.getEntries(), state);
    }
  });

  pi.on("before_agent_start", (event) => {
    const skills = event.systemPromptOptions.skills ?? [];
    skillFilePaths = new Set(skills.map((s) => s.filePath));
    return { systemPrompt: event.systemPrompt + TURN_CONTEXT_EXPLANATION };
  });

  // First generation (latest is user): detect skill block, then prepend the wrapper.
  pi.on("context", (event) => {
    // Scan the latest user message for a `/skill:<known>` expansion and flip
    // before computing active entries, so the entry injects on this same turn.
    for (let i = event.messages.length - 1; i >= 0; i--) {
      const message = event.messages[i];
      if (message.role === "user") {
        const text = extractMessageText((message as { content: unknown }).content);
        if (scanUserMessageForSkill(text)) state.flipOnSkill();
        break;
      }
    }

    const block = composePrefaceBlock(activeEntries(settings.entries, state));
    if (!block) return;
    if (event.messages.length === 0) return;
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
    const block = composePrefaceBlock(activeEntries(settings.entries, state));
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

  // Autonomous model `read` of an actual SKILL.md flips the flag (active from
  // the next generation). Reads of other skill assets (references/X.md) do NOT.
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "read") return;
    const path = (event.input as { path?: string }).path;
    if (typeof path !== "string") return;
    const abs = resolve(ctx.cwd, path);
    if (matchReadToSkill(abs, skillFilePaths)) state.flipOnSkill();
  });
}
