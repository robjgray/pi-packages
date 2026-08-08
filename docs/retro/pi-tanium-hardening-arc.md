---
issue_title: "pi-tanium hardening arc — pi-preface situational, pi-tanium Prong A, pi-permission-system Prong B"
---

# Retro: pi-tanium hardening arc — pi-preface situational, pi-tanium Prong A, pi-permission-system Prong B

## Stage: Final Retrospective (2026-08-08T09:01:18Z)

### Session summary

A single `/bmad-build` session on `_bmad-output/external/pi-tanium-spec.md` shipped three features across three packages: pi-preface situational `skill_launched` activation (103 tests), pi-tanium Prong A edit/read/write hardening (97 tests), and pi-permission-system Prong B bash file-mutation residual gates (2709 tests). Two `/bmad-party-mode` debates (Dev + Architect + Adversary) and a `/bmad-deep-recon` on the pi maintainer's thin-core stance produced the B′ design (most-restrictive `bash_path` + redirect-scope + raw-command match) — a better-factored solution than the spec's original `bash-gate.ts`-in-pi-tanium placement. A `bad_spec` loopback + a critical patch round caught a breaking-change mislabel and a catch-all-defeats-fallback bug.

### Observations

#### What went well

- **`/bmad-party-mode` + `/bmad-deep-recon` for cross-cutting design decisions.** The first party-mode debate (Prong A) pressure-tested the spec's factoring + pi-core alignment and produced the core-worthiness section (2 upstream bug-fix candidates via the `lgtm` gate; `replaceAll`/`cat -n`/write-guard/similar-lines extension-only). The second (Prong B) debated A (breaking + migration) vs B (backward-compat fallback) vs Other — and landed B′ (most-restrictive + redirect-scope), which neither the spec nor the first implementation had. The deep-recon grounded the maintainer's thin-core/anti-slop stance, confirming Prong B belongs in `pi-permission-system` not `pi-tanium`. This combo is a novel win — it surfaced a design refinement no single pass reached.

- **The review → loopback → re-review cycle earned its keep.** Step-04's three reviewers (blind-hunter + edge-case-hunter + verification-gap) caught: the `path`→`bash_path` split is breaking (not "additive" as the spec claimed) → `bad_spec` loopback; then the B′ re-review caught the catch-all-allow-defeats-the-fallback bug + the `<` input-redirect-misclassified-as-write bug + the zero-units raw-match sentinel drop. Two real bugs, both caught by review before ship.

- **Verify-against-installed-dist caught a spec premise error.** When the user asked "are we sure pi-core has a fuzzy fallback?", verifying against the installed `0.79.1` + `0.80.5` dists (not just the sibling `../../pi/` main) proved `normalizeForFuzzyMatch`/`fuzzyFindText` have been in core since 0.79.1 (June) — correcting the spec's §1 premise ("edit does pure exact-match"). The installed-dist check (per AGENTS.md's "confirm any API you design around exists in the installed version") caught a behavior claim the sibling-only check would have missed.

#### What caused friction (agent side)

- `missing-context` — Two spec behavior claims were propagated without verifying against the installed dist during step-02 planning: (1) the pi-tanium spec's §1 "edit does pure exact-match, fails 51%" (pi-core already has a fuzzy fallback since 0.79.1); (2) the spec's §B2 "`python3 - *` matches `python3 - <<'PY'`" (tree-sitter-bash drops the `-`; the matcher sees bare `python3`). The second propagated into the `deferred-work.md` Prong B entry I wrote.
  Impact: the user's "config-only" Prong B hypothesis was partly based on the wrong §B2 claim; the pi-tanium spec's Problem statement had to be corrected mid-session (after the user asked); the deferred-work entry was inaccurate until the Prong B investigation verified the tree-sitter decomposition.

