---
title: 'technical research: Mario Zechner (badlogic) thin-core/anti-slop stance — inclusion criteria for pi core vs extensions'
type: 'technical'
topic: "Mario Zechner (badlogic) thin-core/anti-slop stance: inclusion criteria for pi core vs extensions"
decision: 'Which of an extension author edit/read/write features (fuzzy-tolerant edit override, cat-n line numbering for read, write rewrite-loop guard, per-edit replaceAll, edit shape-recovery, similar-lines edit errors) would be welcomed as a core contribution vs rejected as extension-bloat'
source: 'primary: earendil-works/pi repo (CONTRIBUTING.md, docs, core tool source) + mariozechner.at blog'
status: complete
preset: 'straightforward (inline, no fan-out)'
validation: normal
created: '2026-08-08'
updated: '2026-08-08'
claims: {verified: 14, unverified: 1, overturned: 0}
---

# technical research: Mario Zechner (badlogic) thin-core/anti-slop stance — inclusion criteria for pi core vs extensions

**Decision this research serves:** an extension author must judge, for six specific edit/read/write features, whether to propose them as core contributions or keep them in the extension. This report distills the maintainer's stated inclusion criteria from primary sources and applies them feature-by-feature.

## Executive summary

Mario Zechner ("badlogic") runs pi as a **dictatorial, opinionated, minimal-core project**. His governing philosophy is stated verbatim: *"if I don't need it, it won't be built. And I don't need a lot of things"* [1]. The project's CONTRIBUTING.md makes the consequence explicit: *"pi's core is minimal. If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected."* [2] The bar to even get a core PR reviewed is deliberately high — new-contributor PRs are auto-closed and require a prior `lgtm` [2][3].

Three things drive the verdict for the author's six features:

1. **Two are already in core** — fuzzy-tolerant edit [4] and edit shape-recovery [5] are implemented in `packages/coding-agent/src/core/tools/edit-diff.ts` and `edit.ts`. Proposing them again is duplicate/bloat and will be rejected; the only welcome core contribution in their neighborhood is a *fix that improves existing core behavior* (e.g., extending `normalizeForFuzzyMatch` to a new normalization dimension), in the mold of the merged "preserve untouched content in fuzzy edit matches" work.
2. **One contradicts a deliberate core invariant** — per-edit replaceAll is explicitly rejected: core throws a duplicate-occurrence error and demands uniqueness [6]. A core PR adding replaceAll fights a design decision and will be rejected; it is extension-only.
3. **Three are extension-bloat by the maintainer's own criteria** — cat-n line numbering for read [7], write rewrite-loop guard [8], and (most likely) similar-lines edit errors [9] each fail a documented criterion: token-cost/progressive-disclosure [10], the YOLO/no-safety-rails stance [11], and the "if I don't need it" minimalism bar [1] respectively. The extension model is the sanctioned home for all of them — built-in tools are overridable, `--no-builtin-tools` exists, and the `tool_call` event gate lets an extension add guards without touching core [12].

The biggest caveat: the maintainer has not published a positive "core-worthiness checklist." The positive criterion is inferred from what he *put* in core (universal file/shell primitives with near-zero per-call context overhead) and from his "does not and will not" list [13]. He also states he is dictatorial and explicitly invites forks: *"If pi doesn't fit your needs, I implore you to fork it. I truly mean it."* [14]

## Dimension 1 — The maintainer's philosophy (primary: his blog)

Zechner's November 2025 post is titled *"What I learned building an opinionated and minimal coding agent"* and states the governing rule verbatim: *"My philosophy in all of this was: if I don't need it, it won't be built. And I don't need a lot of things."* [1] He frames the project as a reaction to Claude Code having "turned into a spaceship with 80% of functionality I have no use for," with system-prompt/tool churn that "breaks my workflows" [15]. pi-tui's constrained design reflects the same value: *"constraints make for minimal programs that just do what they're supposed to do without superfluous fluff."* [16]

The post converts philosophy into a concrete **"does not and will not" core-exclusion list**, each item paired with a file/CLI/tmux alternative so users lose nothing [13]:

