---
title: 'pi-tanium — edit/read/write hardening (Prong A)'
type: 'feature'
created: '2026-08-07'
status: 'done'
review_loop_iteration: 0
baseline_commit: '4f8a969fc08cbbb5c72b95bcae48e63ba56a4eda'
context:
  - '{project-root}/_bmad-output/external/pi-tanium-spec.md'
  - '{project-root}/_bmad-output/planning-artifacts/research/technical-pi-core-inclusion-badlogic-2026-08-08/research.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Small local models running as pi agents fail at `edit` (51% success in a 46-session corpus — schema-shape errors ~12/33, match-not-found ~15/33) and fall back to `write` rewrite-loops (one session wrote `main.go` 22×), bloating context. Pi-core's `edit` is **not** pure exact-match — it already has a `fuzzyFindText`/`normalizeForFuzzyMatch` fallback (NFKC + per-line `trimEnd` + smart quotes/Unicode dashes/special spaces → ASCII). The *remaining* match gap is whitespace **runs** and **leading** whitespace (tab⇄space, multi-space indentation drift) that `normalizeForFuzzyMatch` does not collapse — the corpus's Sub-pattern A. The shape gap is a stringified single-object `edits` that `prepareEditArguments`' `Array.isArray` guard discards. Content drift (Sub-pattern B — the model reconstructed the block wrong) is not fixable by matching.
**Approach:** Rename `pi-path-recovery` → `pi-tanium` and override `edit`/`read`/`write` via `registerTool` (spread `createEditToolDefinition`/`createReadToolDefinition`/`createWriteToolDefinition`). Layer shape recovery on `prepareArguments`; run a staged fuzzy matcher (exact → whitespace-normalized → gated multi-pass → similar-lines error); add per-edit `replaceAll`; add `cat -n` line numbering + `offset`/`limit` coercion to `read`; add a soft `write` rewrite-loop guard. Reuse `match.ts` (Levenshtein/rankCandidates) and `withFileMutationQueue`.

## Boundaries & Constraints

**Always:**

