---
title: 'pi-permission-system — bash file-mutation residual gates (Prong B)'
type: 'feature'
created: '2026-08-08'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'cefe0a07ecde259a2c88ab1b84d0f8ccaff2edf6'
context:
  - '{project-root}/_bmad-output/external/pi-tanium-spec.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Small-model pi agents circumvent the hardened `edit`/`read`/`write` tools via `bash` — the corpus's headline escape hatch is `python3 - <<'PY' …open()/write()… \nPY` (heredoc file IO), plus `cmd > source.go` redirects. `pi-permission-system`'s bash config can't see heredoc bodies (tree-sitter `COMMAND_ENUM_SKIP` strips `heredoc_body`; the matcher sees only bare `python3`), and its `bash_path` gate reads redirect targets but resolves them against the cross-cutting `path` surface — so a `path` deny on `*.go` catches `> main.go` *and* blocks the `edit`/`write` tools we're steering toward.
**Approach:** Two minimal, in-domain expansions of the `pi-permission-system` fork (no pi-tanium code): (1) expose `bash_path` as a writable config surface — the gate already reads redirect targets; resolve them against `bash_path` (not `path`) so `> source.go` is deniable without blocking `edit`/`write`; (2) add a raw-command match in the bash-command gate — resolve the full `event.input.command` (heredoc body included) on the existing `bash` surface alongside the tree-sitter units, so patterns like `"python3 *open(*"` catch the heredoc and every future string-based workaround. Plus a documented global `APPEND_SYSTEM.md` drop-in (the cross-tool prevention nudge). This is a permissions problem; it lives in the permissions package.

## Boundaries & Constraints

**Always:**

- Build **fork-local** — eval the design in this fork first; upstream to MasuRii only if it proves out and MasuRii wants it (the fork has "diverged substantially" at v24.0.0, so no upstream-first).
- Reuse existing machinery — the `bash_path` gate already reads redirect targets (`bash-path.ts:40-42`); the `bash` surface already matches command strings (`bash-command.ts`). Expose/wire, don't reimplement.
- A `bash_path` deny must NOT block `edit`/`write` — those gate through the `path` surface (`path.ts`), a distinct gate from `bash_path` in the pipeline (`tool-call-gate-pipeline.ts:103-137`).
- Deny-with-reason surfaces the reason to the agent — the `bash_path` `DenialContext` builders currently omit `reasonSuffix` (`denial-messages.ts:112,208,238`); add it. The `bash` command gate already surfaces it (`denial-messages.ts:121-148`).
- `yoloMode` preserves `deny` rules (hard walls, no prompts) — `rule.ts:52-67`. The new surfaces inherit this.
- Last-match-wins per pattern (existing wildcard semantics, `rule.ts:100-115`).

**Never:**

- No new "content inspector" class, plugin architecture, or regex registry — use the existing pattern→wildcard→`deny` mechanism. No slop, no AI-crazy abstractions.
- No new surface beyond `bash_path` (the schema already accepts it, `config-schema.ts:76-82`). No new flavor enum (none exists; `PathFlavor` is just win32/POSIX fold, `path-flavor.ts`).
- No pi-tanium code — Prong B is a `pi-permission-system` change; pi-tanium stays purely tool-hardening.
- No blocking `edit`/`write` to source files — the `bash_path` surface is distinct from `path`.
- No model-judge / new authorizer chain — out of scope; the static `deny` config + raw-command match is the mechanism.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|---------------|-------------------|----------------|
| `python3 - <<'PY'\nopen('/etc/passwd','w')\nPY` (heredoc file IO) | `permission.bash["python3 *open(*"] = { action: "deny", reason: "…" }` | Raw-command match catches the heredoc body → deny with reason | deny reason surfaced |
| `sed 's/a/b/' f > main.go` (redirect to source — a **write**) | `permission.bash_path["*.go"] = { action: "deny", reason: "…" }` | `bash_path` catches `> main.go` (a `file_redirect` write) → deny with reason | deny reason surfaced; `edit`/`write` to `*.go` unaffected; `cat main.go` (bash **read**) NOT denied by `bash_path` (resolves to `path`) |
| `cat .env` (bash read) with `path: {"*.env": "deny"}` only (no `bash_path` rule) | `path`-only config, no `bash_path` rule | `bash_path` no-explicit-match → **fallback to `path`** → deny (**no silent regression**) | N/A |
| `edit`/`write` to `*.go` (the tools we steer toward) | same `bash_path` deny config | NOT denied (gates through `path`, not `bash_path`) | N/A |
| `python3 -c 'open()'` (already detectable) | `permission.bash["python3 -c *open(*"] = deny` | Existing unit match → deny (unchanged) | N/A |
| `sed -i f` (already detectable) | `permission.bash["sed -i *"] = deny` | Existing unit match → deny (unchanged) | N/A |
| Unmatched bash + `yoloMode: true` | only `deny` rules | Allowed (yolo rewrites `ask`→`allow`; `deny` is the hard wall) | N/A |
| `bash -c 'open()'` (shell-wrapper) | `permission.bash["*open(*"] = deny` | Raw match denies; `pickMostRestrictive(deny > ask > allow)` keeps the wrapper-floor intent (`ask` for an allowed inner command still wins over a raw `allow`) | N/A |