- Built-in to-dos -> write `TODO.md`.
- Plan mode -> write `PLAN.md`.
- MCP support -> CLI tools with READMEs (progressive disclosure).
- Background bash -> use tmux.
- Sub-agent tool -> spawn pi via bash.

Three rejection criteria fall out of the reasoning for that list:

- **Token-cost / progressive disclosure** [10]: MCP servers "dump their entire tool descriptions into your context on every session. That's 7-9% of your context window gone before you even start working." Features that impose per-session context overhead are rejected in favor of paying the cost only when used.
- **Observability** [17]: sub-agents and background bash are "a black box within a black box"; pi favors observable composable primitives (bash, tmux, files). *"I need observability."*
- **Externalize state** [18]: to-dos/plan mode "add state that the model has to track... introduces more opportunities for things to go wrong." Prefer files the agent reads/updates.

Finally he is explicit about governance: *"I welcome contributions. But as with all my open source projects, I tend to be dictatorial... I just want to keep this focused and maintainable. If pi doesn't fit your needs, I implore you to fork it. I truly mean it."* [14] And on safety: pi is *"YOLO by default"* with *"no permission prompts... no safety rails,"* calling other agents' measures "mostly security theater" [11] — so safety/guardrail features are not core-worthy by default.

## Dimension 2 — Project policy and the extension model (primary: repo docs)

CONTRIBUTING.md carries an explicit **Philosophy** section: *"pi's core is minimal. If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected."* [2] The same file's "One Rule" — *"You must understand your code... Submitting AI-generated slop without understanding it is not"* [19] — is the anti-slop stance applied to all contributions, core especially.

The contribution gate is real and enforced: new-contributor issues and PRs are auto-closed by a github-actions bot; a maintainer `lgtm` is required before a PR is even considered [3]. Empirical confirmation from this run: PR #5898 ("preserve untouched content in fuzzy edit matches") and issue #7800 ("Extensions cannot decorate already-registered tools") were both auto-closed with no maintainer reply [3]. The first interaction a core PR gets is a robot telling you to open an issue first.

The **extension model is the documented escape hatch** for everything not in core [12]: extensions can override built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) by registering the same name; `--no-builtin-tools` starts with zero built-ins; extensions can register custom tools, commands, providers, renderers, and UI. The docs open with *"pi can create extensions. Ask it to build one for your use case."* Built-in tools even expose pluggable `Operations` interfaces (`ReadOperations`, `EditOperations`, ...) so an extension can redirect a tool's internals (SSH, containers) without forking core [20] — the sanctioned pattern for changing tool *behavior* without touching core.

The **core is provider-agnostic by design** [21]: `pi-ai` is a unified multi-provider LLM API (~20 built-in providers); provider-specific OAuth flows or non-standard APIs are extension territory (*"For providers that need custom API implementations or OAuth flows, create an extension"*). Core abstracts; specific lives in extensions. The same layering puts UI outside core: agent-harness.md's migration plan says *"Preserve UI/session behavior outside core."* [22]

## Dimension 3 — What is actually in core (primary: the tool source)

The decisive evidence for the author's decision is the core tool source in `packages/coding-agent/src/core/tools/`. The core tool set is exactly `read`, `write`, `edit`, `bash` plus optional `grep`, `find`, `ls`, with support modules (`edit-diff`, `file-mutation-queue`, `truncate`, `path-utils`, `render-utils`, `tool-definition-wrapper`) [23] — matching the blog's "minimal toolset" / "<1000 tokens" claim. Reading the three tools the author's features touch:

