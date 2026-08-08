<p align="center">
  <img src="docs/assets/logo.png" alt="pi-permission-system logo">
</p>

# @gotgenes/pi-permission-system

[![npm version](https://img.shields.io/npm/v/@gotgenes/pi-permission-system?style=flat&logo=npm&logoColor=white)](https://www.npmjs.com/package/@gotgenes/pi-permission-system) [![CI](https://img.shields.io/github/actions/workflow/status/gotgenes/pi-packages/ci.yml?style=flat&logo=github&label=CI)](https://github.com/gotgenes/pi-packages/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![pnpm](https://img.shields.io/badge/pnpm-%3E%3D11-F69220?style=flat&logo=pnpm&logoColor=white)](https://pnpm.io/) [![Pi Package](https://img.shields.io/badge/Pi-Package-6366F1?style=flat)](https://pi.mariozechner.at/)

Permission enforcement extension for the [Pi](https://pi.mariozechner.at/) coding agent that provides centralized, deterministic permission gates over tool, bash, MCP, skill, and special operations.

> **Fork notice:** This package is a full fork of [MasuRii/pi-permission-system](https://github.com/MasuRii/pi-permission-system), published to npm as `@gotgenes/pi-permission-system`.
> It has diverged substantially from upstream in config format, internal architecture, and permission model.

## What It Does

- **Hides disallowed tools** before the agent starts — no wasted turns probing for blocked tools
- **Enforces allow / ask / deny** at tool-call time with UI confirmation dialogs
- **Controls bash commands** with wildcard pattern matching (`git *: ask`, `rm -rf *: deny`)
- **Gates MCP and skill access** at server, tool, and skill-name granularity
- **Protects sensitive file patterns** — cross-cutting `path` rules deny `.env`, `~/.ssh/*`, etc. across all tools at once, matching both the path as referenced and its symlink-resolved form so a deny cannot be evaded through a symlink alias; the separate `bash_path` surface denies bash **writes** (redirect targets) to source files without blocking `edit`/`write` (bash **reads** route to `path`, so a `path`-only config keeps full bash protection)
- **Guards external paths** — prompts before file tools or bash commands reach outside `cwd`
- **Fails closed** — an internal gate error blocks the tool (with a `gate_error` review-log entry), and an unparseable bash command — or an indirection wrapper that hides the gated command (`bash -c`/`eval`, `sudo`, `env`, `xargs`, `find -exec`, …) — prompts (`ask`) rather than passing silently
- **Forwards prompts from subagents** — `ask` policies work even in non-UI execution contexts
- **Broadcasts UI prompt events** — `permissions:ui_prompt` fires only when the permission system is about to invoke the active user-facing permission UI
- **Native [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-subagents) integration** — in-process child sessions register with the permission system automatically, enabling per-agent policy enforcement and `ask`-state forwarding to the parent UI without configuration

## Install

```bash
pi install npm:@gotgenes/pi-permission-system
```

## Quick Start

1. Create the global config file at `~/.pi/agent/extensions/pi-permission-system/config.json`:

    ```jsonc
    {
      "permission": {
        "*": "allow",
        "path": {
          "*": "allow",
          "*.env": "deny",
          "*.env.*": "deny",
          "*.env.example": "allow"
        },
        "bash": {
          "*": "ask",
          "rm -rf *": "deny",
          "sudo *": "ask"
        },
        "external_directory": "ask"
      }
    }
    ```

2. Start Pi — the extension automatically loads and enforces your policy.

All permissions use one of three states:

| State   | Behavior                                 |
| ------- | ---------------------------------------- |
| `allow` | Permits the action silently              |
| `deny`  | Blocks the action with an error message  |
| `ask`   | Prompts the user for confirmation via UI |

When the dialog prompts, you can approve once or approve a pattern for the rest of the session.
In an interactive TUI session the prompt is an inline keybind dialog — `y` approve, `s` approve for this session, `n` deny, `r` deny with a reason — where each hotkey arms and a second press confirms (configurable via `doublePressToConfirm`).
Pi's tool-expansion binding (`app.tools.expand`, `Ctrl+O` by default) keeps working while the dialog is open, so you can expand a truncated tool preview before deciding.
See [docs/configuration.md](docs/configuration.md#inline-permission-dialog-tui) for the hotkeys and [docs/session-approvals.md](docs/session-approvals.md) for session-scoped rules and pattern suggestions.

The `path` surface is a cross-cutting gate that applies to **tool** file access — Pi tools (`read`/`write`/`edit`/`find`/`grep`/`ls`), MCP calls, and extension tools alike.
Extension and MCP tools that operate on paths (via `input.path`, MCP's `input.arguments.path`, or a registered access extractor) are gated by default, so a `path` deny cannot be overridden by a per-tool allow — making it the right place to protect sensitive files like `.env` or `~/.ssh/*` from every tool at once.
Bash **writes** (redirect targets) are gated on the separate `bash_path` surface (below) so a `path` rule does not also block bash redirects — keeping `path` denies off the bash redirect escape hatch.
Bash **reads** (bare-filename arguments like `cat .env`) route to the `path` surface, and a bash **write** resolves against **both** `bash_path` and `path` with the most restrictive winning (`deny` > `ask` > `allow`) — `bash_path` can only add restrictions, so a `path` deny always holds for bash writes and a `bash_path` catch-all allow does not bypass it.
A `path`-only config keeps full bash read+write protection with no `bash_path` key.
A `path` pattern matches both the path as the agent references it and its canonical (symlink-resolved) form, so a deny still fires when a symlink aliases a sensitive target.

For per-tool path patterns (`read`, `write`, `edit`, `find`, `grep`, `ls`), patterns are matched against the file path from `input.path`.
This lets you express rules like "allow reads but deny `.env` files" at the individual tool level.
Like the cross-cutting `path` surface, per-tool patterns match both the referenced path and its canonical (symlink-resolved) form, so a per-tool deny resists symlink-alias evasion.
When Pi's current working directory is known, relative path inputs also match their cwd-normalized absolute form, so `src/App.jsx` can match both `src/*` and `/workspace/project/*`.

The `external_directory` surface is the CWD-boundary gate: it decides whether reaching **outside** the working tree is allowed, and accepts a pattern map so you can allow specific outside-CWD directories without opening up all external access.
This is the right surface for silencing repeated prompts on a local cache like `~/.cargo/registry` — allow it here, not on `path`:

```jsonc
{
  "permission": {
    "external_directory": {
      "*": "ask",
      "~/.cargo/registry/*": "allow"
    }
  }
}
```

The trailing `*` is greedy and crosses subdirectory boundaries, so it allows every file beneath the directory; a bare `~/.cargo/registry` matches only the directory entry itself.

The `bash_path` surface gates bash **writes** — `file_redirect` destinations (`sed 's/a/b/' f > main.go`) — distinct from the tool `path` surface so a `bash_path` deny blocks bash from writing to a source file **without** blocking `edit`/`write` to that same file.
A bash **write** resolves against **both** `bash_path` and `path`, and the most restrictive wins (`deny` > `ask` > `allow`) — `bash_path` can only **add** restrictions, so a `path` deny always holds for bash writes, and a `bash_path: { "*": "allow" }` catch-all does **not** bypass a `path` deny.
A `bash_path` deny still denies (more restrictive).
Bash **reads** (bare-filename arguments that name an existing file, like `cat .env`) resolve against the `path` surface only, not `bash_path`, so a `bash_path` deny cannot block a bash read.
Use `bash_path` to close the bash redirect-to-source escape hatch while steering the agent toward `edit`/`write`:

```jsonc
{
  "permission": {
    "*": "allow",
    "bash_path": {
      "*": "allow",
      "*.go": { "action": "deny", "reason": "Redirecting bash output to a .go source file is blocked. Use the edit or write tool." },
      "*.ts": { "action": "deny", "reason": "Redirecting bash output to a .ts source file is blocked. Use the edit or write tool." }
    }
  }
}
```

A `bash_path` rule matches both the token as referenced and its canonical (symlink-resolved) form, and on Windows folds case and separators, just like `path`.
With no `bash_path` key, bash writes still resolve against `path` (the most-restrictive composition falls through to the `path` result) and bash reads route to `path`, so a `path`-only config keeps full bash protection (no `bash_path` key needed — a true `feat` minor, no migration for protection).

**Opt-in bash-only steering.**
To deny a bash redirect to a file *without* denying `edit`/`write` to it, remove the matching `path` rule and add a `bash_path` rule for the same pattern — that decouples bash writes from the tool surface so `edit`/`write` (which gate through `path`) stay allowed while `echo > file` is blocked.

### Bash command patterns — full raw command match

`bash` command patterns are matched two ways and the most restrictive wins (`deny` > `ask` > `allow`):

- each tree-sitter-decomposed command unit (so `cd X && npm install` is evaluated as `cd X` and `npm install` separately), and
- the **full raw command string**, heredoc bodies included.

The raw match catches string-based workarounds the unit decomposition strips — a `python3 - <<'PY'\nopen()\nPY` heredoc body is invisible to the unit matcher (which sees bare `python3`), but the full command matches a `python3 *open(*` pattern.
A command that parses to zero units (a parse anomaly or an opaque program) is also raw-matched, so a `deny` pattern catches its raw string; otherwise it fails closed to `ask` so a permissive top-level `*` cannot silently allow an unparseable command.
Every future string-based workaround (`tee`, `printf > file`, `dd of=…`) is catchable by a config pattern, with no per-workaround code.
A wrapper unit (`bash -c`/`eval`, `sudo`/`env`/`xargs`/…) is still floored to `ask` even when the raw command is `allow`, so the floor is preserved (`pickMostRestrictive` composes them: a raw `deny` beats a wrapper `ask`, and a wrapper `ask` beats a raw `allow`).

### Steering the agent toward `edit`/`read`/`write` (the prevention layer)

For a hard stop, the `bash` and `bash_path` denies above block the file-mutation escape hatches with a reason naming the tool to use.
For the soft nudge, append a global system-prompt drop-in at `~/.pi/agent/APPEND_SYSTEM.md` so the agent reaches for `edit`/`read`/`write` before `bash`:

```markdown
# File operations

To modify file contents, use `edit` (fuzzy + shape-recovered) or `write` (full rewrite). Do not edit files via `python3`/`sed`/`awk` inside `bash` — those calls are blocked. For repeated changes to the same file, prefer `edit` over re-`write`ing. For content search, use the built-in `grep` tool, not `bash grep`.
```

The two close the loop from both sides: the system prompt says "use `edit`/`read`/`write`" *before* the model reaches for `bash`, and the permission deny says it again *if* the model tries `bash` anyway.

Five layers compose with most-restrictive-wins: `path` (tools + bash reads) `→` `external_directory` (CWD boundary) `→` `bash_path` (bash writes) `→` per-tool patterns `→` `bash` command patterns.
Because `ask` is more restrictive than `allow`, a `path` allow cannot loosen an `external_directory: ask` boundary — allow outside-CWD directories on `external_directory`.
A `bash_path` deny is independent of `path`: it blocks the bash redirect without blocking `edit`/`write` to the same file (those gate through `path`).
See [docs/configuration.md](docs/configuration.md) for the full recipe.

## Configuration

Config lives in one JSON file per scope:

| Scope   | Path                                                      |
| ------- | --------------------------------------------------------- |
| Global  | `~/.pi/agent/extensions/pi-permission-system/config.json` |
| Project | `<cwd>/.pi/extensions/pi-permission-system/config.json`   |

Project overrides global; per-agent YAML frontmatter overrides both.
Project config (policy and runtime knobs) is loaded only once the project is trusted — in an untrusted directory only global config applies, so an untrusted repository cannot loosen your global policy (see [Upgrading](#2200--project-config-requires-project-trust)).

Within a surface map like `bash` or `mcp`, **last matching rule wins** — put broad catch-alls first and specific overrides after.

The optional `shellTools` field records which non-`bash` tools carry shell semantics (e.g. an `exec_command` tool that replaces native `bash`), so they are gated at full parity with native `bash` — see [docs/configuration.md](docs/configuration.md#shelltools--gating-aliased-shell-tools).

The optional `authorizerChain` field names registered case-by-case decision links (e.g. a light model judge) to consult when a request lands on `ask`, ahead of the interactive prompt.
A downstream extension registers a link via `getPermissionsService().registerAuthorizer(name, authorize)`; it decides nothing until you name it here (opt-in), config order fixes the chain order, and the chain owner caps any link's `allow` on `external_directory`/`path` to keep it within your policy — see [docs/configuration.md](docs/configuration.md#authorizer-chain--case-by-case-decision-links).
[`@gotgenes/pi-permission-model-judge`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-model-judge) is a first-party reference implementation of such a link — a deny-first reviewer that auto-denies mistyped out-of-directory paths.

For the full reference — all surfaces, runtime knobs, per-agent overrides, merge semantics, and common recipes — see [docs/configuration.md](docs/configuration.md).

## Upgrading

### 22.0.0 — project config requires project trust

Project-scoped configuration (the project `config.json` and project-agent frontmatter — both permission policy and runtime knobs such as `yoloMode`) is now loaded only when Pi reports the project as trusted.
In an untrusted directory, only global config applies; a skip is surfaced with a warning and a `project_trust.skipped` review-log entry.
Grant project trust (or set `defaultProjectTrust`) to load a project's config.
See [docs/migration/0644-project-trust-gating.md](docs/migration/0644-project-trust-gating.md).

### 16.0.0 — the bash gate now fails closed

The permission gate fails closed: an internal gate error blocks the tool (with a `gate_error` review-log entry) instead of running it ungated, and a non-empty bash command that cannot be parsed resolves to `ask` (sentinel `<unparseable-bash-command>`) rather than falling through to a permissive top-level `*`.
Commands that previously slipped through silently on the error or empty-parse path now block or prompt.

If you relied on the old permissive behavior for bash, set an explicit permissive bash policy — `"bash": { "*": "allow" }` — which also suppresses the new startup warning emitted when a top-level `"*": "allow"` leaves bash ungated.

## Documentation

| Document                                                                                                                       | Contents                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [docs/configuration.md](docs/configuration.md)                                                                                 | Full policy reference, runtime knobs, per-agent overrides, recipes                            |
| [docs/session-approvals.md](docs/session-approvals.md)                                                                         | Session-scoped rules, pattern suggestions, bash arity table                                   |
| [docs/cross-extension-api.md](docs/cross-extension-api.md)                                                                     | Cross-extension service accessor, event bus integration, prompt and decision broadcasts       |
| [docs/subagent-integration.md](docs/subagent-integration.md)                                                                   | Permission forwarding, coexistence with subagent extensions                                   |
| [docs/guides/permission-frontmatter-for-subagent-extensions.md](docs/guides/permission-frontmatter-for-subagent-extensions.md) | Convention guide for subagent extension authors                                               |
| [docs/opencode-compatibility.md](docs/opencode-compatibility.md)                                                               | OpenCode compatibility — shared concepts, divergences, porting guide                          |
| [docs/troubleshooting.md](docs/troubleshooting.md)                                                                             | Common issues, diagnostic logging, threat model                                               |
| [docs/migration/legacy-to-flat.md](docs/migration/legacy-to-flat.md)                                                           | Migration from pre-v2 config layout                                                           |
| [docs/migration/strict-config-validation.md](docs/migration/strict-config-validation.md)                                       | Strict config validation (breaking) — rejected configs, and the cross-scope fail-closed clamp |
| [docs/migration/0644-project-trust-gating.md](docs/migration/0644-project-trust-gating.md)                                     | Project-trust gating (breaking) — project config loads only after project trust               |

## Development

```bash
pnpm run check       # Type-check TypeScript (no emit)
pnpm run lint        # Biome + ESLint + lint:md
pnpm run lint:md     # rumdl on README and docs
pnpm run test        # Run tests from ./test
pnpm run test:watch  # Run tests in watch mode
```

### Pre-commit hooks

This project uses [prek](https://prek.j178.dev/) to run Biome, ESLint, and rumdl on staged files before each commit.
Run `pnpm install` to set up hooks automatically.

## Acknowledgments

This project began as a fork of [MasuRii/pi-permission-system](https://github.com/MasuRii/pi-permission-system).
Thank you to [MasuRii](https://github.com/MasuRii) for the original work that made this possible.

Thank you to the [OpenCode](https://opencode.ai) team for the permission model design that inspired the flat config format and evaluation semantics used in this extension.

## License

[MIT](LICENSE)