- Compose, don't reimplement: spread the built-in tool definition; override only `prepareArguments` + `execute`; keep the built-in's `parameters`/`renderCall`/`renderResult` via spread-through. Own only the apply orchestration — pi-core throws on >1 occurrence with no `replaceAll` flag (`edit-diff.ts:333`), so `replaceAll` cannot be delegated.
- Pure modules (`edit-shape`, `edit-fuzzy`, `edit-apply`, `edit-diagnostics`, `read-shape`, `read-number`) are import-free and testable in isolation; `index.ts` is the only file with I/O or pi imports. Shared types live with the module that produces them (`edit-shape` owns `EditEntry`/`EditError`/`ApplyResult`; `edit-fuzzy` owns `LineMismatch`/`ClosestRegion`/`ReadSuggestion`).
- Mandatory invariant on every fuzzy pass: re-verify with `original.includes(actual)` before applying; never write normalized-query bytes.
- Apply all edits against the ORIGINAL (non-incremental), like pi-core.
- `promptGuidelines` via extend-with-filter on the `edit` override: drop the built-in's "oldText must match exactly" bullet, keep the rest, append the new contract. On `read`/`write`, extend the built-in's guidelines (no contradiction to filter).
- `prepareArguments` returns a fresh object (idempotent); never mutate the caller's input.
- Pin `@earendil-works/pi-coding-agent >=0.80.5` (matches pi-path-recovery).
- Stage 1 auto-apply only on exactly-one normalized match; `rankCandidates` for Stage 2 display only, never silent apply on content drift.
- `edit-shape` is **additive over** `builtin.prepareArguments` — delegate the recoveries core already does (stringified arrays, top-level legacy `oldText`/`newText`), add only the corpus-evidenced gaps (stringified single-object unwrap, unparseable-string → shape error). Same extend-don't-freeze discipline as `promptGuidelines`.
- The write-count `Map` resets on every `session_start` (reload/new/resume/fork) — bounded lifecycle, no unbounded growth; a `/reload` mid-rewrite-loop resets the count (accepted tradeoff).
- The `unicode_normalized` Stage 2 pass is **core-parity** (a re-implementation of pi-core's `normalizeForFuzzyMatch` — NFKC + smart quotes/dashes — forced because the helper is internal-only and pi-tanium owns the apply). The **novel** dimension is Stage 1's whitespace-run collapse + leading-whitespace strip + tab⇄space — the normalization core lacks and the upstream-contribution candidate.

**Never:**

- Reimplement `edit` from scratch (own I/O, own renderers, own diff) — compose via spread.
- Sequential multi-edit semantics (apply against a running buffer) — apply against the original.
- Auto-reindent `newText` — never modify `newText`; only normalize matching of `oldText`.
- Collapse ASCII quotes — map only typographic quotes/dashes (`“” ‘’ – —`) → ASCII.
- Freeze `promptGuidelines` as a static copy — extend-with-filter so pi-core updates flow.
- Fuzzy auto-apply on content drift (Sub-pattern B) — show the real region + the divergent line instead.
- Override `grep` (core built-in, nothing to harden) — out of scope.
- No unevidenced alias vocabulary — drop `old`/`old_str`/`old_string`/`oldContent`/`original`/`search` and `file`/`filePath`/`start`/`lines` aliases unless the 46-session corpus shows models actually emit them. The schema documents `oldText`/`newText`/`edits`/`path`/`offset`/`limit`; aliases lifted from pi-tian-edit-safe/pi-tool-guard are slop (CONTRIBUTING.md "One Rule").
- `cat -n` read line numbering, `replaceAll`, the write rewrite-loop guard, and similar-lines edit errors are **extension-only** — the pi maintainer rejects them as core (token-cost for cat-n; the deliberate uniqueness invariant for replaceAll; the YOLO/no-safety-rails stance for the write guard; "if I don't need it" for similar-lines errors). Do not frame them as core contributions.
- Prong B (bash steering via `pi-permission-system` deny config + `bash-gate.ts` + `APPEND_SYSTEM.md`) — deferred to a follow-on spec.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| `edits` = stringified single object `{"oldText":…,"newText":…}` | pi-core discards it (the §A1 gap) | Unwrap to `[{oldText,newText}]` and apply | N/A |
| `edits` = unparseable string | malformed JSON under load | Return a structured shape error with the canonical `edits:[{oldText,newText}]` example | `EditError` kind `"shape"` |
| `oldText` whitespace-run / leading-whitespace / tab⇄space drift (the dimension `normalizeForFuzzyMatch` misses) | Sub-pattern A | Stage 1 normalized match → apply on exactly-one hit; `[tanium]` notice | N/A |
| `oldText` content drift (wrong words) | Sub-pattern B | Stage 3: return closest region + line numbers + divergent line; do NOT guess-apply | `EditError` kind `"not-found"` with `readSuggestion` |
| `oldText` not unique, `replaceAll` not set | multiple occurrences | Return occurrences + `readSuggestion` | `EditError` kind `"not-unique"` |
| `read` returns content | any path | Output prefixed with `cat -n` line numbers (`    42 \| …`) | N/A |
| `write` to a path already written k≥2 times, file exists & large | rewrite loop | Apply the write; result carries a notice pointing at `edit` (not a block) | N/A |

</frozen-after-approval>

## Code Map

- `packages/pi-tanium/src/match.ts` -- KEEP (existing): `levenshtein`, `commonPrefixLength`, `scoreMatch`, `rankCandidates` — zero-dep; reused for Stage 2 closest-region ranking.
- `packages/pi-tanium/src/recover.ts` -- KEEP (existing): path "Did you mean?" guard for read/write/edit; stays as the path-recovery layer.
- `packages/pi-tanium/src/edit-shape.ts` -- NEW, pure: `normalizeEdits(input)` — calls `builtin.prepareArguments(input)` first (delegates the recoveries core already does: stringified arrays, top-level legacy `oldText`/`newText`), then adds only the corpus-evidenced gaps: single-object unwrap, stringified-single-object (`JSON.parse`→object→wrap), unparseable-string → `shape` error with the canonical `edits:[{oldText,newText}]` example. No alias table. Returns a fresh object. Owns the shared `EditEntry`/`EditError`/`ApplyResult` types.
- `packages/pi-tanium/src/edit-fuzzy.ts` -- NEW, pure: `fuzzyMatch(content, edit): ok | ambiguous | notFound` + the `LineMismatch`/`ClosestRegion`/`ReadSuggestion` types it produces. Stage 0 exact (`content.includes`); Stage 1 whitespace-run + leading-whitespace + tab⇄space (the **novel** dimension `normalizeForFuzzyMatch` lacks; apply on exactly-one); Stage 2 gated multi-pass — 4 pi-semantic-edit passes (`line_trimmed`, `whitespace_normalized`, `indentation_flexible`, `escape_normalized`) plus `unicode_normalized` as **core-parity** (re-implementation of `normalizeForFuzzyMatch`'s NFKC + smart quotes/dashes, forced by internal-only). Each pass returns original substrings re-verified via `original.includes(actual)`, rejected by `isDisproportionateMatch` (≥ `max(oldLines+3, oldLines*2)` lines), apply on exactly-one.
- `packages/pi-tanium/src/edit-apply.ts` -- NEW, pure: `applyEdits(normalizedContent, edits) → { content; results } | { error }`. Against ORIGINAL; `replaceAll` branch via `findAllSpans` (indexOf advancing by 1, non-overlapping, bottom-up); non-replaceAll via `fuzzyMatch`; overlap + no-op detection.
- `packages/pi-tanium/src/edit-diagnostics.ts` -- NEW, pure: `similarLinesError(content, edit, closestRegion): EditError` — `LineMismatch` (per-line divergence, reimplemented clean-room from the @aboutlo concept — no license, no code reused) + `readSuggestion` + similarity %. Structured typed metadata (never regex-parse pi-tanium's own errors).
- `packages/pi-tanium/src/read-shape.ts` -- NEW, pure: `coerceReadArgs(input)` — `offset`/`limit` string→number coercion only (no alias folding — the frozen `Never` drops `file`/`filePath`/`start`/`lines` aliases as unevidenced slop; the schema documents `offset`/`limit`).
- `packages/pi-tanium/src/read-number.ts` -- NEW, pure: `numberLines(text, startLine = 1): string` — `cat -n` formatting (`    42 | …`).
- `packages/pi-tanium/src/index.ts` -- REWRITE (only file with I/O/pi imports): `registerTool("read")` path-recovery guard + `coerceReadArgs` + `numberLines`; `registerTool("write")` path-recovery guard + rewrite-loop guard (session-scoped write-count `Map`); `registerTool("edit")` `prepareArguments` (layer on builtin via `createEditToolDefinition(cwd).prepareArguments`) → `applyEdits` → `edit-diagnostics`; wrap file work in `withFileMutationQueue`. `promptGuidelines` extend-with-filter on edit, extend on read/write.
- pi-core `packages/coding-agent/src/core/tools/edit.ts:287` -- `createEditToolDefinition(cwd, options?)` EXPORTED (installed 0.80.5 `dist/index.d.ts:23`). Returns a `ToolDefinition` literal — spread copies `promptSnippet`/`promptGuidelines` (4 bullets, incl. "oldText must match exactly" — the one to filter)/`parameters`/`renderCall`/`renderResult`/`prepareArguments`.
- pi-core `packages/coding-agent/src/core/tools/edit.ts:94-117` -- `prepareEditArguments`: recovers stringified ARRAY + top-level legacy `oldText`/`newText`; does NOT recover a stringified single object (the `Array.isArray` guard discards it — the §A1 gap).
- pi-core `packages/coding-agent/src/core/tools/edit-diff.ts:333` -- `applyEditsToNormalizedContent` throws on >1 occurrence; NO `replaceAll` flag exists (the §A4 gap).
- pi-core `packages/coding-agent/src/core/tools/edit-diff.ts` -- `normalizeForFuzzyMatch`, `fuzzyFindText`, `applyReplacementsPreservingUnchangedLines`, `stripBom`, `detectLineEnding`, `normalizeToLF`, `restoreLineEndings` are INTERNAL-ONLY (not in the public entry, any version) → pi-tanium reimplements them. `generateDiffString`/`generateUnifiedPatch`/`EditDiffResult` are exported in 0.80.5+ (available, but spread-through keeps the built-in renderer so they are not required).
- pi-core `packages/coding-agent/src/core/tools/file-mutation-queue.ts:51` -- `withFileMutationQueue(filePath, fn)` EXPORTED; per-realpath serialization. Reuse for the edit/write apply.
- pi-core `packages/coding-agent/src/core/tools/read.ts` -- `createReadToolDefinition` EXPORTED; schema `path`/`offset`/`limit`; NO `prepareArguments`; `promptGuidelines: ["Use read to examine files instead of cat or sed."]`.
- pi-core `packages/coding-agent/src/core/tools/write.ts` -- `createWriteToolDefinition` EXPORTED; schema `path`/`content`; NO `prepareArguments`; NO rewrite-loop guard; `promptGuidelines: ["Use write only for new files or complete rewrites."]`.
- pi-core `packages/coding-agent/src/core/extensions/types.ts:445,1246` -- `ToolDefinition` (required: name/label/description/parameters/execute; optional: promptSnippet/promptGuidelines/prepareArguments/renderCall/renderResult); `registerTool(tool)` overrides built-ins by name (`agent-session.ts:2470-2522` — custom overwrites built-in in both the definition registry and the executable tool registry; no fallback for prompt metadata, so spread-through is required).
- pi-core `agent-loop.ts` `prepareToolCallArguments` -- `prepareArguments` is called BEFORE `execute`, receives raw args, returns a schema-conforming object; its output is schema-validated before `execute` runs.
- `/Users/office/repos/_pi_subagents/registry-audit/ANALYSIS.md` -- §8.3 consolidation audit (COMPLETE): per-package analysis + the verified consolidation matrix + lift/avoid summary. Read for the 10-pass chain details (pi-semantic-edit `passes.ts`), the alias table (pi-tian-edit-safe `prepare-arguments.ts` + pi-tool-guard `aliases.ts`), `findAllSpans` (pi-semantic-edit — the only replaceAll impl), and the `LineMismatch` concept (@aboutlo — concept only; NO license, do NOT copy code). Keep the checkouts (decision C2); do not vendor.
- `packages/pi-path-recovery/` -- the rename source (v0.1.0, unpublished, MIT). Rename to `packages/pi-tanium/`: `package.json` name → `@gotgenes/pi-tanium`, README title, `.pi/settings.json` load path, `release-please-config.json` + `.release-please-manifest.json` (per AGENTS.md new-package wiring — add to `packages` component + `exclude-paths`, manifest at `0.0.0`; no npm disable entry until first publish).

## Tasks & Acceptance

**Execution:**

- [x] `src/edit-shape.ts` -- `normalizeEdits` additive over `builtin.prepareArguments` (single-object unwrap, stringified-single-object, unparseable→shape error; no alias table) + owns `EditEntry`/`EditError`/`ApplyResult` -- recovers the §A1 gap without redeclaring core's recoveries.
- [x] `src/edit-fuzzy.ts` -- `fuzzyMatch` staged (0 exact, 1 whitespace-run/leading-ws/tab⇄space, 2 gated multi-pass incl. core-parity `unicode_normalized`) with `original.includes(actual)` invariant + `isDisproportionateMatch` + owns `LineMismatch`/`ClosestRegion`/`ReadSuggestion` -- the matcher.
- [x] `src/edit-apply.ts` -- `applyEdits` against original; `replaceAll` via `findAllSpans`; overlap/no-op detection -- owns apply orchestration.
- [x] `src/edit-diagnostics.ts` -- `similarLinesError` (`LineMismatch` + `readSuggestion` + similarity) -- the Stage 3 actionable error.
- [x] `src/read-shape.ts` -- `coerceReadArgs` number coercion only (no alias folding — frozen Never) -- read arg recovery.
- [x] `src/read-number.ts` -- `numberLines` cat -n formatting -- line-numbered output.
- [x] `src/index.ts` -- register read/write/edit overrides + `promptGuidelines` extend-with-filter + write rewrite-loop guard -- the thin adapter.
- [x] `test/edit-shape.test.ts` + `test/edit-fuzzy.test.ts` + `test/edit-apply.test.ts` + `test/edit-diagnostics.test.ts` + `test/read-shape.test.ts` + `test/read-number.test.ts` -- NEW per-module pure suites (every matrix row + the §1.2 drift cases + the `original.includes(actual)` invariant + `isDisproportionateMatch`).
- [x] `test/index.test.ts` -- REWRITE: integration — override registration, `prepareArguments` layering, the full I/O matrix end-to-end, `promptGuidelines` extend-with-filter (the "must match exactly" bullet is absent, new bullets present), write rewrite-loop guard fires at k≥2.
- [x] `package.json` + `README.md` -- rename to `@gotgenes/pi-tanium`; update description/keywords; document the hardened edit contract (single-or-list, `replaceAll`, whitespace-tolerant, re-issue from the region shown) + the read line-numbering + write guard.
- [x] repo wiring: `.pi/settings.json` load path `../packages/pi-tanium`; `release-please-config.json` (add `pi-tanium` component + `exclude-paths`) + `.release-please-manifest.json` (`packages/pi-tanium` at `0.0.0`) -- new-package wiring per AGENTS.md.

**Acceptance Criteria:**

- Given `edits` as a stringified single object `{"oldText":"a","newText":"b"}`, when the model calls edit, then it is unwrapped to one edit and applied (no validation failure).
- Given `oldText` with tab/space/trailing-whitespace drift from the file, when edit is called, then Stage 1 normalized match applies on exactly-one hit with a `[tanium]` notice.
- Given `oldText` with content drift (wrong words), when edit is called, then the tool returns a structured `not-found` error naming the closest region with line numbers + the divergent line + a `read(offset,limit)` suggestion; it does NOT guess-apply.
- Given a non-unique `oldText` with `replaceAll: true` on that edit, when edit is called, then every occurrence is replaced.
- Given a `read` call, when it returns content, then each line is prefixed with its `cat -n` line number.
- Given the same path is `write`n 3 times in a session to a large existing file, when the 3rd write runs, then the write applies and the result carries a notice pointing at `edit`.
- Given the `edit` override's `promptGuidelines`, when pi assembles the system prompt, then the built-in's "oldText must match exactly" bullet is absent and the new contract bullets are present.

## Spec Change Log

## Design Notes

**Why compose instead of reimplement.** 4 of 6 audited packages reimplement `edit` from scratch (own I/O, own renderers, own diff) — the anti-pattern. pi-tanium spreads `createEditToolDefinition(cwd)` so the built-in's `parameters`/`renderCall`/`renderResult`/`promptSnippet` flow through, and overrides only `prepareArguments` + `execute`. The built-in's `execute` throws on >1 occurrence with no `replaceAll` flag (`edit-diff.ts:333`), so pi-tanium owns the apply (`edit-apply.ts`) — the one thing that cannot be delegated. The 8 fuzzy/normalize/line-ending helpers are INTERNAL-ONLY (verified — not in the public entry in any version), so pi-tanium reimplements them in its own pure modules; `generateDiffString`/`generateUnifiedPatch` ARE exported in 0.80.5+ but aren't needed (spread-through keeps the built-in renderer).

**Staged matcher (§A2).** Stage 0 exact (cheapest). Stage 1 covers the normalization dimension pi-core's `normalizeForFuzzyMatch` **lacks** — collapsing whitespace **runs**, stripping **leading** whitespace, tab⇄space (the `main.go` indentation cases; core only `trimEnd`s and converts special Unicode spaces) — apply on exactly-one. Stage 2 gated multi-pass — 4 pi-semantic-edit passes (`line_trimmed`, `whitespace_normalized`, `indentation_flexible`, `escape_normalized`) plus `unicode_normalized` as **core-parity** (re-implementation of `normalizeForFuzzyMatch`'s NFKC + smart quotes/dashes, forced because the helper is internal-only and pi-tanium owns the apply); each pass returns original substrings, re-verified `original.includes(actual)` (the single most important safety technique — never write normalized bytes), rejected by `isDisproportionateMatch`. Stage 3 "similar lines" — @aboutlo's `LineMismatch` (concept, clean-room) + pi-path-guard's `read(offset,limit)` suggestion + pi-semantic-edit's similarity %, returned as a structured `EditError` with exact line numbers so the model closes the loop with one cheap partial read instead of re-`write`ing the whole file.

**Core-worthiness & upstream candidates.** A `/bmad-deep-recon` on the pi maintainer's thin-core/anti-slop stance (artifacts at `_bmad-output/planning-artifacts/research/technical-pi-core-inclusion-badlogic-2026-08-08/`) grounds this. Governing rule: *"if I don't need it, it won't be built."* CONTRIBUTING.md: *"PRs that bloat the core will likely be rejected."* The extension model (overridable built-ins, `tool_call` gates) is the intended home for opinionated remediation. Two features are **bug fixes to existing core behavior** — the one contribution path the maintainer welcomes — and are upstream candidates via the **issue-first `lgtm` gate** (new-contributor PRs are auto-closed; earn the maintainer's interest with an issue first, then PR):
- **Stringified-single-object recovery** → loosen `prepareEditArguments`' `Array.isArray` guard to unwrap a single object. A correctness fix to a shape real models emit that core discards.
- **Whitespace-run / leading-whitespace normalization** → extend `normalizeForFuzzyMatch` to collapse `\s+` runs and strip leading whitespace. The normalization dimension core lacks (the Sub-pattern A cases).
Everything else is **extension-only** per the maintainer's criteria: `replaceAll` (contradicts the deliberate uniqueness invariant — `countOccurrences > 1` throws); `cat -n` read numbering (token-cost criterion — adds per-call overhead to every read); the write rewrite-loop guard (YOLO/no-safety-rails stance — "mostly security theater"); similar-lines edit errors (generic error kept deliberately; "if I don't need it"). The spec ships them as extension overrides — the sanctioned home — and does **not** promise to upstream them. The two candidates above are noted for a *future* issue-first pitch, not a PR from this work.

**`promptGuidelines` extend-with-filter (§A7).** `promptSnippet`/`promptGuidelines` are NOT registry-inherited from the built-in on override (verified — `agent-session.ts:2489-2504` reads them off the registered definition with no fallback). Spread-through copies them onto the override. But the built-in `edit` guideline says "oldText must match exactly" — which contradicts the new whitespace-tolerant contract. So on `edit`: filter out that one bullet, keep the rest (pi-core updates flow through), append the new contract (single-or-list, `replaceAll`, whitespace-tolerant, re-issue from the region). On `read`/`write`: extend (no contradiction). This teaches the model the new contract for free at the system-prompt seam.

**`LineMismatch` license posture.** `@aboutlo/pi-smart-edit` has NO license (all rights reserved). The `LineMismatch {line, sent, got}` concept is non-copyrightable; pi-tanium reimplements it clean-room. No code is copied. Credit the concept in `README.md` acknowledgements only.

**Audit workbench.** `/Users/office/repos/_pi_subagents/registry-audit/` holds the 6 checked-out packages + `ANALYSIS.md` (read-only research, outside the fork). Do not vendor any of it; the implementer circles back at the end to confirm pi-tanium improves on the inspiration sources (decision C2).

## Verification

**Commands:**

- `pnpm --filter @gotgenes/pi-tanium run check` -- expected: tsc clean.
- `pnpm --filter @gotgenes/pi-tanium run test` -- expected: all tests pass.
- `pnpm --filter @gotgenes/pi-tanium run lint` -- expected: biome + rumdl clean.
- `pnpm fallow dead-code` -- expected: no issues (CI gates on it; devDependencies copied from a sibling often include unused entries).

**Manual checks:**

- `pi -e packages/pi-tanium` with a laguna model: confirm a whitespace-drift `edit` applies via Stage 1; a content-drift `edit` returns the region + divergent line; a `read` shows `cat -n` line numbers; a 3× `write` to a large file shows the rewrite-loop notice.
- Inspect the assembled system prompt (`/dump` or equivalent) to confirm the `edit` guidelines carry the new contract and NOT "must match exactly".

## Suggested Review Order

**Entry point & handler wiring**

- Lead stop — the three overrides + session_start write-count reset; read first to grasp the compose-then-override design.
  [`index.ts:44`](../../packages/pi-tanium/src/index.ts#L44)

- `wrapEdit`: custom `parameters` schema + `description` (declare `replaceAll`, drop the "exact/unique" contradiction), shape-error throw, replacement-count success text.
  [`index.ts:210`](../../packages/pi-tanium/src/index.ts#L210)

- `wrapWrite`: write-count incremented only after a successful write; soft rewrite-loop guard at k≥2.
  [`index.ts:133`](../../packages/pi-tanium/src/index.ts#L133)

- `numberReadText`: preserves pi-core's `\n\n[…]` and `\n[…]` trailing notices verbatim (the `noticeMatch[0]` capture fix).
  [`index.ts:113`](../../packages/pi-tanium/src/index.ts#L113)

- `resolveToCwd`: expands only `~`/`~/`, not `~user` (the path-resolution safety fix).
  [`index.ts:55`](../../packages/pi-tanium/src/index.ts#L55)

**Edit hardening (pure modules)**

- `fuzzyMatch` staged matcher — Stage 0 exact → Stage 1 whitespace-run/leading-ws/tab⇄space (the novel dimension) → Stage 2 gated multi-pass; the `original.includes(actual)` invariant.
  [`edit-fuzzy.ts:297`](../../packages/pi-tanium/src/edit-fuzzy.ts#L297)

- `applyEdits` owns the apply (against-original, non-incremental); `replaceAll` via `findAllSpans`; overlap/no-op detection.
  [`edit-apply.ts:69`](../../packages/pi-tanium/src/edit-apply.ts#L69)

- `detectLineEnding` count-based dominant (the first-wins fix).
  [`edit-apply.ts:34`](../../packages/pi-tanium/src/edit-apply.ts#L34)

- `similarLinesError` — the Stage 3 actionable not-found error (closest region + diverging line + `read` suggestion).
  [`edit-diagnostics.ts:39`](../../packages/pi-tanium/src/edit-diagnostics.ts#L39)

- `normalizeEdits` additive over `builtin.prepareArguments` (delegates core's recoveries; adds only the §A1 single-object gap).
  [`edit-shape.ts:79`](../../packages/pi-tanium/src/edit-shape.ts#L79)

**Read & shape**

- `numberLines` — the `cat -n` formatting (the one novel read piece).
  [`read-number.ts:16`](../../packages/pi-tanium/src/read-number.ts#L16)

- `coerceReadArgs` — `offset`/`limit` coercion only (no alias folding, per the frozen `Never`).
  [`read-shape.ts:34`](../../packages/pi-tanium/src/read-shape.ts#L34)

**Peripherals**

- Integration suite — override registration, promptGuidelines extend-with-filter, full edit I/O matrix, read notice preservation, write guard + session_start reset.
  [`index.test.ts`](../../packages/pi-tanium/test/index.test.ts)

- Pure-module suites — `edit-apply` (replaceAll, not-unique, detectLineEnding), `edit-fuzzy`, `edit-diagnostics`, `edit-shape`, `read-number`.
  [`edit-apply.test.ts`](../../packages/pi-tanium/test/edit-apply.test.ts)

- Package + repo wiring — `@gotgenes/pi-tanium`, `files: ["src"]`, `publishConfig`, typebox dep, release-please manifest at `0.0.0`.
  [`package.json`](../../packages/pi-tanium/package.json)