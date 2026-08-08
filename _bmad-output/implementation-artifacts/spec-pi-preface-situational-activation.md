---
title: 'Situational pi-preface (skill-gated activation)'
type: 'feature'
created: '2026-08-07'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0a17fe1740a0781d90845b6cb4743160e11a37db'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** pi-preface injects its preface on every generation unconditionally. The user's `~/.pi/agent/preface.json` carries skill-related guidance that is confusing to a model in sessions where no skill has ever been launched.
**Approach:** Make preface entries situational — each entry declares an activation condition expressed as a pi-core-internal term. v1 ships one condition, `skill_launched`, which becomes true the first time any skill is actually invoked in the session and then stays sticky for the rest of the session.

### Relation to pi-tanium (side-quest)

In order for pi-tanium to test reliably, we cannot have the model getting confused about skill calls they didn't make being referenced on every tool call. This enables a clean layering: **always-on** steering lives in pi-tanium's `promptGuidelines` (§A7 of the pi-tanium spec) + `APPEND_SYSTEM.md`; **skill-conditional** guidance lives in `preface.json` `when:"skill_launched"` entries. The always-on layer is tested with no skill active; the skill-conditional layer is tested separately. The implementation lives in **pi-preface**; this spec is incorporated into the pi-tanium spec as a side-quest at the beginning.

## Boundaries & Constraints

**Always:**

- Config is `preface.json` only: global `~/.pi/agent/preface.json` + project `<cwd>/.pi/preface.json`, concatenated global-then-project by declaration order. (`preface.md` is replaced by `preface.json`; no runtime `.md` fallback.)
- Stickiness: once `skill_launched` flips true it remains true for the entire session.
- Injection mechanics unchanged: `role:"user"` for first-gen, `role:"system"` message on tool rounds for openai-completions/ollama (no toolResult contamination); `TURN_CONTEXT_EXPLANATION` appended to system prompt once at `before_agent_start`.
- Condition state is session-scoped: reset on `session_start`; seeded from session history on `resume`/`fork` so a resumed session that previously invoked a skill is active from turn one.
- Unknown `when` values ignored with a warning (never block the session).

**Never:**

- Fading or switching off a preface after activation is OUT of v1 (future version only).
- No separate "enabled" flag or settings UI — presence + condition remains the enable signal.
- Do NOT gate on "a skill is *available*" (system prompt lists available skills at startup). The gate is "a skill has been *invoked*."
- Do NOT invent a new pi-core skill-invocation event — v1 detection rides existing events only.
- Only flip the flag on a `read` of an actual SKILL.md (cached skill `filePath`); reads of other files under a skill `baseDir` (e.g. `references/X.md`) do NOT flip.

## I/O & Edge-Case Matrix

| Scenario | Behavior |
|---|---|
| No skill ever launched, entry `when:"skill_launched"` | flag=false; entry never injected. |
| User runs `/skill:foo` (known skill) | core expands to a `<skill …>` block in the user message; `context` event scans latest user message via `parseSkillBlock`, flips flag→true before the first LLM call of this turn; entry injected this and every subsequent generation. |
| User runs `/skill:unknown` (unknown skill) | core passes it through unexpanded (no `<skill>` block); `parseSkillBlock` returns null; flag does NOT flip. |
| Model `read`s SKILL.md autonomously | `tool_call` `read` of a cached skill filePath flips flag→true; entry injected next generation. `read` of a non-SKILL.md skill asset does NOT flip. |
| Malformed JSON / missing `body` | skip that entry, warn, keep valid entries; never throw. |
| Unknown `when` term | entry ignored + warning. |
| Resume/fork with prior skill use | `session_start` seeder scans `ctx.sessionManager.getEntries()` user messages via `parseSkillBlock`; flag seeded true. |

</frozen-after-approval>

## Code Map

