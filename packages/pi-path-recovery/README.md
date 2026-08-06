# pi-path-recovery

Fuzzy path recovery for pi — wraps `read`/`write`/`edit` with "Did you mean?" suggestions when the model garbles paths.

## Why

When a model tokenizes long paths (especially hex hashes, UUIDs, or other alphanumeric sequences), the tokenizer often breaks them into single-character tokens. The model then compresses these sequences during generation — keeping boundary characters and dropping the middle (`b57b41f7` → `bf7`). This produces garbled paths that either:

- **read/edit**: throw a bare ENOENT, causing the model to loop trying to self-correct
- **write**: silently create wrong directories and write files to garbage paths (the worst case — no error, model thinks it succeeded)

This extension intercepts those cases and returns "Did you mean?" suggestions so the model can retry with the correct path immediately.

## How it works

Registers tools named `read`, `write`, and `edit` that override the built-ins via same-name registration (pi's tool merge gives first registration per name priority).

Each wrapper:

1. Pre-checks the path before delegating to the built-in
2. If the path doesn't exist, walks up to find the deepest existing ancestor
3. Lists the ancestor's entries and ranks them against the first missing (garbled) component using Levenshtein distance + prefix bonus
4. If a close match is found (score ≥ 0.5), throws a "Path not found. Did you mean: X?" error
5. If no close match is found, delegates to the built-in (normal behavior)

For `write` specifically, the pre-check targets the **parent directory** — if `mkdir` is about to create a new directory but a very similar directory already exists, it warns instead of silently creating the wrong directory.

## Architecture

```
src/
  match.ts    — pure: levenshtein, commonPrefix, scoreMatch, rankCandidates (zero deps, zero I/O)
  recover.ts  — IO: suggestPaths (walk-up, readdir, rank), formatSuggestions
  index.ts    — wiring: registers wrapped read/write/edit tools
```

The pure `match.ts` module has zero dependencies and zero I/O — it's designed for potential core inclusion in pi's `utils/` or `core/tools/`.