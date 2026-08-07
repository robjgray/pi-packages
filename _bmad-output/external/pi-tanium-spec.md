# pi-tanium — hardening agent file operations

> Durable spec. Supersedes `laguna-editing-spec.md` (kept as the earlier draft).
> Theme: **harden the functions an agent depends on**, starting with `edit` and
> the bash→file-mutation escape hatch. Proposed as a rename/evolution of
> `pi-path-recovery` in the robjgray pi-packages fork → **`pi-tanium`**.

Target model: heavy-reasoning small local models (`laguna-s-2.1`, `laguna-xs-2.1`)
run as pi coding agents. Evidence base: **46 pi sessions** in `~/repos/clickgo`.

---

## 0. The two prongs (refined with the user)

| prong | what | mechanism |
|---|---|---|
| **A. edit hardening** | make `edit` reliable **and close the loop with cheap partial reads** so the model stops abandoning it | code: a `pi-tanium` `edit` + `read` override (extends `pi-path-recovery`) |
| **B. bash steering** | block bash-as-file-editor and point the agent at `read`/`write`/`edit` | **mostly config** — `pi-permission-system` `deny` rules for the detectable forms + a small pi-tanium `tool_call` extension for the residual (heredoc bodies, redirects to source files) |

Prong B is **mostly config** (the `pi-permission-system` `deny`-with-reason
rules handle the detectable forms), plus a **small `tool_call` extension in
pi-tanium** for the residual that config can't see (heredoc bodies, `>` redirects
to source files — see §B3 + §B-fallback).

> **Testability note:** pi-tanium's reliable testing depends on the side-quest
> below (situational `pi-preface`) — the always-on vs skill-conditional split
> keeps the model from receiving skill guidance in sessions where no skill was
> launched, so the always-on layer (§A7 + `APPEND_SYSTEM.md`) can be tested with
> no skill active and the skill-conditional layer tested separately.

---

## Side quest — situational pi-preface (skill-gated activation)

> Implementation lives in **pi-preface** (not pi-tanium). Authored as a pi-tanium
> side-quest because pi-tanium's testability depends on it (see §0 note above).
> Full frozen-intent spec inlined verbatim below; headings downgraded one level
> to nest under this section — zero content loss. The standalone
> `pi-preface-situational-spec.md` is deleted once this inline is verified lossless.

```yaml
title: 'Situational pi-preface (skill-gated activation)'
type: 'feature'
created: '2026-08-07'
status: 'draft'
context: []
```

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

### Intent
**Problem:** pi-preface injects its preface on every generation unconditionally. The user's `~/.pi/agent/preface.json` carries skill-related guidance that is confusing to a model in sessions where no skill has ever been launched.
**Approach:** Make preface entries situational — each entry declares an activation condition expressed as a pi-core-internal term. v1 ships one condition, `skill_launched`, which becomes true the first time any skill is actually invoked in the session and then stays sticky for the rest of the session.

#### Relation to pi-tanium (side-quest)
In order for pi-tanium to test reliably, we cannot have the model getting confused about skill calls they didn't make being referenced on every tool call. This enables a clean layering: **always-on** steering lives in pi-tanium's `promptGuidelines` (§A7 of the pi-tanium spec) + `APPEND_SYSTEM.md`; **skill-conditional** guidance lives in `preface.json` `when:"skill_launched"` entries. The always-on layer is tested with no skill active; the skill-conditional layer is tested separately. The implementation lives in **pi-preface**; this spec is incorporated into the pi-tanium spec as a side-quest at the beginning.

### Boundaries & Constraints
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

### I/O & Edge-Case Matrix
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

### Code Map
- `packages/pi-preface/src/settings.ts` -- load `preface.json` (global + project), parse entries.
- `packages/pi-preface/src/index.ts` -- event handlers; cache skill filePaths from `before_agent_start`; compute active entries per generation from `ConditionState`.
- `packages/pi-preface/src/content.ts` -- `composePrefaceBlock` accepts active entries, concatenates bodies, wraps `<turn-context>`.
- `packages/pi-preface/src/inject.ts` -- unchanged (prepend block / insert system msg).
- NEW `packages/pi-preface/src/conditions.ts` -- sticky `ConditionState` + `context`-time `<skill>`-block scan + `tool_call` read-match + `session_start` seeder.
- NEW `packages/pi-preface/src/schema.ts` -- parse/validate `preface.json`; `when` enum.
- pi-core `core/agent-session.ts` -- exports `parseSkillBlock` (reused for detection + seeding); `before_agent_start` `event.systemPromptOptions.skills: Skill[]`.
- pi-core `core/skills.ts` -- `Skill` shape (`filePath`, `baseDir`, `name`).

### Tasks & Acceptance
**Execution:**
- [ ] `src/schema.ts` -- define `PrefaceEntry { when:"always"|"skill_launched"; body:string }` + lenient array parser -- structured config + validation.
- [ ] `src/conditions.ts` -- sticky `ConditionState`; `context` handler scans latest user message via `parseSkillBlock` → flip; `tool_call` handler matches `read` of cached skill filePath → flip; `session_start` seeder scans entries for resume/fork -- the gating engine.
- [ ] `src/settings.ts` -- load `~/.pi/agent/preface.json` + `<cwd>/.pi/preface.json`, concatenate global-then-project -- config loading.
- [ ] `src/index.ts` -- register handlers; cache skill filePaths from `before_agent_start`; per generation compute active entries from `ConditionState` and compose block -- wire detection to injection.
- [ ] `src/content.ts` -- `composePrefaceBlock(activeEntries)` concatenates bodies in order, wraps `<turn-context>` -- multi-entry composition.

**Acceptance Criteria:**
- Given `preface.json` with one `{when:"skill_launched"}` entry, when a session runs with no skill invocation, then no preface block is injected (transcript `preface` custom entry absent/empty).
- Given the same config, when the user runs `/skill:<known>`, then the preface block is injected on that turn's first generation and every subsequent generation; running `/skill:<unknown>` does NOT inject.
- Given the same config, when the model `read`s an actual SKILL.md, then the entry is active from the next generation; reading a non-SKILL.md skill asset does NOT activate it.
- Given a resumed session whose history contains a `<skill>` block, when `session_start` fires with reason "resume", then the entry is active from the first generation.

### Design Notes

**Skill-detection mechanism (linchpin).** There is NO dedicated skill-invoked event in pi-core (verified in `core/extensions/types.ts`; the event union has none). Skills launch via two real paths:
1. User `/skill:name` — `_expandSkillCommand` (`core/agent-session.ts` ~L1300) rewrites input into a `<skill name="…" location="…">…</skill>` block delivered as a user message. **Detection:** at the `context` event (fires before each LLM call), scan the latest user message with the exported `parseSkillBlock` (`index.ts` L21-23); a non-null result flips the flag. Unknown skills pass through unexpanded, so `parseSkillBlock` returns null → no flip. This DRYs with the resume-seeding path (same parser, same message-scan).
2. Model autonomously `read`s SKILL.md (skills.md "How Skills Work" step 3). **Detection:** `tool_call` event, `event.toolName === "read"` and `event.input.path` resolves to a cached skill `filePath`. The known filePaths are cached each turn from `before_agent_start` `event.systemPromptOptions.skills`, confirmed `Skill[]` with `filePath` (agent-session.ts L1041-1046, system-prompt.ts L23-24).

v1 = sticky boolean flipped by either signal, reset on `session_start`, seeded on resume/fork by scanning entries with `parseSkillBlock`. Existing events only; no new core hook (per Never).