- `packages/pi-preface/src/schema.ts` -- NEW, pure: `PrefaceWhen` (`"always"|"skill_launched"`), `PrefaceEntry { when; body }`, `parsePrefaceConfig(raw): { entries: PrefaceEntry[]; warnings: string[] }` — lenient array parser. Non-array/malformed JSON → empty + warn; unknown `when` → skip + warn; missing/empty `body` → skip + warn.
- `packages/pi-preface/src/settings.ts` -- REWRITE: reads `~/.pi/agent/preface.json` + `<cwd>/.pi/preface.json`, parses each via `parsePrefaceConfig`, concatenates global-then-project by declaration order. Exposes `entries`, `globalPath`, `projectPath`, `warnings`. Replaces the `.md` loader.
- `packages/pi-preface/src/conditions.ts` -- NEW, pure: sticky `ConditionState` (monotonic `skillLaunched` flag; `reset()`; `flipOnSkill()`); `scanUserMessageForSkill(text)` wrapping the exported `parseSkillBlock`; `matchReadToSkill(path, skillFilePaths: Set<string>)`; `extractMessageText(content)` (string | `TextContent[]` → string); `seedFromHistory(entries, state)` — filters `entry.type === "message" && entry.message.role === "user"`, extracts `entry.message.content` text, flips if any parses.
- `packages/pi-preface/src/content.ts` -- CHANGE signature: `composePrefaceBlock(entries: PrefaceEntry[])` — concatenate active entries' `body`s in order, wrap `<turn-context>`. Keep `TURN_CONTEXT_EXPLANATION`, `TURN_CONTEXT_TAG`, `MAX_BYTES`, `truncateUtf8`.
- `packages/pi-preface/src/inject.ts` -- UNCHANGED.
- `packages/pi-preface/src/index.ts` -- REWRITE wiring: `session_start` → `settings.load` + `state.reset()` + seed on `resume`/`fork`; `before_agent_start` → cache `skillFilePaths` from `event.systemPromptOptions.skills` + append `TURN_CONTEXT_EXPLANATION`; `context` → detect (latest user msg → `scanUserMessageForSkill` → `flipOnSkill`), compute active entries, compose, inject + `appendEntry`; `before_provider_request` → tool-round active-entries injection (ollama); `tool_call` → `event.toolName === "read"` && `matchReadToSkill` → `flipOnSkill`.
- pi-core `packages/coding-agent/src/core/agent-session.ts:120-133` -- `parseSkillBlock(text): ParsedSkillBlock | null`, EXPORTED via `src/index.ts:21,23`. Regex anchored `^<skill name="…" location="…">\n…\n</skill>(?:\n\n…)?$` — the block must be the ENTIRE message text; `extractMessageText` joins `TextContent[].text` so the full user message is passed.
- pi-core `packages/coding-agent/src/core/agent-session.ts:1301-1329` -- `_expandSkillCommand` produces the `<skill>` block; unknown skills pass through unexpanded → `parseSkillBlock` returns null → no flip.
- pi-core `packages/coding-agent/src/core/skills.ts:74-81` -- `Skill { name; description; filePath; baseDir; sourceInfo; disableModelInvocation }`.
- pi-core `packages/coding-agent/src/core/extensions/types.ts:702-711` -- `BeforeAgentStartEvent.systemPromptOptions: BuildSystemPromptOptions` (carries `skills?: Skill[]`; `system-prompt.ts:8-26`).
- pi-core `packages/coding-agent/src/core/extensions/types.ts:670-673` -- `ContextEvent { messages: AgentMessage[] }`; `UserMessage.content: string | (TextContent|ImageContent)[]` (`packages/ai/src/types.ts:394-398`).
- pi-core `packages/coding-agent/src/core/extensions/types.ts:853-894,1071-1075` -- `ToolCallEvent` union; `ReadToolCallEvent.input.path`; block via `{ block: true, reason }`.
- pi-core `packages/coding-agent/src/core/extensions/types.ts:562-568` -- `SessionStartEvent.reason: "startup"|"reload"|"new"|"resume"|"fork"`; `ctx.sessionManager.getEntries(): SessionEntry[]` (`session-manager.ts:1301`); `SessionMessageEntry.message: AgentMessage` (`session-manager.ts:48-52`) — entries do NOT have top-level `.role`/`.content`, access via `entry.message`.
- `packages/pi-preface/test/` -- `settings.test.ts`, `content.test.ts`, `index.test.ts` REWRITE; NEW `schema.test.ts`, `conditions.test.ts`; `inject.test.ts` UNCHANGED.

## Tasks & Acceptance

**Execution:**

