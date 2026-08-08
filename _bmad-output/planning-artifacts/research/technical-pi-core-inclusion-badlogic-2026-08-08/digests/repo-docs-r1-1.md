# Digest: repo-docs (round 1)

Sources (all retrieved 2026-08-08 via gh api from github.com/earendil-works/pi, default branch main):
- D1 CONTRIBUTING.md (root) — publisher: earendil-works/pi project. Confidence: high (primary, project policy doc).
- D2 packages/coding-agent/docs/extensions.md — primary, project docs.
- D3 packages/coding-agent/docs/packages.md — primary.
- D4 packages/coding-agent/docs/providers.md and custom-provider.md — primary.
- D5 packages/agent/docs/agent-harness.md — primary (architecture doc).

## Load-bearing claims

- [C12] CONTRIBUTING.md "Philosophy" section, verbatim: "pi's core is minimal. If your feature does not belong in the core, it should be an extension. PRs that bloat the core will likely be rejected."
- [C13] Anti-slop (CONTRIBUTING.md "The One Rule"): "You must understand your code... Submitting AI-generated slop without understanding it is not." Applies to contributions generally, hence to core PRs.
- [C14] Contribution gate (CONTRIBUTING.md): new-contributor issues/PRs auto-closed; `lgtm` required to submit PRs. Empirical confirmation: PR #5898 and issue #7800 both auto-closed by github-actions with no maintainer reply. The bar to even get a core PR reviewed is deliberately high.
- [C15] Extension model is the documented escape hatch (extensions.md): extensions can override built-in tools (read/bash/edit/write/grep/find/ls) by registering the same name; `--no-builtin-tools` starts with zero built-ins. Custom tools, commands, providers, renderers, UI all live in extensions. "pi can create extensions. Ask it to build one for your use case." (opening line).
- [C16] Provider-agnostic core (providers.md / custom-provider.md / README): pi-ai is a "Unified multi-provider LLM API (OpenAI, Anthropic, Google, ...)" with ~20 built-in providers. Provider-specific OAuth flows or non-standard APIs are extension territory: "For providers that need custom API implementations or OAuth flows, create an extension." Core abstracts; specific lives in extensions.
- [C17] Core layering (README + agent-harness.md): four packages — pi-ai (unified LLM API), pi-agent-core (agent runtime/AgentHarness), pi-coding-agent (CLI + built-in tools + session), pi-tui. agent-harness.md: "Preserve UI/session behavior outside core" (migration plan item 7). UI is outside core by design.
- [C18] Built-in tools are pluggable via Operations interfaces (extensions.md "Remote Execution"): ReadOperations, WriteOperations, EditOperations, etc. Core tools are built so extension authors can delegate internals (SSH/containers) without forking core. This is the sanctioned extension pattern for changing tool *behavior* without touching core.

## Leads
- The actual built-in tool source (read.ts/edit.ts/write.ts) is the strongest evidence for what clears the core bar — see tools digest.

## Could not find
- No "core-worthiness checklist" doc; the positive criteria are inferred from C12 + the code.