**Format: structured JSON.** Rejected pure-md (no place for a per-entry condition) and md-with-frontmatter (a single .md can't hold multiple independently-gated bodies without a custom delimiter parser). Chosen: `preface.json` = array of `{ when, body }`. The `when` enum is the pi-core-internal condition term: v1 `"always"` and `"skill_launched"`; unknown values ignored with warning (forward-compatible vocab). Body is prompt-injected markdown prose; a JSON string field is fine for the short guidance bullets typical of a preface.

**Golden config** (`~/.pi/agent/preface.json`):
```json
[
  {
    "when": "skill_launched",
    "body": "Follow skill instructions as authoritative, including checkpoints and approval gates. Do not self-approve checkpoints."
  }
]
```

**Stickiness:** user-stated "once a skill has been launched the preface stays" — flag is monotonic within a session, no per-turn re-evaluation cost.

### Verification
**Commands:**
- `cd packages/pi-preface && bun run build` -- expected: type-checks clean.
- `pi -e <pkg>` with a `{when:"skill_launched"}` entry and NO skill use; inspect transcript -- expected: empty `preface` custom entry. Run `/skill:<known>` -- expected: `preface` populated on that and all subsequent generations. Run `/skill:<unknown>` -- expected: still empty.
- `pi -e <pkg>`; have the model `read` an actual SKILL.md -- expected: active from next generation. `read` a skill's `references/X.md` -- expected: NOT active.

**Manual checks:**
- Inspect the `preface` custom entry across a first-gen and a tool round to confirm activation timing + stickiness.
- Resume a session that previously invoked a skill; confirm active on first generation without re-invoking.
- Malformed `preface.json` → warning + degrade to valid entries only (no crash).

---

## 1. Evidence base (concise, from the corpus)

### 1.1 `edit` fails 51% of the time — and the failures are classifiable

64 `edit` calls, 33 errors (48.4% success). Error shapes, inspected per-call:

| shape | ~count | root cause |
|---|---|---|
| `edits` passed as a **stringified single object** `{"oldText":…,"newText":…}` | 2 | schema-shape; pi's recovery misses this (§A1) |
| `edits` passed as an **unparseable string** (malformed JSON under load) | 10 | schema-shape; pi's recovery can't parse it (§A1) |
| `Could not find the exact text…` | 15 | exact-match brittleness — **two sub-patterns** (§A2) |
| legacy top-level `oldText`/`newText` / other | 6 | mostly recovered; a few leak through |

### 1.2 "exact-match-not-found" splits into two sub-patterns (the key finding for §A2)

Line-by-line diff of the real `oldText` against the actual file region (first
line matched at 100% in every case — drift is *inside* the block):

**Sub-pattern A — whitespace/indentation drift** (fixable by normalization):
```
old[1]: '\tconst appID = "com.robjgray.clickgo"'      ← model added a leading tab
file[17]: 'const appID = "com.robjgray.clickgo"'       ← file has none

old[2]: '\ttextHello    = "Hello, World!"'             ← 4 spaces (gofmt misremembered)
file[10]: '\ttextHello   = "Hello, World!"'            ← 3 spaces

old[5]: '\twindowTitle  = "Hello World"'               ← 2 spaces
file[13]: '\twindowTitle = "Hello World"'              ← 1 space
```

**Sub-pattern B — content drift** (NOT fixable by matching — the model
reconstructed the block from memory and got the *words* wrong):
```
old[1]: ''                                              ← model inserted a blank line
file[42]: '**Execution:**'                              ← no blank line in file
old[2]: '**Execution:**'
old[3]: '- [ ] `cmd/tmer/clicker.go` … define ONE accessor …'   ← typo "tmer", different wording
file[44]: '- [ ] `cmd/timer/main.go`: drive the counter from …'← real bullet differs
```

**Implication:** Sub-pattern A wants *whitespace-normalized auto-apply*; Sub-pattern B wants *"show me the actual region so I can re-issue"* — i.e. the user's **"similar lines"** idea, not a "did you mean?" path-recovery style guess.

### 1.3 The markdown escape hatch (Prong B's target)

In the referenced session: **1 failed `edit` → 14 `python3 - <<'PY'` heredoc
calls** to edit one markdown spec, **5 of which also errored** (heredoc quoting
syntax errors, `"ANCHOR NOT FOUND (abort; nothing written)"`, `"residue
present; file unchanged"`). Corpus-wide: 38 python-via-bash file-IO calls, 12
errored (32% — worse than `edit`). The model was reimplementing `edit` badly,
inside bash, at ~10× the token cost.

### 1.4 The code rewrite loop is `write`, not `bash`

`main.go` was **`write`n 22×** in one session. Across all sessions: 55 `write`
on `.go` vs 29 `edit` on `.go`. `edit` on `.go` fails 59% (worse than `.md`'s
43%). Disabling `bash` does **not** fix this — the model full-file-rewrites via
`write`. Fixing `edit` (Prong A) is what makes `write`-loops retreat.

### 1.5 What `bash` is actually used for (don't disable it blindly)

| category | calls | keep? |
|---|---|---|
| search (grep/rg/find/ls/wc) | 411 | yes (low-harm; pi's `grep` tool is ignored 60:1 — separate issue) |
| `cmd > file` redirection | 221 | **gate the source-file subset** |
| go build/test/vet/fmt | 162 | yes — essential for a Go repo |
| git | 118 | yes |
| heredoc (incl. python) | 50 | **gate the file-IO subset** |
| `sed` | 47 | **gate `-i`** |
| fs mutate (cp/mv/rm/mkdir) | 41 | mostly yes |
| python file IO | 38 | **gate — this is the escape hatch** |
| `awk` / `tee` | 16 / 3 | gate when writing |

---

## 2. Prong A — `edit` hardening (code: `pi-tanium` edit override)

Override the built-in `edit` via `pi.registerTool({ name: "edit", … })` — the
same pattern `pi-path-recovery/src/index.ts` already uses. Reuse
`pi-path-recovery/src/match.ts` (Levenshtein + prefix bonus, zero-dep/zero-IO).

### A1. Recover stringified `edits` objects (fixes ~12 of 33)

pi's `edit.js` `prepareArguments` already recovers two degenerate shapes:
1. `edits` as a stringified **array** → `JSON.parse` + `Array.isArray`.
2. top-level legacy `oldText`/`newText` → wrapped into `edits: [{…}]`.

It does **not** recover the shape this model actually produces:

- `edits` = `'{"oldText": "status: draft", "newText": "status: ready-for-dev"}'`
  (stringified **single object**). `JSON.parse` yields an *object*, fails the
  `Array.isArray` guard, and the legacy path can't see `oldText`/`newText`
  (trapped inside the string). → validation failure.

**Fix — layer on pi-core's `prepareArguments`, don't replace it.** Call
`builtin.prepareArguments(input)` first (it already recovers stringified arrays +
top-level legacy `oldText`/`newText`), then apply the recoveries below for the
shapes it misses. Idempotent; return a fresh object (do **not** mutate in place —
avoid pi-tool-guard's in-place mutation anti-pattern, §4.1). The recoveries:

- `edits` is a string → `JSON.parse`:
  - **array** → use it (pi already does this).
  - **single object** with `oldText`/`newText` (or `old`/`new`) → wrap as
    `[{oldText, newText}]`.  ← *the gap.*
  - **unparseable** → don't silently no-op; return a structured error with the
    canonical shape to emit, so the model retries correctly:
    `edits: [{ "oldText": "...", "newText": "..." }]`
- `edits` is a single object (not array-wrapped) → wrap as `[edits]`.
- top-level `old`/`new` (Axe-style) → normalize to `oldText`/`newText`.

### A2. Handle "exact-match-not-found" by sub-pattern (fixes ~15 of 33)

When the built-in's exact match fails, the override runs a **layered (three-stage)**
recovery (exact → normalized → gated multi-pass → similar-lines error), grounded
in the §8.3 source audit:

**Stage 0 — exact:** try pi-core's exact match first (no gate; cheapest path).

**Stage 1 — single-normalized fast path (Sub-pattern A):** normalize both the
file and `oldText` (collapse runs of spaces/tabs to one space, strip trailing
whitespace per line, treat tab⇄space as equivalent, preserve LF) and match.
This one pass covers the bulk of whitespace drift. If exactly one region
matches → **apply there**, restore original line endings, log a `[tanium]` notice
("applied after normalizing whitespace: tab/space/trailing diffs"). Safe: if only
whitespace differs, intent is unambiguous.

**Stage 2 — gated multi-pass fallback:** if Stage 1 fails, run a gated multi-pass
chain (lift pi-semantic-edit's `passes.ts` pass list: line-trim,
indentation-strip, escape, typographic-quote/dash normalization), gated by
pi-tian-edit-safe-style guards (min `oldText` length, NUL/size limits) so the
chain only fires when Stage 1 didn't resolve it. **Mandatory invariant on every
pass** — the single most important safety technique in the audit: after
computing a candidate replacement, re-verify with `original.includes(actual)`
before applying; never write bytes the model didn't sanction. Apply only on a
single unique candidate; otherwise fall through to the similar-lines error.

**Stage 3 — "similar lines" actionable error (Sub-pattern B):**
- If Stage 2 finds zero or >1 candidates, **do not guess-apply**. Combine three
  audited techniques: @aboutlo's per-line `LineMismatch {line, file, sent}`
  (the only package with per-line divergence — **lift this; it is NOT novel**),
  pi-path-guard's computed `read(offset,limit)` suggestion, and pi-semantic-edit's
  similarity %. Locate the candidate region by the longest stable anchor in
  `oldText` (first non-blank line / longest unique line-prefix) using
  `rankCandidates` from `match.ts`, and return a **structured `EditError`**
  (typed metadata, not a regex-parsed string — only regex-parse *foreign*
  pi-core errors, never your own) that shows the model the actual current region
  so it can re-issue with correct `oldText`:

  ```
  edit could not apply: oldText does not match the current file.
  Closest region (lines 42–45 of <path>):
    42 | ## Tasks & Acceptance
    43 | **Execution:**
    44 | - [ ] `cmd/timer/main.go`: drive the counter from the accessor …
    45 | - [ ] `cmd/timer/main.go`: … (continued)
  Your oldText diverged at line 3: you wrote `cmd/tmer/clicker.go …`; the file
  has `cmd/timer/main.go …`. Re-issue edit with oldText copied from the region
  above (or use replace_all if the change is non-unique).
  ```

  The error carries **exact line numbers** so the model can close the loop with
  one cheap **partial read** — `read(path, offset=42, limit=4)` — instead of
  re-reading or re-`write`ing the whole file. This is the token-saver hook (§A6):
  Stage 2 names the region, the model fetches just those lines, then re-issues
  the edit. No full-file round-trip.

  This is the **"similar lines" / code-spec-friendly** alternative to
  `pi-path-recovery`'s "Did you mean X?" (which suits *paths*, not *content
  blocks*). For content, showing the real region + the divergent line is what
  lets a small model self-correct in one round-trip instead of looping.

**Why not auto-apply on content drift:** Sub-pattern B means the model's
*intent text* is wrong — auto-applying a fuzzy match would silently edit the
wrong region. "Show the region" is the correct contract there.

### A3. Inspiration from axe and goose (verified in `~/repos`)

**Axe** (`~/repos/axe/src/axe_cli/tools/file/replace.py`, `replace.md`):
- `edit: Edit | list[Edit]` — **a single edit OR a list**. This is the
  small-model-friendly schema: the model that keeps emitting `{"oldText","newText"}`
  as a *single object* is doing what axe expects. → **Adopt: accept `edit`/
  `edits` as one-or-many.**
- `replace_all: bool` per edit. → **Adopt** (see A4).
- Confirms the user's read that axe is **similarly brittle on whitespace**:
  it uses Python `str.replace(content, old, new, 1)` — pure exact match, no
  normalization, and the doc insists *"Ensure `old` matches the file EXACTLY,
  including all whitespace and indentation."* axe has no fuzzy fallback and no
  "did you mean" — so pi-tanium's Stage 1/Stage 2 is strictly beyond axe here.
- axe bug to avoid: it applies all edits sequentially *then* checks
  `content == original_content` — so edit 1 can silently no-op while edit 2
  applies (partial failure). pi's design (match against original,
  non-incremental) is better; keep it.

**Goose** (`~/repos/goose`): high-agency `fs_read`/`fs_write` with `line_offset`/`n_lines` (partial reads) and `append` mode for >100-line writes. Adopted into Prong A as §A6: **partial reads as a token saver** — goose's `line_offset`/`n_lines` maps directly to pi's existing `read` `offset`/`limit`, and we add axe's `cat -n`-style line numbering to the output so the model can quote exact regions and close the Stage 2 loop cheaply. (`append` mode is a write-side idea, out of scope here.)

### A4. Other ideas

- **`replace_all`** (axe): add an optional per-edit `replaceAll: true` so the
  model can say "replace every occurrence" without making `oldText` globally
  unique. Small models frequently emit non-unique `oldText` (a common import
  line, a repeated bullet) and get a uniqueness error. Cheap, high value.
- **Actionable error text**: replace pi's terse `"Could not find the exact text
  … must match exactly including all whitespace and newlines"` with the Stage 2
  region dump + divergent-line callout. The model loops now because the error
  gives it nothing to correct on.
- **"Similar lines" suggestions** (the user's term): the Stage 2 region dump is
  this. Keep it scoped to *content*; reserve `pi-path-recovery`'s "Did you
  mean?" for *paths* (where it already belongs). Don't cross the two.
- **Single-or-list schema** (axe): accept one edit not wrapped in an array —
  removes the array-of-objects shape that the small model can't reliably
  produce (the root of ~12 schema failures).

### A5. What Prong A does NOT do (deferred)

- No standalone markdown tool. The markdown escape hatch is a *symptom* of `edit`
  failing; re-measure after A1–A6. If a markdown-specific layer is still needed,
  add it **inside** the edit override (anchor-by-heading / fenced-block
  replace), not as a new tool — small models choose poorly between parallel
  tools (corpus: `bash` search 411 vs `grep` tool 7).
- A soft `write` rewrite-loop guard **ships with Prong A** (per decision C3) so
  test data comes in one pass: if the same path is `write`n k≥2 times in a
  session and the file exists and is large, the `write` result carries a notice
  (not a block) pointing the model at `edit`. See §4 write override + §4.2.

### A6. Partial reads as a token saver (loop-closer for A2 + general saver)

The corpus shows the model re-`write`s whole files (main.go ×22) partly because
it lost the current state and re-emitting the whole file is its only way to
"see" it again. Cheap partial reads attack both that and the Stage 2 loop:

- **`read` override with line numbers** (axe `cat -n` style): when `read` returns
  content, prefix each line with its number (`    42 | …`). pi's `read` already
  supports `offset`/`limit`; this just makes the output self-describing so the
  model can quote exact regions into `edit.oldText` and so Stage 2's line refs
  map 1:1 to what `read` returns. Zero new params.
- **Stage 2 → targeted partial read → re-issue edit**: the A2 Stage 2 error names
  exact lines (e.g. `lines 42–45`); the model issues `read(path, offset=42,
  limit=4)` (token cost: ~4 lines, not the whole file), copies the real text into
  `oldText`, and re-issues the edit. This is the designed-in recovery path for
  Sub-pattern B (content drift) and is the single biggest reason partial reads
  are in scope, not deferred.
- **General saver**: encourage partial reads in the `read` override's
  `promptGuidelines` ("for files >120 lines, read with offset/limit around the
  region you need; use `read` without offset/limit only when you need the whole
  file"). Low effort, compounds across a session.

This is pure addition to the existing `read` override pi-tanium already registers
(for path-recovery); it does not change `read` semantics, only output formatting
+ guidelines.

### A7. Dynamic tool instructions — the system-prompt lever

pi injects each tool's `promptSnippet` and `promptGuidelines` into the system
prompt **dynamically on every generation** — this is the "instructions that go
along with the tools" the user asked about. Confirmed in the dist: `read`
carries `promptGuidelines: ["Use read to examine files instead of cat or sed."]`,
`write` carries `["Use write only for new files or complete rewrites."]`, `edit`
carries a `promptSnippet` ("Make precise file edits with exact text replacement,
including multiple disjoint edits in one call") plus four guidelines
(exact-match, multiple disjoint edits in one call, no overlapping, keep oldText
small but unique).

**Critical nuance for overrides:** `docs/extensions.md` §"Prompt metadata" says
`promptSnippet`/`promptGuidelines` are **not inherited** from the built-in —
meaning pi does not fall back to the built-in's metadata if your registered
definition omits those fields. The `pi-path-recovery` pattern (`{ ...builtin,
name, execute }`) *does* copy them through the spread, so an override that
spreads inherits the built-in's text. **But the built-in `edit` guidelines say
"edits[].oldText must match exactly" — which directly contradicts pi-tanium's
new whitespace-tolerant, shape-recovered contract.** **Audit finding (§8.3):** 4 of 6 audited packages DO redeclare `promptGuidelines` — but only the ones that reimplement edit from scratch (pi-semantic-edit, pi-tian-edit-safe, edit-o-matic, @aboutlo). The 2 that compose via spread (pi-tool-guard, pi-path-guard) inherit. pi-tanium composes, so it inherits the built-in's text — **but the built-in `edit` guideline says "edits[].oldText must match exactly", which contradicts the new whitespace-tolerant contract.** Resolution: **extend-with-filter**, not a flat redeclare and not a flat inherit. On the `edit` override, set `promptGuidelines` to a filtered copy of the built-in's: **drop** the "must match exactly" bullet specifically, **keep** the rest (so pi-core guideline updates continue to flow through), and **append** the new contract bullets (single-or-list, `replaceAll`, whitespace-tolerant, "re-issue from the region shown"). On `read`/`write`, extend the built-in's guidelines with the new bullets (no contradiction to filter). This is the lever to teach the model the new contract for free, at the thinking-start seam (same philosophy as `pi-preface`, but built into the tool registration so it needs no separate extension) — and it avoids the anti-pattern of freezing a static copy that drifts from pi-core (§4.1).

Proposed `promptGuidelines` for the pi-tanium overrides:

- **edit** — extend-with-filter (drop "must match exactly", keep the rest, append):
  - "Use edit for surgical changes to existing files. Prefer edit over write
    whenever the change is smaller than the whole file."
  - "You may pass a single edit `{oldText,newText}` or an array `edits:[…]`. The
    array-of-objects shape is supported but not required."
  - "oldText is matched after whitespace normalization (tabs/spaces/trailing
    whitespace are tolerant). If oldText is not unique, set `replaceAll: true`
    on that edit."
  - "On a not-found error, the tool returns the closest current region with line
    numbers — copy the real text from that region (or `read` with offset/limit)
    and re-issue."
- **read** — redeclare + add partial-read guidance:
  - "Use read to examine files instead of cat or sed." (keep pi's existing one)
  - "Output is line-numbered (`cat -n` style). For files >120 lines, read with
    `offset`/`limit` around the region you need; only read the whole file when
    you actually need all of it."
- **write** — redeclare + steer away from rewrite loops:
  - "Use write only for new files or complete rewrites." (keep pi's existing one)
  - "If you have already written the same path this session, prefer edit for
    further changes — repeated full-file writes bloat context."

This is the prevention layer that makes Prong B's hard stop consistent: the
system prompt says "use edit/read/write" *before* the model reaches for bash, and
the permission-system deny says it again *if* the model tries bash anyway.
Together they close the loop from both sides — and because the guidelines ride
on the tool registration, they cost zero extra tokens vs. a `pi-preface` block.

---

## 3. Prong B — bash steering via `pi-permission-system` (config + small extension)

**Mostly config; one small code piece.** The robjgray fork's `pi-permission-system`
handles the detectable bash forms via wildcard patterns, `allow`/`ask`/`deny`
states, **`deny` with a custom reason shown to the agent**, and tree-sitter command
decomposition (most-restrictive-wins per unit). The **residual** — heredoc bodies
and `>` redirects to source files, which the permission system's tree-sitter
decomposition strips from the matched command text (§B3) — is caught by a small
pi-tanium `tool_call` extension (§B-fallback) that sees the **full command string**,
including heredoc bodies, that the permission system can't pattern-match.

### B1. How the package works (the parts that matter here)

- Config at `~/.pi/agent/extensions/pi-permission-system/config.json` (global)
  and `<cwd>/.pi/extensions/pi-permission-system/config.json` (project).
  Project overrides global. (`README.md`, `src/config-schema.ts`.)
- `permission.bash` is a **pattern → state** map; **last matching rule wins**
  (broad catch-alls first, specific overrides after). (`src/wildcard-matcher.ts`,
  `findCompiledWildcardMatch` uses `findLast`.)
- Wildcard semantics: `*` = any sequence incl. empty (dotall — crosses
  newlines), `?` = one char. `^…$` anchored. A trailing ` *` is made optional so
  `git *` matches both `git status` and bare `git`. (`compileWildcardPattern`.)
- **Custom deny reason is configurable per rule** — this is the steering
  mechanism the user asked for. Instead of `"pattern": "deny"`, write:
  ```json
  "pattern": { "action": "deny", "reason": "Use the edit tool for surgical changes, or write for full rewrites." }
  ```
  The agent then sees:
  `[pi-permission-system] Current agent is not permitted to run 'bash' command
  '<cmd>' (matched '<pattern>'). Reason: Use the edit tool for surgical
  changes, or write for full rewrites.` (`src/denial-messages.ts`,
  `denyWithReasonSchema` in `src/config-schema.ts` — `reason: z.string().max(500)`
  "Optional reason shown to the agent when this action is denied.")
- **`deny` ≠ `ask` — no UI prompt.** The three states are defined
  (`config-schema.ts`) as: `allow` = "Permit the action silently"; **`deny` =
  "Block the action with an error message. The agent is told not to retry."**
  (no dialog); `ask` = "Prompt the user for confirmation via the interactive UI
  before proceeding." Because Prong B uses `deny` (never `ask`), the block +
  reason lands directly in the agent's tool result with **zero prompts to the
  human** — the agent gets the picture ("disabled, prefer read/edit/write") and
  self-corrects. Only `ask` would open the inline TUI dialog. (`yoloMode` only
  auto-approves `ask`; it is irrelevant when everything is `deny`.)
- Bash commands are **tree-sitter-decomposed** into command-pattern units;
  `&&`/`|`/`;` chains, command substitution, and subshells are split and each
  unit evaluated, most-restrictive-wins. So `cd X && python3 - <<'PY' …` is
  evaluated as `cd X` *and* `python3 - …` separately — patterns don't need to
  handle the `cd &&` prefix. (`src/access-intent/bash/command-enumeration.ts`,
  `src/bash-advisory-check.ts`.)

### B2. The proposed config (concrete, drop-in)

`~/.pi/agent/extensions/pi-permission-system/config.json` (or project-scoped):

```jsonc
{
  "permission": {
    "*": "allow",
    "bash": {
      "*": "allow",

      // ── python-as-file-editor (the markdown escape hatch) ──────────────
      // `python3 - <<'PY' …` (stdin/heredoc) — the dominant form in the
      // corpus (14/14 in the referenced session). Heredoc body is NOT visible
      // to the matcher (§B3), so block on the command shape.
      "python3 - *": {
        "action": "deny",
        "reason": "Editing files via python stdin/heredoc is blocked. Use the edit tool (fuzzy + shape-recovered) for surgical changes, or write for a full rewrite."
      },
      // `python3 -c '…'` — the code IS visible (it's a quoted arg), so match
      // on file-IO indicators.
      "python3 -c *open(*":      { "action": "deny", "reason": "Use read/edit/write tools for file IO; python -c open() is blocked." },
      "python3 -c *.write(*":    { "action": "deny", "reason": "Use the write tool to create/overwrite files." },
      "python3 -c *read_text*":  { "action": "deny", "reason": "Use the read tool to read file contents." },
      "python3 -c *re.sub*":     { "action": "deny", "reason": "Use the edit tool for replacements." },
      "python3 -c *Path(*":      { "action": "deny", "reason": "Use read/write/edit tools for file operations." },

      // ── sed in-place ────────────────────────────────────────────────────
      "sed -i *":   { "action": "deny", "reason": "In-place sed edits are blocked. Use the edit tool for surgical replacements." },
      "sed * -i*":  { "action": "deny", "reason": "In-place sed edits are blocked. Use the edit tool." },

      // ── awk/tee writing to files is gated via `path` if needed (§B3) ───
      // (awk/tee redirects aren't visible to bash patterns; see B3 caveat.)
    }
  }
}
```

**What this accomplishes with zero code:** the agent's python-heredoc and
`sed -i` file-editing attempts are denied with a message that *names the tool
to use instead*. Combined with Prong A (those tools are now reliable), the
escape hatch is closed and the steering is consistent. `go …`, `git …`,
`grep/find/ls`, `cp/mv/mkdir`, and `python3 script.py` / `python3 -c 'compute'`
remain allowed.

### B3. The honest caveat — what bash patterns CAN'T see

The tree-sitter enumeration **skips `heredoc_body`, `heredoc_end`, and
`heredoc_redirect`/`file_redirect`** when building the command-unit text
(`COMMAND_ENUM_SKIP` in `command-enumeration.ts`; confirmed by
`test/bash-external-directory.test.ts` "heredoc handling"). Concretely:

- `python3 - <<'PY'\n<code>\nPY` is matched as **`python3 -`** — the heredoc
  body is invisible. ✅ Fine for B2: `python3 - *` matches it.
- `python3 <<'PY' …` (no `-`) is matched as bare **`python3`** —
  indistinguishable from `python3` alone. ❌ Can't block via command pattern
  without blocking all `python3`. (Not observed in the corpus — the model
  consistently used `python3 - <<…` — but it's a robustness gap.)
- `awk '{…}' > main.go` and `sed '…' f > main.go` (non-`-i`) — the `> main.go`
  **redirect target is not in the command text**, so bash patterns can't see
  it. The redirect *target* is extracted for the cross-cutting `path` surface,
  but `path` applies to **all tools including `edit`/`write`**, so a `path`
  deny on `*.go` would also block the very tools we're steering *toward*. ❌
  Can't cleanly gate bash-only redirects to source files via config.

**Coverage summary for B2:**
| escape hatch | covered by config? |
|---|---|
| `python3 - <<'PY' …` (observed form) | ✅ `python3 - *` |
| `python3 -c '…open/write/re.sub…'` | ✅ content-matched |
| `python3 script.py` (edits via a .py file) | ⚠️ partial — gate via `path` deny on writing `*.py`? blocks legit scripts; leave allowed, rely on Prong A |
| `sed -i …` | ✅ |
| `awk/sed/cat … > source.go` (redirect) | ❌ not via config — needs §B-fallback |
| `python3 <<'PY' …` (no `-`) | ❌ not via config — needs §B-fallback |

### B4. Model-judge — future, not v1

The `pi-permission-model-judge` authorizer-chain option is **out of scope for
v1** — Prong B is the `pi-permission-system` config (`deny` rules) + the small
`tool_call` extension (§B-fallback). Revisit model-judge only if static denies
+ the extension prove insufficient.

### B-fallback (v1) — small `tool_call` extension for the residual

**This is a v1 component, not a last resort** (decision D3). The
`pi-permission-system` config can't see heredoc bodies or `>` redirect targets
(tree-sitter decomposition strips them — §B3), so a small pi-tanium `tool_call`
extension catches the residual: `pi.on("tool_call", event)` sees the **full
command string including heredoc body**, and blocks (with a steering reason) when
it detects file mutation via the residual forms — `python3 <<'PY' …open()/write()/re.sub…`
(no `-`), `python3 - <<'PY' …` heredoc bodies (config matches the `python3 -`
shape but not the body), and `cmd > source.go` / `>> source.go` redirects to
source files (`.go`/`.md`/`.ts`/…). Return `{ block: true, reason: "Use edit/write" }`.
This lives in pi-tanium as `bash-gate.ts` (see §4).

### B5. yoloMode interaction — autonomous AND guarded

`yoloMode: true` is compatible with Prong B and is the recommended way to get
"yolo generally, but prevent certain commands." From `src/rule.ts` (lines 52–65):

> "Rewrite every `ask` rule to `allow`, tagged `origin: "yolo"`. … **`deny` rules
> are untouched, so yolo suppresses prompts but preserves hard denies.**"
> `rule.action === "ask" ? { ...rule, action: "allow", origin: "yolo" } : rule`

So yolo rewrites only `ask`→`allow`; `deny` passes through as a hard block.
Combined with Prong B's `deny`-with-reason rules, the agent **never prompts the
human** (no `ask` anywhere) AND **cannot run python/sed file-editing** (those are
`deny`). Recommended config:

```jsonc
{
  "yoloMode": true,
  "permission": {
    "*": "allow",
    "bash": {
      "*": "allow",
      "python3 - *":        { "action": "deny", "reason": "…use edit/write…" },
      "python3 -c *open(*":  { "action": "deny", "reason": "…" },
      // …rest of §B2 denies…
      "sed -i *":            { "action": "deny", "reason": "…use edit…" }
    }
  }
}
```

This is the ideal operating point for a heavy-reasoning small local model
running autonomously: zero approval friction for everything legitimate, a hard
wall on the file-mutation escape hatches with a steering reason. (`yoloMode` is
defined in `config-schema.ts` as "Auto-approve ask-state permission checks";
since Prong B uses no `ask` rules on the bash surface, yolo is technically a
no-op there — but it stays valuable for any `external_directory`/`path` `ask`
defaults you keep, and it documents intent: "autonomous mode; the denies are my
guardrails.")

**(No v1 constraint:** model-judge is out of scope for v1 (§B4); `yoloMode` + the static `deny` rules + the `tool_call` extension is the v1 operating point.)

---

## 4. Architecture — rename `pi-path-recovery` → `pi-tanium`

```
pi-tanium/                         (rename of pi-path-recovery)
  src/
    match.ts            — (existing) levenshtein, commonPrefix, scoreMatch, rankCandidates
    recover.ts          — (existing) path "Did you mean?" for read/write/edit
    edit-types.ts       — NEW, pure: EditEntry, EditError, LineMismatch types              (A2/A4)
    edit-shape.ts       — NEW, pure: normalizeEdits(input) → {edits} | Error                (A1)
    edit-fuzzy.ts       — NEW, pure: Stage 0/1/2 (exact → normalized → gated multi-pass)    (A2)
    edit-apply.ts       — NEW, pure: apply edits to content (owns orchestration for replaceAll) (A4)
    edit-diagnostics.ts — NEW, pure: Stage 3 "similar lines" region + LineMismatch + read suggestion (A2)
    read-shape.ts       — NEW, pure: offset/limit coercion                                   (A6)
    read-number.ts      — NEW, pure: cat -n line numbering                                   (A6)
    bash-gate.ts        — NEW, pure: isResidualFileMutation(cmd) → {block, reason} | null   (§B-fallback, D3)
    index.ts            — thin adapter (the ONLY file with I/O or pi imports):
        registerTool("read",  …)  path-recovery guard + read-shape + read-number (A6)
        registerTool("write", …)  path-recovery guard + rewrite-loop guard (ships with Prong A, C3)
        registerTool("edit",  …)  prepareArguments(layer on builtin) → fuzzy → own-apply → diagnostics
        on("tool_call", "bash")   block residual file-mutation (heredoc bodies, > source.go) via bash-gate (§B-fallback)
  test/             — vitest, like the siblings
```

- **Reuse `match.ts`** for `rankCandidates` (already zero-dep/zero-IO).
- **Compose the tool, own the apply.** Spread `createEditToolDefinition(cwd)` (exported) and override only `prepareArguments` + `execute` — mirroring `pi-path-recovery`'s pattern. **But pi-tanium owns the apply orchestration**; it does NOT delegate the apply step to the built-in's `execute`: pi-core's `applyEditsToNormalizedContent` throws on >1 occurrence with no `replaceAll` flag (verified — `edit-diff.js` L238–240), so `replaceAll` (A4) cannot be delegated. `edit-apply.ts` does the apply, reusing only what pi-core **exports** (`createEditToolDefinition`, `withFileMutationQueue`); the diff/normalize/fuzzy internals (`normalizeForFuzzyMatch`, `fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`, `stripBom`, `detectLineEnding`, `normalizeToLF`, `restoreLineEndings`, `generateDiffString`, `generateUnifiedPatch`, `applyEditsToNormalizedContent`) are **internal-only — NOT exported** (`dist/index.js`), so pi-tanium reimplements them in its own pure modules. This keeps the pure modules import-free and testable in isolation.
- `promptGuidelines` via **extend-with-filter** on the override (see §A7 for the full rationale + the audit finding that 4 of 6 packages redeclare vs 2 inherit). Do NOT freeze a static copy — it drifts from pi-core (§4.1).
- **Cross-tool nudge → `APPEND_SYSTEM.md`, not `pi-preface`.** pi already has a
  layered system-prompt mechanism — don't overload `pi-preface` for a static
  rule. The right home for a cross-tool "use edit/read/write, not bash
  python/sed; use the `grep` tool" policy is `APPEND_SYSTEM.md` (global
  `~/.pi/agent/APPEND_SYSTEM.md` or project `.pi/APPEND_SYSTEM.md`), which
  appends to the default system prompt (`docs/usage.md` §"System Prompt
  Files"). Layering: per-tool `promptGuidelines` (§A7) carry the tool-specific
  contract; `APPEND_SYSTEM.md` carries cross-tool static policy; `pi-preface` is
  reserved for rules that genuinely fade over long conversations and need
  per-generation re-injection (not needed for v1). Recommended `APPEND_SYSTEM.md`
  addition:
  > To modify file contents, use `edit` (fuzzy + shape-recovered) or `write`
  > (full rewrite). Do **not** edit files via `python3`/`sed`/`awk` inside
  > `bash` — those calls are blocked. For repeated changes to the same file,
  > prefer `edit` over re-`write`ing the whole file. For content search, use the
  > built-in `grep` tool, not `bash grep`.

### 4.1 Anti-patterns to avoid (from the §8.3 source audit)

- **Reimplementing edit from scratch** (4 of 6 audited: pi-semantic-edit,
  pi-tian-edit-safe, edit-o-matic, @aboutlo) — own I/O, own renderers, own diff.
  pi-tanium composes: spread `createEditToolDefinition`, override only
  `prepareArguments` + `execute`, own only the apply orchestration (for
  `replaceAll`, which can't be delegated — §4).
- **Sequential multi-edit semantics** (pi-tian-edit-safe) — applies edits
  one-after-another against a running buffer; conflicts with pi-core's
  against-original contract. pi-tanium applies all edits against the original
  (non-incremental), like pi-core.
- **Auto-reindenting `newText`** (edit-o-matic) — silently rewrites bytes the
  model didn't request. pi-tanium never modifies `newText`; it only normalizes
  matching of `oldText`.
- **`'`→`"` quote collapse** (@aboutlo) — lossy for string-literal edits. Map
  only typographic quotes (`“”` `‘’` `–` `—`) → ASCII; never collapse ASCII
  quotes.
- **Redeclaring `promptGuidelines` as a frozen copy** (4 of 6) — drifts from
  pi-core when pi-core updates its guidelines. Use extend-with-filter (§A7) so
  non-contradicting built-in guidelines flow through.
- **Mutating `prepareArguments` input in place** (pi-tool-guard) — return a
  fresh object (idempotent); don't mutate the caller's input.
- **Importing the old `@mariozechner/pi-coding-agent` name** (@aboutlo) — use
  the current `@earendil-works/pi-coding-agent`.

### 4.2 Module interfaces — Phase 1, Step 0 (pin before implementation)

The pure modules (no I/O, no pi imports — testable in isolation). Signatures
pinned so Phase 1 can TDD each module independently.

**`edit-types.ts`** — shared types:
```ts
interface EditEntry { oldText: string; newText: string; replaceAll?: boolean }
interface LineMismatch { line: number; file?: string; sent: string; got: string }
interface ClosestRegion { startLine: number; endLine: number; preview: string; similarity: number }
interface ReadSuggestion { offset: number; limit: number }
type EditError =
  | { kind: "not-found"; message: string; closestRegion: ClosestRegion; lineMismatch?: LineMismatch; readSuggestion: ReadSuggestion }
  | { kind: "not-unique"; message: string; occurrences: { startLine: number; endLine: number }[]; readSuggestion: ReadSuggestion }
  | { kind: "shape"; message: string; canonicalExample: string }
  | { kind: "no-change" | "overlap"; message: string }
interface ApplyResult { passName: string; start: number; end: number; replaced: number }
```

**`edit-shape.ts`** — `normalizeEdits(input: unknown): { path: string; edits: EditEntry[] } | { error: EditError }`.
Idempotent, returns a fresh object (never mutates input). Calls
`builtin.prepareArguments(input)` first, then layers: alias folding
(`path`/`file`/`filePath`/…; `oldText`←`old`/`old_str`/`old_string`/`oldContent`/`original`/`search`;
`newText`←`new`/`new_str`/… — pi-tian-edit-safe + pi-tool-guard tables), single-object
unwrap (`{oldText,newText}`→`[{…}]`), stringified-single-object (`JSON.parse`→object→wrap),
unparseable-string → `{kind:"shape"}` error with the canonical `edits:[{oldText,newText}]` example.

**`edit-fuzzy.ts`** — staged matcher:
```ts
type FuzzyResult =
  | { ok: { start: number; end: number; actual: string; passName: string } }
  | { ambiguous: { spans: { start: number; end: number }[] } }
  | { notFound: { closestRegion: ClosestRegion } }
function fuzzyMatch(content: string, edit: EditEntry): FuzzyResult
```
- **Stage 0 — exact:** `content.includes(edit.oldText)`; short-circuit on a unique hit (no gate).
- **Stage 1 — single-normalized fast path:** collapse `\s+`→space per line, trim
  trailing whitespace, tab⇄space; apply on exactly one normalized hit.
- **Stage 2 — gated multi-pass fallback:** see pass list below.

**Stage 2 pass list (best-factored from the audit, §8.3):** gated by
pi-tian-edit-safe's guards (`oldText.trim().length < 5` → reject; NUL byte →
`binary`; size cap), each pass returns **original substrings** via a shared
`lineBlockSpans` line-block walker (pi-tian-edit-safe), each re-verified with
`original.includes(actual)` (pi-semantic-edit's invariant — **never write the
normalized query**), each rejected by `isDisproportionateMatch` (≥
`max(oldLines+3, oldLines*2)` lines). Apply only on **exactly one** unique
candidate; else → Stage 3. A curated subset of pi-semantic-edit's 10-pass chain
(the 5 that address the corpus's observed whitespace/indentation/typographic/
escape drift), ordered cheapest-first:
1. `line_trimmed` — per-line `.trim()` equality (catches trailing whitespace).
2. `whitespace_normalized` — collapse `\s+`→space per line (catches tab/space drift — the `main.go` cases).
3. `indentation_flexible` — trim + filter empty, subsequence match within a 3× window (catches indentation drift).
4. `escape_normalized` — unescape `\n`/`\t`/`\\`/`\"`/`\'` (catches escape drift).
5. `unicode_normalized` — NFKC + typographic quote/dash map (catches smart quotes/dashes), ASCII fast-path + `mapNormalizedIndex` to project normalized offsets back to original.

(pi-semantic-edit's `block_anchor`/`trimmed_boundary`/`context_aware`/`multi_occurrence`
passes are available if the 5 prove insufficient; `tryAutoExpand` — grow context
alternately above/below, cap 10 lines, to disambiguate instead of failing — is
an optional add.)

**`edit-apply.ts`** — owns the apply orchestration (can't delegate — pi throws on
>1 occurrence with no `replaceAll` flag, §4):
```
applyEdits(normalizedContent, edits) → { content, results: ApplyResult[] } | { error: EditError }
  base = normalizedContent                                  # against ORIGINAL (non-incremental)
  for i, edit in edits:
    if edit.replaceAll:
      spans = findAllSpans(base, edit.oldText)               # indexOf advancing by 1, non-overlapping (pi-semantic-edit)
      if spans.empty: return { error: notFound(i, …) }
      for span in spans (bottom-up): base = base[:start] + edit.newText + base[end:]
      results.push({ passName: "replace_all", replaced: spans.length, … })
    else:
      m = fuzzyMatch(base, edit)                            # Stage 0 → 1 → 2
      if m.ok:         base = base[:m.start] + edit.newText + base[m.end:]; results.push(m.ok)
      elif m.ambiguous: return { error: notUnique(i, m.spans, readSuggestion) }
      else:            return { error: similarLinesError(base, edit, m.closestRegion) }   # Stage 3
    # overlap check vs prior edits; no-op detection
  if base == normalizedContent: return { error: noChange }
  return { content: base, results }
```

**`edit-diagnostics.ts`** — `similarLinesError(content, edit, closestRegion): EditError`.
Combines three audited techniques: @aboutlo's `LineMismatch {line, file, sent, got}`
(per-line divergence), pi-path-guard's computed `read(offset,limit)` suggestion,
pi-semantic-edit's similarity %. Returns a **structured `EditError`** (typed
metadata, not a regex-parsed string — only regex-parse *foreign* pi errors).

**`read-shape.ts`** — `coerceReadArgs(input): { path, offset?: number, limit?: number }`:
alias folding (`file`/`filePath`/`file_path`/…→`path`; `start`/`startLine`/`line`/…→`offset`;
`lines`/`maxLines`/`count`/…→`limit`) + string→number coercion via `parseFloat` (pi-tool-guard).

**`read-number.ts`** — `numberLines(text, startLine = 1): string`: `cat -n` formatting (`    42 | …`).

**`bash-gate.ts`** — `isResidualFileMutation(cmd: string): { block: true; reason: string } | null`:
detects the residual the `pi-permission-system` config can't see — heredoc bodies
with file IO (`python3 <<` / `python3 - <<` whose body contains `open(`/`read_text`/
`.write(`/`re.sub`/`Path(`), and `>`/`>>` redirects to source files (`.go`/`.md`/`.ts`/…).
Returns a steering reason ("Use edit/write").

### 4.3 Per-module test plan (vitest)

- **edit-shape**: every degenerate shape — stringified single-object, unparseable
  stringified JSON (→ `kind:"shape"` error with the canonical example), unwrapped
  single object, `old`/`new` aliases, top-level legacy, JSON-string array; idempotent
  (run twice → same output); does not mutate the input.
- **edit-fuzzy**: Stage 0 exact; Stage 1 whitespace-drift → apply (the `main.go`
  tab/no-tab + gofmt-spacing cases from §1.2); Stage 2 each pass (line_trimmed /
  whitespace / indentation / escape / unicode) → apply on exactly-one, ambiguous
  → not-unique, not-found → Stage 3; the `original.includes(actual)` invariant
  holds (result is always an original substring, never the normalized query);
  `isDisproportionateMatch` rejects ballooning spans; gating (min length 5, NUL→
  binary, size cap) rejects.
- **edit-apply**: `replaceAll` branch (`findAllSpans` non-overlapping, multi-span
  apply); non-replaceAll via `fuzzyMatch`; against-original (edit 2 sees the
  original, not edit 1's result); overlap detection; no-op → `noChange`.
- **edit-diagnostics**: `similarLinesError` produces a `LineMismatch` naming the
  diverging line + a `readSuggestion` + similarity; the §1.2 content-drift case
  (`cmd/tmer` typo) → error names the diverging line and the actual `cmd/timer` text.
- **read-shape**: alias folding + string→number coercion (`"42"`→42, invalid→undefined).
- **read-number**: `cat -n` formatting with correct right-aligned padding.
- **bash-gate**: heredoc-body file-IO → block (`python3 <<'PY'\nopen()\nPY`);
  `python3 - <<` with file IO → block; `python3 -c 'compute'` → null; `cmd > main.go`
  → block; `cmd > /tmp/log` → null; `go build`/`git …`/`grep …` → null.

---

## 5. Decisions (resolved with the user)

1. **Rename `pi-path-recovery` → `pi-tanium`.** ✅ Confirmed (OPTION A — build
   the consolidation). Not published, so no npm unpublish needed — just
   `pi remove pi-path-recovery` (or remove the installed folder) then
   `pi install <localFolder>` from the renamed checkout. The theme ("hardening")
   covers path-recovery + edit + read + future surfaces; one package, one
   install. Update `package.json` `name` to `@gotgenes/pi-tanium` (or whatever
   scope you use) and the `README.md` title.
   `pi-hardened`, `pi-armor`, `pi-anvil`. (See §8.3 for the due-diligence audit
   of `pi-tian-edit-safe` and the other 5 overlapping packages.)
2. **Stage 1 auto-apply: exact-after-normalization.** ✅ Confirmed. Apply when
   exactly one region matches after whitespace normalization; **no edit-distance
   guess on content**. `rankCandidates` is used only for Stage 2's "closest
   region" display, never for silent apply.
3. **`replace_all`: per-edit.** ✅ Confirmed. `replaceAll` on each edit object
   (axe style).
4. **B2 baseline: start `allow`.** ✅ Confirmed. `"*": "allow"` with explicit
   `deny`-with-reason for the bad patterns — fully autonomous, no prompts. Switch
   to `"*": "ask"` + model-judge (§B4) only if the model adapts past the static
   patterns.
5. **Bash limitation relies solely on `pi-permission-system` config.** ✅
   Confirmed. Because Prong B uses `deny` (not `ask`), the agent receives the
   block + "prefer read/edit/write" reason in its tool result with **no prompt
   to the human** (§B1) — exactly the autonomous steering you want. No custom
   `tool_call` code is needed unless the model adapts to the residual heredoc/
   redirect forms (§B3, §B-fallback).

---

## 6. Measurement (prove it worked)

Re-run the analysis scripts (`/tmp/analyze_laguna.py`, `analyze2–5.py` — these
live in the workbench, not a repo; the measurement relies on **manual sessions
you create** with a laguna model in `clickgo`) after Prong A + Prong B:

| metric | baseline | target |
|---|---|---|
| `edit` success rate | 48% | ≥ 90% |
| `PY_FILE_IO` bash calls per session | 14 (peak) | 0 |
| `edit` schema-shape errors | ~12 | 0 (recovered) |
| `edit` not-found errors auto-recovered (Stage 1) | 0 | ~all whitespace-drift cases |
| `write`-to-same-path max per session | 22 | ≤ 3 |
| python-via-bash file-IO errors | 12 | 0 (denied with reason, not errored) |

---

## 7. Out of scope (noted)

- The 60:1 `bash`-search vs `grep`-tool preference. **`grep` is a pi CORE
  built-in tool** (`dist/core/tools/grep.js`; `extensions.md` lists it among the
  overridable built-ins `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`), **not a
  package** — so no install is needed and it is always available. The 60:1 ratio
  is a tool-*selection* problem, not a hardening problem; pi-tanium does **not**
  override `grep` (nothing to harden there). Steering toward `grep` is a
  `pi-preface` nudge (see §4 recommended text), out of pi-tanium's code scope.
  (`pi-colgrep` in the fork is a separate *semantic* search tool that
  complements, not replaces, the built-in `grep`.)
- `write` `append` mode (goose) — write-side, separate.
- `pi-preface` nudge — **not used in v1**. The static cross-tool "use
  edit/read/write; use `grep`" rule belongs in `APPEND_SYSTEM.md` (pi's
  built-in append mechanism), not `pi-preface`. Reserve `pi-preface` for rules
  that genuinely fade over long conversations and need per-generation
  re-injection. See §4.

(Partial reads + `cat -n` line numbering were previously listed here; moved
**into scope** as §A6 — they are a meaningful token saver and the loop-closer
for A2 Stage 2.)

---

## 8. Leverage vs duplicate — sibling packages in the fork

pi-tanium's remit is hardening `edit`/`read`/`write` and steering bash away from
file mutation. Several adjacent concerns are already solved by sibling packages
in the robjgray fork — pi-tanium must **defer to them**, not reinvent them:

| concern | owned by | pi-tanium's relationship |
|---|---|---|
| bash command allow/ask/deny + deny-with-reason steering | `pi-permission-system` | Prong B (§3) — config (`deny` rules) + a small pi-tanium `tool_call` extension for the residual (§B-fallback). |
| per-generation cross-tool reminder injection | `pi-preface` | home for the grep + "use edit not bash" nudge (§4 text). §A7 `promptGuidelines` are per-tool; `pi-preface` is cross-tool. |
| "don't `cd`-prefix the CWD" system-prompt rule | `pi-nocd` | precedent that the system-prompt-append pattern is already solved in the fork. pi-tanium uses per-tool `promptGuidelines` (§A7), **not** a new append mechanism. A global rule belongs in `pi-preface` or a `pi-nocd`-style sibling, not pi-tanium. |
| semantic code search (ColBERT) | `pi-colgrep` | complements the built-in `grep`; unrelated to pi-tanium. |
| subagents / worktrees / session tools / github CI | `pi-subagents` etc. | unrelated to file editing. |

**Net: pi-tanium ships code only for `edit`/`read`/`write` hardening (Prong A).
Everything else — bash gating, formatting, cross-tool reminders, `cd`-prohibition
— is config or a sibling package.** This keeps pi-tanium small and avoids the
"one package does everything" anti-pattern the fork explicitly partitions against.

### 8.1 Gap analysis vs the earlier draft (`laguna-editing-spec.md`)

For the record, what changed between the draft and this spec, and what the draft
had that this spec now absorbs or drops:

- **Prong 0 / fuzzy auto-apply within threshold** — the draft's §4.1.2 proposed
  auto-applying within a Levenshtein threshold + a "did you mean?" path-style
  error. This spec **refined** it (decision #2) to exact-after-normalization
  auto-apply only; `rankCandidates` for Stage 2 display only, never silent apply
  on content. Not a gap — a deliberate refinement grounded in the §1.2
  whitespace-vs-content sub-pattern split.
- **bash gate via `tool_call` code** — the draft's §4.3.2 proposed a code
  `tool_call` extension. This spec **replaced** it with Prong B's config-based
  `pi-permission-system` (decision #5); the code path survives only as §B-fallback.
  Not a gap — deliberate.
- **`write` rewrite-loop warning** — **ships with Prong A** (decision C3), not
  deferred: a soft guard in the `write` override (k≥2 rewrites to a large
  existing path → notice pointing at `edit`). See §A5 + §4.2.
- **`read` partial reads** — the draft had them optional (§4.3.4); this spec
  **promoted** them to §A6 (in scope). Not a gap — upgraded.
- **`pi-preface` concrete text** — the draft's §4.5 had a specific preface block;
  the spec lost it in restructuring. **Restored** in §4 (with the grep nudge
  added). Closed.
- **`rwetools.md` verification + Prong 0 label** — draft §2.6/§3; folded into
  §A3 here, label dropped. Not a gap.
- **Analysis scripts** — draft §6 named `/tmp/analyze_laguna.py` etc. and said
  "worth committing to `_pi_subagents`." **Still an open action item** — commit
  them so the §6 measurement plan is reproducible.
- **`pi-nocd`** — noted as the system-prompt-append precedent in the fork (§8). Closed.
- **Nudge home relocated off `pi-preface`** — per user, don't overload
  `pi-preface`; pi has `APPEND_SYSTEM.md` (global + project) and other
  system-prompt mechanisms that come first. The static cross-tool nudge moved to
  `APPEND_SYSTEM.md`; `pi-preface` is not used in v1. See §4 + §7. Closed.
- **`grep` is core, not a package** — clarified in §7; the steering home is
  `pi-preface`. Closed.

### 8.2 Open action items (not spec gaps, but needed before implementation)

1. Corpus analysis scripts (`analyze_laguna.py`, `analyze2–5.py` in `/tmp`) are
   referenced in §6; the measurement relies on **manual sessions you create**
   with a laguna model in `clickgo` (not a repo).
2. `write` rewrite-loop guard **ships with Prong A** (decision C3) — see §A5 + §4.2.
3. **Consolidation audit (OPTION A due diligence)** — see §8.3.
4. **Keep `/Users/office/repos/_pi_subagents/registry-audit/`** (decision C2) — do not delete the
   checkouts; the implementer circles back at the end to analyze whether the
   pi-tanium implementation improves upon all the inspiration sources.

### 8.3 Consolidation audit — temporary checkouts of the 5 overlapping registry packages

Decision #1 is **OPTION A**: build pi-tanium as the consolidation of all 5
concepts that the public-registry audit (subagent report) found to already
exist *separately* in other packages. Before writing the consolidation code,
the spec dictates a due-diligence step: **temporarily check out the source of
every overlapping package into `/Users/office/repos/_pi_subagents` (a temporary
research corpus / workbench, outside the pi-packages fork) and analyze them
in-depth**, to verify pi-tanium genuinely consolidates all 5 concepts — and to
lift good ideas (e.g. pi-semantic-edit's 10-pass fuzzy chain, pi-tian-edit-safe's
alias table) rather than re-derive them blind.

The 5 concepts pi-tanium must consolidate:

1. **edit-shape** — argument shape recovery (stringified single-object,
   unparseable stringified JSON, unwrapped object, `old`/`new` aliases).
2. **edit-fuzzy** — whitespace-tolerant matching (tabs/spaces/trailing).
3. **replaceAll** — per-edit replace-all escape hatch for non-unique `oldText`.
4. **similar-lines error** — on not-found, return the closest current region +
   which line diverged. (**"which line diverged" is NOT novel** —
   @aboutlo/pi-smart-edit has `LineMismatch {line, file, sent}`; lift it.)
5. **read argument handling** — `offset`/`limit` coercion + `cat -n` line
   numbering. (**`cat -n` is the only genuinely novel piece** — no audited
   package numbers read output; confirmed by reading pi-core's `read.js`.)

**Audit status: COMPLETE and judged.** The 6 packages were checked out via
`npm pack` into `/Users/office/repos/_pi_subagents/registry-audit/`, read at the source level, and
analyzed. Full write-up: `/Users/office/repos/_pi_subagents/registry-audit/ANALYSIS.md` (sections
A–D: per-package analysis, consolidation matrix, architectural recommendations,
lift/avoid summary). `pi-tian-edit-safe` is **NOT ours** — its `pi-tian` prefix
is a coincidental collision (see §5 note).

**Verified consolidation matrix (from ANALYSIS.md):**

| concept | covered? | lift from (cited) |
|---|---|---|
| 1 edit-shape | ✅ | pi-tian-edit-safe `prepare-arguments.ts` + pi-tool-guard `aliases.ts`, layered on pi-core's `prepareArguments` |
| 2 edit-fuzzy | ✅ | pi-semantic-edit 10-pass `passes.ts` + pi-tian-edit-safe guards; **mandatory `original.includes(actual)` re-verify invariant** |
| 3 replaceAll | ✅ (one source) | pi-semantic-edit `findAllSpans` — the **only** package implementing it |
| 4 similar-lines error | ✅ incl. "which line diverged" | @aboutlo `LineMismatch` + pi-path-guard `read(offset,limit)` suggestion + pi-semantic-edit similarity % |
| 5 read arg handling | ⚠️ coercion ✅ (pi-tool-guard); **`cat -n` = the only true gap — pi-tanium invents it** |

**Two corrections the audit made to this spec's assumptions** (verified against
pi-core source): (a) "which line diverged" is covered by @aboutlo, not novel;
(b) pi-core's edit internals (`normalizeForFuzzyMatch`, `fuzzyFindText`,
`applyReplacementsPreservingUnchangedLines`, `stripBom`, `detectLineEnding`,
`normalizeToLF`, `restoreLineEndings`, `generateDiffString`,
`generateUnifiedPatch`, `applyEditsToNormalizedContent`) are **NOT exported**
(`dist/index.js`) — pi-tanium reimplements them in its own pure modules; only
`createEditToolDefinition` + `withFileMutationQueue` are reused. See §4 + §4.1.

**Checkout method** (no `pi install` — keep it local to the workbench):

```bash
mkdir -p /Users/office/repos/_pi_subagents/registry-audit
cd /Users/office/repos/_pi_subagents/registry-audit
for pkg in pi-semantic-edit pi-tian-edit-safe edit-o-matic @aboutlo/pi-smart-edit pi-tool-guard pi-path-guard; do
  npm pack "$pkg"          # produces <name>-<version>.tgz
  mkdir -p "$pkg" && tar -xzf <name>-<version>.tgz -C "$pkg" --strip-components=1
done
```

(If `npm pack` fails for a scoped name, fetch the package page at
`https://pi.dev/packages/<pkg>` for the source repo link and `git clone` instead.)

**Result:** the audit is complete and judged (see ANALYSIS.md + the verified
matrix above). The architectural recommendations it produced are folded into
§4 (module factoring, own-apply orchestration), §A2 (layered hybrid fuzzy +
lift `LineMismatch`), §A7 (extend-with-filter), and §4.1 (anti-patterns). Phase
1 (`edit-shape.ts` / `edit-fuzzy.ts` / `edit-apply.ts` / `edit-diagnostics.ts`)
may proceed, sourcing its designs from the audit rather than re-deriving blind.

**Keep `/Users/office/repos/_pi_subagents/registry-audit/`** (decision C2) — do not delete the
checkouts; the implementer circles back at the end to analyze whether the
pi-tanium implementation improves upon all the inspiration sources. Do not
vendor any of this code into the pi-packages fork; the audit is read-only
research.

---

## 9. License posture & acknowledgements

### 9.1 License posture

- **pi-tanium is MIT.** Forced by fork lineage: `pi-path-recovery` (which pi-tanium
  renames) is MIT, from `gotgenes/pi-packages` ← `MasuRii/pi-permission-system`;
  the whole `robjgray/pi-packages` fork is MIT. Keep `"license": "MIT"` in
  `package.json` and add a `LICENSE` file at the pi-tanium package root with the
  MIT notice — your © line for the new code, plus the upstream lineage © for the
  inherited files (`match.ts`, `recover.ts`, the override pattern).
- **Clean-room reimplementation is the default posture.** Ideas / algorithms /
  APIs are not copyrightable; only code expression is. pi-tanium reimplements
  the lifted techniques in its own pure modules (required anyway — pi's
  internals aren't exported, §4). So lifting **ideas** triggers no license
  obligations.
- **If any code is ever copied or adapted verbatim** from an MIT package,
  preserve that package's © notice in a `NOTICES.md`. From an Apache-2.0 package
  (axe/goose), preserve `LICENSE`/`NOTICE` and state changes. Not expected —
  clean-room is the plan.
- **`@aboutlo/pi-smart-edit` has NO license** (pi.dev confirms "License unknown";
  no LICENSE file, no `license` field). Default copyright = all rights reserved.
  **Do NOT copy or adapt its code.** The `LineMismatch {line, file, sent}`
  concept and per-line-divergence idea are trivial / non-copyrightable —
  reimplement clean-room; credit the *concept* only (not the code), or omit.

### 9.2 Acknowledgements (goodwill; ideas only, clean-room reimplemented)

pi-tanium's techniques were informed by reading the source of these
publicly-available projects. **No code was copied** — this list is goodwill,
  inspired-by best practice (project → source → license → concept drawn, all
  reimplemented clean-room in pi-tanium's own pure modules).

| project | source | license | concept drawn (reimplemented clean-room) |
|---|---|---|---|
| pi-semantic-edit | https://github.com/k3-2o/pi-semantic-edit | MIT | 10-pass fuzzy chain (`passes.ts`); `findAllSpans` (replaceAll); `original.includes(actual)` re-verify invariant |
| pi-tian-edit-safe | https://github.com/TianZuo555/pi-tian-extensions (`packages/pi-edit-safe`) | MIT | argument shape / alias folding in `prepareArguments` |
| edit-o-matic | https://github.com/bighornwoods/edit-o-matic | MIT | whitespace-tolerant fallback ordering (also an anti-pattern to avoid: auto-reindent `newText`) |
| pi-tool-guard | https://pi.dev/packages/pi-tool-guard | MIT | edit/read argument alias table (also an anti-pattern to avoid: in-place mutation of `prepareArguments` input) |
| pi-path-guard | https://pi.dev/packages/pi-path-guard | MIT | computed `read(offset,limit)` suggestion for edit-mismatch diagnostics |
| @aboutlo/pi-smart-edit | https://pi.dev/packages/@aboutlo/pi-smart-edit | **unknown** | per-line divergence concept (`LineMismatch`) — **concept only; no code reused (no license)** |
| axe | https://github.com/SRSWTI/axe | Apache-2.0 | single-or-list `edit` schema; per-edit `replace_all` |
| goose | https://github.com/block/goose | Apache-2.0 | `line_offset`/`n_lines` partial reads; `append` write mode |

> **pi** (the platform at `/Users/office/repos/pi/`, published as `@earendil-works/pi-coding-agent`)
> is **MIT, © 2025 Mario Zechner** — license at `/Users/office/repos/pi/LICENSE` (easily viewable). It
> is the **platform** pi-tanium extends (peer dependency), not a lifted-technique
> source; pi-tanium composes with its exported `createEditToolDefinition` /
> `withFileMutationQueue` and follows its `prepareArguments` hook contract. (Its
> diff/normalize/fuzzy internals are NOT exported — §4 — so pi-tanium
> reimplements them.)
>
> The audit source for the above is `/Users/office/repos/_pi_subagents/registry-audit/ANALYSIS.md`
> (the audit workbench lives **outside the fork**, co-located under the same repos root);
> **keep the checkouts** (decision C2) — the implementer circles back at the
> end to analyze whether the pi-tanium implementation improves upon all the
> inspiration sources above.