- **`edit.ts` + `edit-diff.ts`**: exact-match replacement with `fuzzyFindText()`/`normalizeForFuzzyMatch()` fallback (trailing whitespace, smart quotes, Unicode dashes/spaces, NFKC) [4]; `prepareArguments()` recovers legacy `oldText`/`newText` into `edits[]` and parses JSON-string edits some models emit [5]; `applyReplacementsPreservingUnchangedLines()` overlays fuzzy matches onto original bytes so untouched lines survive; `countOccurrences() > 1` throws a duplicate error demanding uniqueness [6]; the not-found error is generic (*"must match exactly including all whitespace and newlines"*) with **no** similar-line suggestions [9].
- **`read.ts`**: returns raw file content with `offset`/`limit` paging and truncation notices (*"Showing lines A-B of N. Use offset=B+1 to continue."*). **No** line-number prefixes in the content sent to the LLM — line numbers appear only in the *edit diff* display, not in read output [7].
- **`write.ts`**: `mkdir` + `writeFile` + `withFileMutationQueue`; **no** convergence/identical-content/loop detection [8].

The positive core criterion is visible here: a feature is core-worthy only if it is a **universal file/shell primitive every agent program needs, with minimal per-call context overhead**, and it either fills a gap in an existing core tool's correctness or is one of the tiny set of base tools. Everything else is extension territory.

## Cross-dimension insights

The combination of the three dimensions yields the decision rule the author needs:

- **Already-in-core features are not contribution opportunities** — they are *redundancy*. The maintainer's anti-bloat rule [2] and anti-slop rule [19] mean a PR that re-adds fuzzy matching or shape-recovery is rejected on sight. The *only* welcome core contribution near an already-in-core feature is a **fix to that feature's existing behavior** (the fuzzy-edit "preserve untouched content" fix is the template — it corrected silent data loss in a core feature rather than adding a new one).
- **A feature that contradicts a documented core invariant is dead on arrival.** replaceAll contradicts the uniqueness invariant [6]; no amount of "but it would be convenient" overcomes an intentional design decision under a dictatorial maintainer [14].
- **The token-cost criterion [10] is the cleanest separator for the remaining three.** cat-n line numbering adds per-call overhead to *every* read (fails it). A write-loop guard adds no per-call overhead but is a safety rail (fails the YOLO stance [11]). Similar-lines errors add overhead only on failure (passes token-cost) and improve an existing core tool's error UX, making it the one genuinely borderline case — but it still loses to the "if I don't need it" bar [1] and the generic-error-was-kept-deliberately signal in the source [9].
- **The extension model is not a consolation prize; it is the intended architecture.** The docs frame extensions first ("Ask it to build one for your use case") [12], built-in tools are overridable, and the `Operations` interfaces let an extension change tool behavior without forking. An extension that ships a read override with cat-n, a write override with a loop guard, or a richer edit error is *exactly* how pi is designed to be extended.

## Contrary evidence

A skeptic could argue the maintainer is *so* minimal that even bug fixes to core are unwelcome — and the contribution gate supports a weak version of this: PR #5898 (a genuine fuzzy-edit data-loss fix) was auto-closed because the contributor lacked `lgtm` [3]. But this is process friction, not philosophy: the fix it describes (preserving untouched content in fuzzy matches) *is* implemented in the current `edit-diff.ts` (`applyReplacementsPreservingUnchangedLines`) [4], so the behavior made it into core by some path. The contrary reading is therefore: the maintainer will accept core improvements that fix real correctness problems in existing core features — but only through the gate (issue first, earn `lgtm`), and only if he personally needs them. No evidence surfaced of core features accepted that the maintainer did not personally use.

## Recommendations (bound to the author's six features)

