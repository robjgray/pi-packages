/**
 * conditions.ts — Pure gating engine for situational preface activation.
 *
 * A sticky, session-scoped `ConditionState` holds the monotonic `skillLaunched`
 * flag. It flips to true the first time any skill is actually invoked in the
 * session (a `/skill:<known>` user message, an autonomous `read` of a
 * `SKILL.md`, or seeded from history on resume/fork) and stays true for the
 * rest of the session.
 *
 * Detection reuses pi-core's exported `parseSkillBlock` (the same parser
 * `_expandSkillCommand` produces blocks for) so the gate is DRY with the
 * resume-seeding path. No dedicated skill-invocation event exists in pi-core;
 * v1 rides existing `context` and `tool_call` events only.
 */

import { parseSkillBlock, type SessionEntry } from "@earendil-works/pi-coding-agent";

/** Sticky, monotonic activation state for a single session. */
export class ConditionState {
  /** True once any skill has been invoked this session; never reverts to false except via `reset()`. */
  skillLaunched = false;

  /** Clear all flags. Called on every `session_start` (reload resets until re-invoked). */
  reset(): void {
    this.skillLaunched = false;
  }

  /** Flip the skill flag on. Monotonic — a no-op once already true. */
  flipOnSkill(): void {
    this.skillLaunched = true;
  }
}

/** Minimal content-block shape observed by text extraction. */
interface TextLike {
  type: string;
  text?: string;
}

/**
 * True when `text` is a `<skill …>…</skill>` block (the shape
 * `_expandSkillCommand` produces for a known `/skill:<name>`), optionally
 * followed by user args. Reuses pi-core's `parseSkillBlock`, whose anchored
 * regex requires the block to start the message and be followed by nothing
 * but an optional `\n\n<args>` trailer — so a block embedded mid-message does
 * not match (and `_expandSkillCommand` never produces that shape anyway).
 */
export function scanUserMessageForSkill(text: string): boolean {
  return parseSkillBlock(text) !== null;
}

/**
 * True when `path` (already resolved to absolute by the caller) is the cached
 * `filePath` of a known skill — i.e. an actual `SKILL.md`. Reads of other
 * assets under a skill `baseDir` (e.g. `references/X.md`) do NOT match.
 */
export function matchReadToSkill(path: string, skillFilePaths: Set<string>): boolean {
  return skillFilePaths.has(path);
}

/**
 * Extract the concatenated text of a message's `content`, whether it is a
 * plain string or an array of content blocks. Image blocks are skipped. Used
 * so the full user-message text is passed to `parseSkillBlock` regardless of
 * the `string | TextContent[]` content form.
 */
export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as TextLike[])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("");
  }
  return "";
}

/**
 * Seed `state` from session history: scan every persisted user message for a
 * `<skill>` block and flip the flag if any is found. Called on `resume`/`fork`
 * so a resumed session that previously invoked a skill is active from turn one.
 *
 * Session entries carry the `AgentMessage` at `entry.message` (not at the top
 * level), so the seeder reads `entry.message.role` and `entry.message.content`.
 */
export function seedFromHistory(entries: SessionEntry[], state: ConditionState): void {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = (entry as { message: { role: string; content: unknown } }).message;
    if (message.role !== "user") continue;
    const text = extractMessageText(message.content);
    if (scanUserMessageForSkill(text)) {
      state.flipOnSkill();
      return;
    }
  }
}
