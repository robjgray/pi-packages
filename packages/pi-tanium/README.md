# pi-tanium

Hardens the file operations a small-model pi agent depends on.
It overrides the built-in `read`/`write`/`edit` tools, composing the built-in definitions (parameters, renderers, prompt snippet flow through) and layering only the recoveries and the edit apply it must own.

## Why

Small local models running as pi agents fail at `edit` roughly half the time and fall back to `write` rewrite-loops (one observed session wrote `main.go` 22 times), bloating context.
The failures split into a **shape** gap (a stringified single-object `edits` the built-in discards) and a **match** gap (whitespace runs and leading whitespace that pi-core's `normalizeForFuzzyMatch` does not collapse). pi-tanium closes both, plus a per-edit `replaceAll`, `cat -n` line-numbered `read`, and a soft `write` rewrite-loop guard.

It also keeps the path "Did you mean?"
recovery from its predecessor `pi-path-recovery` (renamed here) for `read`/`write`/`edit`.

## What it does

- **edit** — recovers a stringified single-object `edits` and an unparseable `edits` (with a canonical-form error), matches `oldText` through a staged fuzzy matcher (exact, whitespace-run normalization, a gated multi-pass chain, then a similar-lines not-found error), and supports a per-edit `replaceAll`.
- **read** — coerces `offset`/`limit` and prefixes each returned line with its `cat -n` number, so edit's not-found line refs map 1:1 to what `read` returns.
- **write** — applies the write, and on the 2nd-or-later write of a large existing file in a session, appends a notice pointing at `edit`.
- **all three** — keep the path "Did you mean?"
  guard and teach the model the new contract by extending (not freezing) each tool's `promptGuidelines`.

## The edit contract

`oldText` is matched after whitespace normalization (tabs/spaces/trailing whitespace are tolerant).
On a not-found, the tool returns the closest current region with line numbers and the divergent line, so you copy the real text from that region (or `read` with `offset`/`limit`) and re-issue.
Set `replaceAll: true` on an edit to replace every occurrence when `oldText` is not unique.
You may pass a single edit `{oldText,newText}` or an array `edits:[...]` — the array-of-objects shape is supported but not required.

## Architecture

```text
src/
  match.ts            — pure: levenshtein, commonPrefix, scoreMatch, rankCandidates
  recover.ts          — IO: path "Did you mean?" walk-up recovery (kept from pi-path-recovery)
  edit-shape.ts       — pure: normalizeEdits (additive over the built-in prepareArguments)
  edit-fuzzy.ts       — pure: staged fuzzyMatch (exact, whitespace-run, gated multi-pass)
  edit-apply.ts       — pure: applyEdits against the original, replaceAll, overlap/no-op
  edit-diagnostics.ts — pure: similar-lines not-found + not-unique errors
  read-shape.ts       — pure: offset/limit coercion
  read-number.ts      — pure: cat -n line numbering
  index.ts            — adapter: registers the three overrides (the only file with I/O or pi imports)
```

The pure modules are import-free and testable in isolation; `index.ts` is the only module that touches the filesystem or imports pi.

## Install

```bash
pi install git:github.com/gotgenes/pi-packages
```

Or install individually:

```bash
pi install npm:@gotgenes/pi-tanium
```

## Acknowledgements

pi-tanium's techniques were informed by reading the source of several publicly-available projects.
No code was copied — each technique is reimplemented clean-room in pi-tanium's own pure modules.

- [pi-semantic-edit](https://github.com/k3-2o/pi-semantic-edit) (MIT) — the multi-pass fuzzy chain and the `original.includes(actual)` re-verification invariant.
- [pi-tian-edit-safe](https://github.com/TianZuo555/pi-tian-extensions) (MIT) — argument shape recovery and fuzzy gating.
- [pi-tool-guard](https://pi.dev/packages/pi-tool-guard) (MIT) — the spread-builtin, override-only-`prepareArguments` compose pattern.
- [pi-path-guard](https://pi.dev/packages/pi-path-guard) (MIT) — the computed `read(offset,limit)` suggestion in edit diagnostics.
- [@aboutlo/pi-smart-edit](https://pi.dev/packages/@aboutlo/pi-smart-edit) (no license) — the per-line divergence concept (`LineMismatch`); concept only, no code reused.
- [axe](https://github.com/SRSWTI/axe) (Apache-2.0) — the single-or-list `edit` schema and per-edit `replace_all`.
- [goose](https://github.com/block/goose) (Apache-2.0) — `offset`/`limit` partial reads as a token saver.

`cat -n` read line numbering is the one genuinely novel piece (no audited package numbers read output).