| Feature | Core-worthy? | Rationale + criterion | Recommended path |
|---|---|---|---|
| Fuzzy-tolerant edit override | No — **already in core** [4] | `fuzzyFindText`/`normalizeForFuzzyMatch` already in `edit-diff.ts`. A standalone override is bloat [2]. | Keep the extension only if it adds a normalization dimension core lacks; otherwise drop it. If it adds a dimension (e.g., indentation), propose it as a *fix to `normalizeForFuzzyMatch`* via the issue-first gate, framed as correcting a real failure mode. |
| Edit shape-recovery | No — **already in core** [5] | `prepareArguments()` already recovers legacy `oldText`/`newText` -> `edits[]` and JSON-string edits. | Do not contribute. Keep only if the extension's recovery covers a stored-arg shape core's `prepareArguments` does not. |
| per-edit replaceAll | **Rejected** as core [6] | Contradicts the uniqueness invariant (`countOccurrences > 1` throws). Intentional design decision. | Extension-only: a custom `edit_all` tool or an `edit` override with a `replaceAll` flag. Do not PR to core. |
| cat-n line numbering for read | **Rejected** as core [7][10] | Adds per-call context overhead to every read (token-cost criterion); presentation preference, not a universal primitive. | Extension-only: a `read` override (documented mechanism, see `tool-override.ts` example). |
| write rewrite-loop guard | **Rejected** as core [8][11] | A safety rail; core is YOLO by default and calls safety "security theater." Not universal. | Extension-only: a `write` override or a `tool_call` event gate (`on("tool_call")`) that detects repeated identical writes. |
| similar-lines edit errors | **Likely rejected** as core (borderline) [9][1] | Passes token-cost (fires only on error) and improves an existing core tool's error UX, but the generic error was kept deliberately and the bar is "if I don't need it." Confidence: medium. | Extension-only: an `edit` override that enriches not-found errors with similar-line suggestions. If proposed to core, frame as a small error-UX improvement to an existing tool, open an issue first, and expect a dictatorial no. |

Confidence basis: the "already in core" and "deliberately rejected" rows rest on high-confidence primary source (the code and the duplicate-error throw). The "likely rejected" row is medium-confidence — it is a judgment call applying inferred criteria to a gap the maintainer has not publicly addressed.

## Open questions