- [x] `src/schema.ts` -- define `PrefaceWhen`/`PrefaceEntry` + `parsePrefaceConfig` lenient parser -- structured config + validation.
- [x] `src/conditions.ts` -- sticky `ConditionState`; `scanUserMessageForSkill` (wraps `parseSkillBlock`); `matchReadToSkill`; `extractMessageText`; `seedFromHistory` -- the gating engine.
- [x] `src/settings.ts` -- load `preface.json` global+project via `parsePrefaceConfig`, concatenate -- config loading (replaces `.md` loader).
- [x] `src/content.ts` -- change `composePrefaceBlock` to take `PrefaceEntry[]` -- multi-entry composition.
- [x] `src/index.ts` -- wire 5 handlers (`session_start`, `before_agent_start`, `context`, `before_provider_request`, `tool_call`) -- wire detection to injection.
- [x] `test/schema.test.ts` -- NEW: lenient parsing, warnings, unknown `when`, missing `body`, malformed JSON.
- [x] `test/conditions.test.ts` -- NEW: monotonic flag, `scanUserMessageForSkill` (known/unknown), `matchReadToSkill` (SKILL.md vs `references/X.md`), `seedFromHistory` (resume with/without skill block).
- [x] `test/settings.test.ts` -- REWRITE: `.json` loading, global+project concat, warnings surfacing.
- [x] `test/content.test.ts` -- REWRITE: `composePrefaceBlock(entries)` multi-entry + empty filtering.
- [x] `test/index.test.ts` -- REWRITE: full I/O matrix (no skill → no inject; `/skill:<known>` → inject this+subsequent; `/skill:<unknown>` → no inject; `read` SKILL.md → active next gen; `read` `references/X.md` → not active; resume with history → active turn one).
- [x] `README.md` -- update config docs: `preface.json` array-of-`{when,body}`, `when` enum, golden config example, behavior notes.

**Acceptance Criteria:**

- Given `preface.json` with one `{when:"skill_launched"}` entry, when a session runs with no skill invocation, then no preface block is injected (transcript `preface` custom entry absent/empty).
- Given the same config, when the user runs `/skill:<known>`, then the preface block is injected on that turn's first generation and every subsequent generation; running `/skill:<unknown>` does NOT inject.
- Given the same config, when the model `read`s an actual SKILL.md, then the entry is active from the next generation; reading a non-SKILL.md skill asset does NOT activate it.
- Given a resumed session whose history contains a `<skill>` block, when `session_start` fires with reason "resume", then the entry is active from the first generation.

## Spec Change Log

## Design Notes

**Skill-detection mechanism (linchpin).** There is NO dedicated skill-invoked event in pi-core (verified — `core/extensions/types.ts` event union has none). Two real detection paths, both flipping a monotonic flag:

1. User `/skill:name` — `_expandSkillCommand` (`agent-session.ts:1301-1329`) rewrites input into a `<skill name="…" location="…">…</skill>` block delivered as a user message. At the `context` event (fires before each LLM call), scan the latest `role === "user"` message's text with the exported `parseSkillBlock` (`agent-session.ts:120-133`); non-null → `flipOnSkill()`. Unknown skills pass through unexpanded → `parseSkillBlock` returns null → no flip. DRYs with the resume-seeding path (same parser).
2. Model autonomously `read`s SKILL.md — `tool_call` event, `event.toolName === "read"` and `event.input.path` resolves to a cached skill `filePath`. filePaths are cached each `before_agent_start` from `event.systemPromptOptions.skills: Skill[]` (confirmed `Skill` has `filePath`, `skills.ts:74-81`).

`parseSkillBlock`'s regex is anchored `^…$` — the skill block must be the **entire** message text, so `extractMessageText` joins `TextContent[].text` (for array-form `content`) and passes the full user-message string; a block embedded mid-message would not match (and `_expandSkillCommand` never produces that shape anyway).