- `wrong-abstraction` — The external spec placed `bash-gate.ts` in pi-tanium. Step-02 planning didn't check this against AGENTS.md §8's package-boundary table (bash allow/ask/deny is `pi-permission-system`'s domain). The user's "is bash-gate a permissions problem?" redirect triggered the party-mode debate that moved it to `pi-permission-system`.
  Impact: a full party-mode debate was needed to correct a package placement the spec got wrong — an earlier §8 check during planning would have caught it.

- `rabbit-hole` — The Prong B `bad_spec` loopback: the spec's Design Notes claimed "additive / backward-compatible / `feat` (minor)" but the `path`→`bash_path` split is breaking for `path`-only configs. The first implementation + the shipped `config.example.json` + README all carried the wrong premise. Then the B′ re-derivation's fallback condition (`matchedPattern !== undefined`) was wrong — a `bash_path: { "*": "allow" }` catch-all defeated it, re-introducing the exact silent regression B′ was meant to fix.
  Impact: a full `bad_spec` loopback (amend spec + re-derive) + a second patch round (most-restrictive fix + `<` redirect tagging + zero-units surfacing). Two review rounds of rework on the same feature.

- `instruction-violation` (self-identified) — Several malformed JSON `edit` calls (unquoted values, missing capture groups) and a duplicate `bash-path.ts` task (the amendment inserted a new task without removing the old one). All caught + fixed mid-session.
  Impact: added friction (retries) but no rework.

#### What caused friction (user side)

- The user's redirects were strategic, not mechanical — "is bash-gate a permissions problem?", "are we sure pi-core has a fuzzy fallback?", "what about python — does it only do `python3`?" each caught a real gap (package placement, spec premise, config coverage). These were the right questions at the right time; the session would have shipped worse artifacts without them.
- The user could have shared the MasuRii/upstream context earlier (they didn't recognize "MasuRii" when I dropped it from the spec's lineage note without explaining) — minor; I should have explained the fork lineage when first citing it.

### Diagnostic details

- **Model-performance correlation** — The `Explore` subagents (pi-core export surface, pi-permission-system extension points) ran on the default and succeeded on multi-hop traces (config schema → tree-sitter → gate pipeline). The `/bmad-deep-recon` ran as a `general-purpose` subagent and produced a cited, decision-grade report. The `/bmad-party-mode` ran inline (session mode). No quality mismatches flagged.
- **Escalation-delay tracking** — The `bad_spec` loopback was 2 review rounds (not a single rabbit-hole); no >5-consecutive-tool-call sequences on one error. The malformed-JSON edits were 1-2 retries each.
- **Unused-tool detection** — `Explore` subagents were dispatched for the investigations (appropriate). `colgrep` could have been used for some convention discovery but `grep` sufficed. No unused-tool gaps.
- **Feedback-loop gap analysis** — `pnpm run check/test/lint/fallow` ran after each implementation + after patches (incremental — good). However, the B′ fallback contract was NOT caught by the test suite: the gate-level tests stubbed the resolver (`matchedPattern: undefined`), so they couldn't observe that a real `bash_path: { "*": "allow" }` catch-all sets `matchedPattern: "*"` and defeats the fallback. The `verification-gap` reviewer flagged it; the patch added a composition-root integration test (real resolver, real config). Lesson: backward-compat contracts need integration tests (real resolver/config), not just gate-level stubbed tests — a stubbed resolver can validate the gate's routing while missing the resolver's actual output shape.

### Changes made

1. No `AGENTS.md` or prompt changes — both retro proposals declined by the user (extend the installed-dist rule to behavior claims; promote `/bmad-party-mode` + `/bmad-deep-recon` for design decisions). Recorded as a User Note for future reference.

## Stage: User Note (2026-08-08T09:08:11Z)

Declined both retro proposals — (1) extending AGENTS.md's installed-dist rule (line 66) to cover behavior claims, not just API existence; (2) a new AGENTS.md subsection promoting `/bmad-party-mode` + `/bmad-deep-recon` for cross-cutting design decisions. Prefer to keep `AGENTS.md` lean for now; the friction both proposals address (spec behavior claims propagated without verification against the installed dist; package-boundary checks deferred to review) is recorded in the Final Retrospective observations above. Revisit if the patterns recur — two more sessions with the same `missing-context` / `wrong-abstraction` friction would justify the additions.