</frozen-after-approval>

## Code Map

- `packages/pi-permission-system/src/access-intent/path-surfaces.ts:26-30` — `PATH_SURFACES` set. Add `"bash_path"` — membership drives win32 case/separator fold (`rule.ts:122-127` `pathMatchOptions`) and `evaluateAnyValue` (last-match-wins-across-aliases) vs `evaluateFirst` (`permission-manager.ts:349-351`).
- `packages/pi-permission-system/src/handlers/gates/bash-path.ts:54-60` — the `bash_path` gate already reads redirect-target path tokens (`bashProgram.pathRuleCandidates()`); **B′: backward-compat fallback + redirect-scope.** The gate evaluates all bash path tokens (`bashProgram.pathRuleCandidates()`). For `file_redirect` (write) tokens, resolve against `surface: "bash_path"`; on no explicit `bash_path` rule match, **fall back to `path`** (extends the `#58` guard). For bare-filename (read) tokens, resolve against `path`. `bash_path` means "bash writes via redirect to these paths"; `path`-only configs keep bash read+write protection via the fallback (no silent regression).
- `packages/pi-permission-system/src/denial-messages.ts:112,208,238` — the three `bash_path` `DenialContext` body builders (`buildDenyBody`/`buildUnavailableBody`/`buildUserDeniedBody`). Add `reasonSuffix(...)` so a `bash_path` `deny`-with-reason surfaces its reason (the `PermissionCheckResult.reason` is already populated; only the formatting omits it). Mirror the `kind: "tool"` branch at `:121-148`.
- `packages/pi-permission-system/src/handlers/gates/bash-command.ts:53-104` — `resolveBashCommandCheck`. The full raw `command` (first param, = `bashProgram.commandText()`, heredoc body included) is already in scope but only the tree-sitter units (`cmd.text`) are resolved. Add a `rawCheck = resolver.resolve({ kind: "tool", surface: "bash", input: { command } })` and fold it into the `results` array before `pickMostRestrictive` — so a `bash` pattern matches the full command string, not just the decomposed units. No new flavor value/surface. **Also fold the raw `command` into the zero-units (unparseable) path** — that path short-circuits to the `ask` floor before the raw resolve; resolve the raw command there too and return `deny` if it matches a `deny` rule (else keep the fail-closed `ask`), so a `deny` pattern catches an unparseable command's raw string.
- `packages/pi-permission-system/src/handlers/gates/tool-call-gate-pipeline.ts:103-137` — the gate pipeline (read-only reference): `path` (tools) → `bash_external_directory` → `bash_path` → `bash-command`; short-circuits on the first `block` (`:145-147`). Confirms `bash_path` is distinct from `path`.
- `packages/pi-permission-system/src/config-schema.ts:76-87` — `permissionSchema` is a `z.record(z.string().min(1), …)`; `bash_path` is already an accepted key. **Update the `markdownDescription`**: `path` no longer gates bash (now `bash_path`); enumerate `bash_path`; correct "applies to all file access" → "all file **tool** access". Regenerate `schemas/permissions.schema.json`.
- `packages/pi-permission-system/src/rule.ts:100-140` — `evaluate`/`ruleMatches`/`pathMatchOptions` (read-only): wildcard last-match-wins; the raw command is just another value passed to `resolver.resolve`.
- `packages/pi-permission-system/src/access-intent/input-normalizer.ts:156-170` — `normalizeInput` bash branch (read-only): already produces `values: [command]` (comment-stripped) for a `bash` tool intent; the raw-command match reuses this.
- `packages/pi-permission-system/test/` — NEW tests: `bash_path` surface deny (redirect to `*.go`, `edit`/`write` unaffected, `#58` compat preserved), raw-command match (heredoc body `python3 *open(*`, shell-wrapper floor preserved via `pickMostRestrictive`), `bash_path` deny-with-reason surfacing.
- `packages/pi-permission-system/README.md` — document the new `bash_path` surface (redirect-to-source denies without blocking `edit`/`write`), the raw-command matching behavior (bash patterns now match the full command, heredoc bodies included), and the global `APPEND_SYSTEM.md` drop-in example (the cross-tool "use `edit`/`read`/`write`, not `bash` python/sed; use the `grep` tool" nudge).