**Session-entry shape (correction to the spec's assumption).** `ctx.sessionManager.getEntries()` returns `SessionEntry[]` where the `AgentMessage` lives at `entry.message` — NOT at the top level. Seeder filters `entry.type === "message" && entry.message.role === "user"`, extracts `entry.message.content` via `extractMessageText`, runs `parseSkillBlock`; any non-null result seeds the flag true.

**Reload-stickiness consequence (conscious, per frozen intent).** `session_start` resets the flag and only `resume`/`fork` re-seed from history. A mid-session `/reload` (reason `"reload"`) therefore resets the flag to false until the next invocation. The `appendEntry` custom-entry mechanism (which survives reload — `types.ts:1312`) is a future enhancement, NOT implemented in v1 per the frozen Never ("no separate enabled flag").

**Format: structured JSON.** `preface.json` = array of `{ when, body }`. `when` enum v1: `"always"` (injected every generation regardless of flag) and `"skill_launched"` (injected only while the flag is true); unknown values ignored + warn (forward-compatible). Active-entry computation per generation: `entries.filter(e => e.when === "always" || (e.when === "skill_launched" && state.skillLaunched))`. Body is prompt-injected markdown prose.

**Golden config** (`~/.pi/agent/preface.json`):

```json
[
  {
    "when": "skill_launched",
    "body": "Follow skill instructions as authoritative, including checkpoints and approval gates. Do not self-approve checkpoints."
  }
]
```

## Verification

**Commands:**

- `pnpm --filter @gotgenes/pi-preface run check` -- expected: tsc clean.
- `pnpm --filter @gotgenes/pi-preface run test` -- expected: all tests pass.
- `pnpm --filter @gotgenes/pi-preface run lint` -- expected: biome + rumdl clean.

**Manual checks:**

- `pi -e packages/pi-preface` with a `{when:"skill_launched"}` entry and NO skill use; inspect transcript — expected: empty `preface` custom entry. Run `/skill:<known>` — expected: `preface` populated on that and all subsequent generations. Run `/skill:<unknown>` — expected: still empty.
- `pi -e packages/pi-preface`; have the model `read` an actual SKILL.md — expected: active from next generation. `read` a skill's `references/X.md` — expected: NOT active.
- Resume a session that previously invoked a skill; confirm active on first generation without re-invoking.
- Malformed `preface.json` → warning + degrade to valid entries only (no crash).

## Suggested Review Order

**Entry point & handler wiring**

- Lead stop — the five handlers that wire detection to injection; read first to grasp the design.
  [`index.ts:90`](../../packages/pi-preface/src/index.ts#L90)

- `context` handler: scans latest user message for a `<skill>` block, flips, then injects on first generation.
  [`index.ts:110`](../../packages/pi-preface/src/index.ts#L110)

- `tool_call` handler: autonomous `read` of a cached skill `filePath` flips the flag (active next generation).
  [`index.ts:157`](../../packages/pi-preface/src/index.ts#L157)

- `before_provider_request`: tool-round system-message insertion on openai-completions (ollama) — no toolResult contamination.
  [`index.ts:137`](../../packages/pi-preface/src/index.ts#L137)

- `before_agent_start`: caches skill `filePath`s from `systemPromptOptions.skills` + appends the turn-context explanation.
  [`index.ts:103`](../../packages/pi-preface/src/index.ts#L103)

- `activeEntries` filter: `always` plus `skill_launched` entries once the flag is true.
  [`index.ts:64`](../../packages/pi-preface/src/index.ts#L64)

**Gating engine**

- Sticky `ConditionState` — monotonic `skillLaunched` flag, `reset()` on session_start, `flipOnSkill()`.
  [`conditions.ts:19`](../../packages/pi-preface/src/conditions.ts#L19)

- `scanUserMessageForSkill` — wraps pi-core's exported `parseSkillBlock`; non-null flips (handles `/skill:<known>`).
  [`conditions.ts:48`](../../packages/pi-preface/src/conditions.ts#L48)

- `seedFromHistory` — scans `entry.message` user messages on resume/fork; the session-entry-shape correction lives here.
  [`conditions.ts:86`](../../packages/pi-preface/src/conditions.ts#L86)

- `matchReadToSkill` — exact `Set.has` on resolved paths (deferred: symlink/case normalization).
  [`conditions.ts:57`](../../packages/pi-preface/src/conditions.ts#L57)

- `extractMessageText` — joins `TextContent[].text` so the full user message reaches `parseSkillBlock`.
  [`conditions.ts:67`](../../packages/pi-preface/src/conditions.ts#L67)

**Config schema & loading**

- `parsePrefaceConfig` — lenient array parser; unknown `when`/missing `body`/malformed JSON → skip + warn, never throw.
  [`schema.ts:32`](../../packages/pi-preface/src/schema.ts#L32)

- `PrefaceSettings.load` — reads global + project `preface.json`, concatenates by declaration order, collects warnings.
  [`settings.ts:56`](../../packages/pi-preface/src/settings.ts#L56)

- `applyLayer` — per-layer parse + warning routing (warnings are surfaced by `index.ts` via `console.warn`).
  [`settings.ts:84`](../../packages/pi-preface/src/settings.ts#L84)

**Composition**

- `composePrefaceBlock` — concatenates active entries' bodies and wraps `<turn-context>`.
  [`content.ts:38`](../../packages/pi-preface/src/content.ts#L38)

**Peripherals**

- Index suite — covers every I/O matrix row (no-skill, `/skill:<known>`/`<unknown>`, `read` SKILL.md vs references/X.md, resume/fork seed, warnings surfacing).
  [`index.test.ts:123`](../../packages/pi-preface/test/index.test.ts#L123)

- Conditions suite — monotonic flag, detection, read-match, history seeding.
  [`conditions.test.ts`](../../packages/pi-preface/test/conditions.test.ts)

- Schema suite — lenient parsing + warnings.
  [`schema.test.ts`](../../packages/pi-preface/test/schema.test.ts)

- README — `preface.json` format, `when` enum, golden config, activation rules.
  [`README.md`](../../packages/pi-preface/README.md)