1. **Has the maintainer ever accepted a core feature he did not personally use?** No public evidence either way in the sources retrieved. A `gh` sweep of merged PRs by author over the last ~50 releases would answer it. Route: `gh pr list --repo earendil-works/pi --state merged --limit 100 --json author,number,title` plus commit-log authorship.
2. **Is there a public statement on edit-error UX specifically?** The not-found error is generic in source; no issue/PR discussing similar-line suggestions was found in the tracker (searches for "edit similar", "edit fuzzy" returned only PR #5898). Opening a short issue (after earning `lgtmi`) to ask whether richer edit errors are welcome would get a definitive answer — but expect the generic error to be intentional.
3. **Mario's "Armin is wrong" post (2025-11-22)** likely illuminates his design-philosophy disagreements with Armin Ronacher (mitsuhiko, a co-maintainer) and may sharpen the "build your own vs. depend on a shared SDK" criterion. Not retrieved this run; low priority for this decision.

## Source appendix

| # | Claim(s) it supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | C1 governing philosophy | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) (M. Zechner blog) | 2025-11-30 | 2026-08-08 | high |
| [2] | C12 core-minimal policy, C13 anti-slop, C14 contribution gate | [earendil-works/pi CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md) | 2026-08 (living doc) | 2026-08-08 | high |
| [3] | C14 gate enforcement (PR#5898, issue#7800 auto-closed) | [earendil-works/pi PR #5898](https://github.com/earendil-works/pi/pull/5898), [issue #7800](https://github.com/earendil-works/pi/issues/7800) | 2026-08 | 2026-08-08 | high |
| [4] | C19 fuzzy edit in core | [earendil-works/pi edit-diff.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit-diff.ts) | 2026-08 (living) | 2026-08-08 | high |
| [5] | C20 shape-recovery in core | [earendil-works/pi edit.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit.ts) | 2026-08 (living) | 2026-08-08 | high |
| [6] | C21 replaceAll rejected (uniqueness invariant) | [earendil-works/pi edit-diff.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit-diff.ts) (`countOccurrences`, `getDuplicateError`) | 2026-08 (living) | 2026-08-08 | high |
| [7] | C23 cat-n not in core | [earendil-works/pi read.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts) | 2026-08 (living) | 2026-08-08 | high |
| [8] | C24 write-loop guard not in core | [earendil-works/pi write.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/write.ts) | 2026-08 (living) | 2026-08-08 | high |
| [9] | C22 similar-lines errors not in core | [earendil-works/pi edit-diff.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit-diff.ts) (`getNotFoundError`) | 2026-08 (living) | 2026-08-08 | high |
| [10] | C5 token-cost / progressive-disclosure criterion | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) ("No MCP support") | 2025-11-30 | 2026-08-08 | high |
| [11] | C11 YOLO / no safety rails | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) ("YOLO by default") | 2025-11-30 | 2026-08-08 | high |
| [12] | C15 extension model (override, --no-builtin-tools) | [earendil-works/pi extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) | 2026-08 (living) | 2026-08-08 | high |
| [13] | C4 core-exclusion list + alternatives | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) (No built-in to-dos / No plan mode / No MCP / No background bash / No sub-agents) | 2025-11-30 | 2026-08-08 | high |
| [14] | C8 dictatorial / fork-friendly | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) ("In summary") | 2025-11-30 | 2026-08-08 | high |
| [15] | C9 anti-spaceship / anti-churn | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) (intro) | 2025-11-30 | 2026-08-08 | high |
| [16] | C10 constraints = minimal programs | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) (pi-tui) | 2025-11-30 | 2026-08-08 | high |
| [17] | C6 observability criterion | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) (No sub-agents, No background bash) | 2025-11-30 | 2026-08-08 | high |
| [18] | C7 externalize-state criterion | [mariozechner.at](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) (No built-in to-dos, No plan mode) | 2025-11-30 | 2026-08-08 | high |
| [19] | C13 anti-slop ("The One Rule") | [earendil-works/pi CONTRIBUTING.md](https://github.com/earendil-works/pi/blob/main/CONTRIBUTING.md) | 2026-08 (living) | 2026-08-08 | high |
| [20] | C18 pluggable Operations interfaces | [earendil-works/pi extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) ("Remote Execution") | 2026-08 (living) | 2026-08-08 | high |
| [21] | C16 provider-agnostic core | [earendil-works/pi providers.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), [custom-provider.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md) | 2026-08 (living) | 2026-08-08 | high |
| [22] | C17 UI outside core | [earendil-works/pi agent-harness.md](https://github.com/earendil-works/pi/blob/main/packages/agent/docs/agent-harness.md) (migration plan item 7) | 2026-08 (living) | 2026-08-08 | high |
| [23] | C25 core tool set | [earendil-works/pi tools/index.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/index.ts) | 2026-08 (living) | 2026-08-08 | high |

## Staleness map

This is a philosophy/architecture report, not a versioned-API report, so most claims age slowly. The fastest-aging classes and their re-check windows:

| Claim class | Freshness window | Earliest re-check | Notes |
|---|---|---|---|
| Core tool source behavior (C19-C24) | 3 mo (AI-adjacent code churns) | 2026-11-08 | Re-verify against the then-current `edit-diff.ts`/`read.ts`/`write.ts` before acting on the feature verdicts. |
| CONTRIBUTING.md / policy (C12-C14) | 6 mo | 2027-02-08 | Policy is living; the Philosophy section could tighten. |
| Maintainer blog philosophy (C1, C4-C11) | 12 mo | 2027-08-08 | Statement of intent; stable unless he posts a follow-up. |
| Provider list / provider-agnostic stance (C16) | 6 mo | 2027-02-08 | New providers land often; the *agnostic-vs-specific* split is stable. |

Earliest re-check: **2026-11-08** (core tool source). A Refresh run before acting on the feature verdicts should re-pull `edit-diff.ts`, `read.ts`, and `write.ts` from `earendil-works/pi` main and diff against the versions cited here.

---

_Methodological note: this run used inline sequential retrieval (no subagent fan-out — not available in this harness) with `gh` (GitHub primary sources) and `curl` (public web) as search surfaces. Claim counts (14 verified / 1 unverified / 0 overturned) are hand-derived from the memlog ledger because the referenced `scripts/recon_kit.py tally` script is not installed in this project's `_bmad/scripts/`. The 1 unverified claim (C22, similar-lines core-worthiness) is a judgment call on a gap the maintainer has not publicly addressed, not a factual dispute._