## Tasks & Acceptance

**Execution:**

- [x] `src/access-intent/path-surfaces.ts` -- add `"bash_path"` to `PATH_SURFACES` -- win32 fold + last-match-wins-across-aliases for the new surface.
- [x] `src/config-schema.ts` + `schemas/permissions.schema.json` -- update the `permissionSchema` markdownDescription (`path` no longer gates bash; enumerate `bash_path`; "all file **tool** access"); regenerate the schema -- keep docs in sync.
- [x] `src/handlers/gates/bash-path.ts` -- **B′ (most-restrictive)**: write (`file_redirect`, excluding `<` input) tokens resolve **both** `bash_path` and `path` → `pickMostRestrictive` (`bash_path` can only add restrictions; a `path` deny always holds; a `bash_path` catch-all allow does NOT bypass it); read (argument + `<` input) tokens resolve `path` only -- `bash_path` = bash-redirect-writes; `path`-only configs keep bash protection.
- [x] `src/access-intent/bash/token-collection.ts` -- tag `<`/`<&`/`<<<` input redirects as reads (`argument`), `>`/`>>`/`&>`/`&>>` as writes (`redirect`) -- reads route to `path`, not `bash_path`.
- [x] `src/denial-messages.ts` -- add `reasonSuffix(...)` to the `bash_path` DenialContext body builders -- surface a `bash_path` deny-with-reason to the agent.
- [x] `src/handlers/gates/bash-command.ts` -- raw-command `resolver.resolve` (full `event.input.command`, heredoc body included) folded into `results` before `pickMostRestrictive`; also fold the raw command into the zero-units (unparseable) path (surface a real matched `deny`/`ask`'s pattern+reason; else the fail-closed `ask` sentinel) -- patterns match the full command string, including unparseable commands.
- [x] `test/` -- `bash_path` redirect-deny (most-restrictive: catch-all allow doesn't bypass a `path` deny) + read-routes-to-`path` + `<` input-redirect read + `#58` compat + deny-with-reason; raw-command match (heredoc body, shell-wrapper floor, zero-units real-ask-match); `path`-only boundary regression (`echo > .env` stays denied under `path`-only); `PATH_SURFACES` membership -- covers every matrix row.
- [x] `README.md` + `docs/configuration.md` -- document `bash_path` (bash-redirect-writes; most-restrictive with `path`; reads via `path`; not blocking edit/write), raw-command matching (full command, cross-chain semantics), the opt-in migration how-to, the global `APPEND_SYSTEM.md` drop-in; correct the "backward compatible" / "all tools" / `external_directory` claims.

**Acceptance Criteria:**

- Given `permission.bash_path["*.go"] = { action: "deny", reason: "Use edit, not bash redirects." }` and a `sed 's/a/b/' f > main.go` bash call, when the gate runs, then the bash call is denied with the reason AND an `edit`/`write` to `*.go` is NOT denied (gates through `path`, unaffected).
- Given `permission.bash["python3 *open(*"] = { action: "deny", reason: "…" }` and a `python3 - <<'PY'\nopen('/etc/passwd','w')\nPY` bash call, when the gate runs, then the call is denied (the raw-command match catches the heredoc body).
- Given a `bash_path` deny with a `reason`, when the agent is denied, then the reason appears in the denial message.
- Given `yoloMode: true` and only `deny` rules, when an unmatched bash command runs, then it is allowed (`deny` is the hard wall; yolo suppresses prompts).
- Given `permission.bash["*open(*"] = deny` and a `bash -c 'open()'` call where the inner command would otherwise be `allow`, then the wrapper-floor `ask` (more restrictive than the raw `allow`) still applies — `pickMostRestrictive` composes them correctly.

## Spec Change Log

### Entry 1 (2026-08-08) — bad_spec loopback: `path`→`bash_path` split is breaking; adopt B′

- **Triggering finding:** Step-04 review (blind-hunter + verification-gap + the step-03 subagent): the `path`→`bash_path` split is a breaking change the spec framed as "additive / `feat` (minor)". Existing `path`-only configs (e.g. `path: {"*.env": "deny"}`) silently lost bash-side protection (bash tokens route to `bash_path`, inert if no rule); the shipped `config.example.json` regressed its own `.env` example; the README falsely claimed "backward compatible with `path`-only configs."
- **Amended (non-frozen):** Design Notes "Backward compatibility" → the **B′** decision; I/O matrix row 2 (redirect-**writes**; reads resolve to `path`) + a new fallback row (`bash_path` no-match → `path`, no silent regression); Code Map `bash-path.ts` (fallback + redirect-scope) + `bash-command.ts` (zero-units raw-match edge) + `config-schema.ts` (markdownDescription + schema regen); Tasks updated. B′ = (1) backward-compat fallback — `bash_path` resolves first, falls back to `path` on no explicit match (extends the `#58` guard); (2) scope `bash_path` to `file_redirect` (write) tokens — reads resolve against `path`; (3) command-form writes via `bash` content patterns (raw-command match). Patch findings folded into Tasks: `config-schema.ts` markdownDescription + schema regen; zero-units raw-command edge in `bash-command.ts`; `PATH_SURFACES` membership test + `path`-only-unchanged boundary regression test; README/docs corrections (backward-compat claims, `bash_path` gates writes, raw-match cross-chain semantics, opt-in migration how-to); `config.example.json` mirrors sensitive-file denies into `bash_path` (or relies on the fallback).
- **Known-bad state avoided:** a permissions package silently dropping existing `path`-only sensitive-file protection on upgrade; a shipped example config weaker than its predecessor; a `path`-only deny regressing `cat .env` from deny to ask.
- **KEEP (must survive re-derivation):** the raw-command match in `bash-command.ts` (Feature 2 — catches heredoc bodies + command-form writes via `bash` content patterns); the `"bash_path"` membership in `PATH_SURFACES` (win32 fold + last-match-wins-across-aliases); the `reasonSuffix` deny-with-reason surfacing for `bash_path` in `denial-messages.ts`; the split itself (bash_path resolves against `bash_path`, decoupling from `path` so `edit`/`write` aren't collateral damage).

## Design Notes

**Why fork-local, not upstream-first.** The fork has "diverged substantially from upstream in config format, internal architecture, and permission model" (`README.md:12`) and is at v24.0.0. Eval the design in-fork first; upstream to MasuRii only if it proves out and MasuRii wants it — and given the divergence, MasuRii may not take a PR against their different model. The divergence cost is real but already paid.

**Why no new abstraction (the anti-slop line).** Both features reuse the existing pattern→wildcard→`deny` mechanism. Feature 1 = the `bash_path` gate already reads redirect targets (`bash-path.ts:40-42`); it just resolves them against the wrong surface (`"path"` → `"bash_path"`), plus `PATH_SURFACES` membership for fold/last-match-wins. Feature 2 = the full raw command is already the first argument to `resolveBashCommandCheck` (`bash-command.ts:53`); pass it to `resolver.resolve` on the existing `bash` surface and fold into `pickMostRestrictive`. No `BashContentInspector` class, no regex registry, no new flavor enum — that's the slop to avoid. The generality (the user's "this isn't the last workaround" concern) comes from the **pattern mechanism**: every future string-based workaround (`tee`, `printf > file`, `dd of=…`) is catchable by a config pattern, no per-workaround code.

**Wrapper-floor composition (no special-casing).** The bash-command gate floors shell-wrapper units (`bash -c …`) to `ask` even when the inner command is `allow` (`bash-command.ts:85-92`, `WRAPPER_SENTINEL`). Folding the raw-command `resolve` into `results` before `pickMostRestrictive` (deny > ask > allow, first-wins) composes correctly with no special-casing: a raw `deny` wins over a wrapper `ask` (deny is the hard wall — correct); a wrapper `ask` wins over a raw `allow` (the floor intent preserved). The raw check does not need to "inherit" the wrapper floor — `pickMostRestrictive` does the right thing.

**Backward compatibility (B′ — corrected).** The shipped split was **not** additive: a `path`-only config (e.g. `path: {"*.env": "deny"}`) silently lost bash-side protection (bash tokens routed to an inert `bash_path`). B′ fixes this with a **backward-compat fallback**: the `bash_path` gate resolves `bash_path` first, and on no explicit match **falls back to `path`** — so `path`-only configs keep bash read+write protection (no silent regression, true `feat` minor, no migration for protection). B′ also **scopes `bash_path` to `file_redirect` (write) tokens** — bare-filename (read) tokens resolve against `path` — so `bash_path: {"*.go": "deny"}` blocks `echo > main.go` (write) but NOT `cat main.go` (read), matching the surface's name. Command-form writes (`tee main.go`, `dd of=main.go`, python heredoc) are caught by `bash` content patterns via the raw-command match. **Opt-in decoupling** (honest how-to, not a migration warning): to use the new bash-only steering, remove the corresponding `path` deny and add a `bash_path` deny. The raw-command match only makes existing `bash` `deny` rules more restrictive (they now also match heredoc bodies) — additive. Ship as a `feat` (minor); release-please manages the version.

**`APPEND_SYSTEM.md` delivery.** A documented global drop-in example in the README (`~/.pi/agent/APPEND_SYSTEM.md`): "To modify file contents, use `edit`/`write`, not `python3`/`sed`/`awk` in `bash` (those are blocked). For content search, use the `grep` tool, not `bash grep`." This is the prevention layer; the `deny` rules are the hard stop. The two close the loop from both sides.

**Config changes (drop-in — the actual deliverable).** The user already has both global files (`yoloMode: true` is set), so these are edits, not new files. The `bash` deny patterns below target the **heredoc-body content** (e.g. `python3 *open(*`) — not `python3 - *`, which the investigation proved does NOT match `python3 - <<'PY'` (the `-` is dropped; the matcher sees bare `python3`). The heredoc is caught by the **raw-command match** (Feature 2): the existing `bash` patterns now match the full `event.input.command`, so `python3 *open(*` fires on `python3 - <<'PY'\nopen()\nPY`.

`~/.pi/agent/extensions/pi-permission-system/config.json` — add a `permission` block (the existing file has only runtime knobs):
```json
{
  "debugLog": false,
  "permissionReviewLog": true,
  "yoloMode": true,
  "permission": {
    "*": "allow",
    "bash": {
      "*": "allow",
      "python3 *open(*": { "action": "deny", "reason": "File IO via python (stdin/heredoc/-c) is blocked. Use the edit/read/write tools." },
      "python3 *.write(*": { "action": "deny", "reason": "Writing files via python is blocked. Use the write tool." },
      "python3 *re.sub*": { "action": "deny", "reason": "Replacements via python are blocked. Use the edit tool." },
      "python3 *Path(*": { "action": "deny", "reason": "File ops via python pathlib are blocked. Use read/write/edit." },
      "sed -i *": { "action": "deny", "reason": "In-place sed edits are blocked. Use the edit tool." },
      "sed * -i*": { "action": "deny", "reason": "In-place sed edits are blocked. Use the edit tool." }
    },
    "bash_path": {
      "*": "allow",
      "*.go": { "action": "deny", "reason": "Redirecting bash output to a .go source file is blocked. Use the edit or write tool." },
      "*.ts": { "action": "deny", "reason": "Redirecting bash output to a .ts source file is blocked. Use the edit or write tool." },
      "*.js": { "action": "deny", "reason": "Redirecting bash output to a .js source file is blocked. Use the edit or write tool." },
      "*.md": { "action": "deny", "reason": "Redirecting bash output to a .md file is blocked. Use the edit or write tool." },
      "*.json": { "action": "deny", "reason": "Redirecting bash output to a .json file is blocked. Use the edit or write tool." }
    }
  }
}
```
`~/.pi/agent/APPEND_SYSTEM.md` — append a section after the existing Skills block:
```markdown
# File operations

To modify file contents, use `edit` (fuzzy + shape-recovered) or `write` (full rewrite). Do not edit files via `python3`/`sed`/`awk` inside `bash` — those calls are blocked. For repeated changes to the same file, prefer `edit` over re-`write`ing. For content search, use the built-in `grep` tool, not `bash grep`.
```
The `bash_path` denies block bash-redirect-to-source without blocking `edit`/`write` (distinct surfaces). The `bash` denies + raw-command match close the heredoc escape hatch. `yoloMode: true` keeps everything autonomous; the `deny` rules are the only hard walls. Tune the `bash_path` extensions and the `bash` content patterns per project.

## Verification

**Commands:**

- `pnpm --filter @gotgenes/pi-permission-system run check` -- expected: tsc clean.
- `pnpm --filter @gotgenes/pi-permission-system run test` -- expected: all tests pass (incl. new `bash_path` + raw-command suites).
- `pnpm --filter @gotgenes/pi-permission-system run lint` -- expected: biome + rumdl clean.

**Manual checks:**

- `pi -e packages/pi-permission-system` with a `permission.bash_path["*.go"] = deny` config: a `sed … > main.go` call is denied; an `edit` to `main.go` is allowed.
- With `permission.bash["python3 *open(*"] = deny`: a `python3 - <<'PY'\nopen()\nPY` call is denied (heredoc body caught); confirm the deny reason surfaces.
- With `yoloMode: true` and only `deny` rules: unmatched bash runs without prompts.

## Suggested Review Order

**B′ gate logic (the headline)**

- Lead stop — `describeBashPathGate`/`resolveBashPathToken`: writes resolve **both** `bash_path` and `path` → `pickMostRestrictive`; reads resolve `path` only. `bash_path` can only add restrictions.
  [`bash-path.ts:58`](../../packages/pi-permission-system/src/handlers/gates/bash-path.ts#L58)

- `collectRedirectTokens` tags `<` input redirects as reads (`argument`), `>`/`>>` as writes (`redirect`) — so `cat < .env` routes to `path`.
  [`token-collection.ts:96`](../../packages/pi-permission-system/src/access-intent/bash/token-collection.ts#L96)

**Raw-command match**

- `resolveBashCommandCheck` — the full raw `event.input.command` (heredoc body) on the `bash` surface, folded into `pickMostRestrictive`; the zero-units path surfaces a real matched `deny`/`ask`'s pattern.
  [`bash-command.ts:56`](../../packages/pi-permission-system/src/handlers/gates/bash-command.ts#L56)

**Surface & denial plumbing**

- `PATH_SURFACES` — `bash_path` membership drives win32 fold + `evaluateAnyValue` (last-match-wins-across-aliases).
  [`path-surfaces.ts:29`](../../packages/pi-permission-system/src/access-intent/path-surfaces.ts#L29)

- `reasonSuffix` — `bash_path` `deny`-with-reason surfaces the reason to the agent.
  [`denial-messages.ts:100`](../../packages/pi-permission-system/src/denial-messages.ts#L100)

- `permissionSchema` markdownDescription — `path` no longer gates bash; enumerates `bash_path`; regenerates the schema.
  [`config-schema.ts`](../../packages/pi-permission-system/src/config-schema.ts)

**Peripherals**

- Composition-root integration — the headline B′ contract: `echo > .env` denied under `path` deny + `bash_path: { "*": "allow" }` (catch-all doesn't bypass).
  [`composition-root.test.ts:804`](../../packages/pi-permission-system/test/composition-root.test.ts#L804)

- `config.example.json` — mirrors `*.env` into `bash_path`; verifies `echo secret > .env` is denied.
  [`config.example.json`](../../packages/pi-permission-system/config/config.example.json)

- `README.md` + `docs/configuration.md` — `bash_path` (most-restrictive with `path`), raw-command cross-chain semantics, the opt-in migration how-to, the global `APPEND_SYSTEM.md` drop-in.
  [`README.md`](../../packages/pi-permission-system/README.md)