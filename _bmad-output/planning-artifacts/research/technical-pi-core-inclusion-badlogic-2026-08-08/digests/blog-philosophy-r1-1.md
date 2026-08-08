# Digest: blog-philosophy (round 1)

Source: Mario Zechner, "What I learned building an opinionated and minimal coding agent" (2025-11-30), https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
Publisher: mariozechner.at (author blog). Author = badlogic / Mario Zechner, pi maintainer.
Accessed: 2026-08-08. Confidence: high (primary, author's own statement).

## Load-bearing claims

- [C1] Governing philosophy, verbatim: "My philosophy in all of this was: if I don't need it, it won't be built. And I don't need a lot of things."
- [C2] Post title frames the project as "an opinionated and minimal coding agent."
- [C3] Minimal toolset: four tools (read, write, edit, bash) are "all you need for an effective coding agent"; three read-only tools (grep, find, ls) optional. "pi's system prompt and tool definitions together come in below 1000 tokens."
- [C4] Explicit "does not and will not" core-exclusion list, each with a file/CLI/tmux alternative:
  - "pi does not and will not support built-in to-dos." -> write TODO.md.
  - "pi does not and will not have a built-in plan mode." -> write PLAN.md.
  - "pi does not and will not support MCP." -> CLI tools with READMEs (progressive disclosure).
  - "No background bash... This is intentional." -> use tmux.
  - "pi does not have a dedicated sub-agent tool." -> spawn pi via bash.
- [C5] Anti-context-overhead criterion (MCP): MCP servers "dump their entire tool descriptions into your context on every session. That's 7-9% of your context window gone before you even start working." Preferred alternative "pays the token cost only when necessary (progressive disclosure)."
- [C6] Observability criterion: sub-agents and background bash are "a black box within a black box"; rejected in favor of observable composable primitives (bash, tmux, files). "I need observability for planning."
- [C7] Externalize-state criterion: to-dos/plan mode "add state that the model has to track... introduces more opportunities for things to go wrong." Prefer files the agent reads/updates.
- [C8] Dictatorial / fork-friendly: "I welcome contributions. But as with all my open source projects, I tend to be dictatorial... I just want to keep this focused and maintainable. If pi doesn't fit your needs, I implore you to fork it. I truly mean it."
- [C9] Anti-feature-accumulation: Claude Code "has turned into a spaceship with 80% of functionality I have no use for. The system prompt and tools also change on every release, which breaks my workflows... I hate that."
- [C10] Constraints = minimal programs: "constraints make for minimal programs that just do what they're supposed to do without superfluous fluff."
- [C11] YOLO by default: "no permission prompts... no safety rails." Security measures in other agents "mostly security theater." Relevant: safety/guardrail features are not core-worthy by default.

## Leads
- MCP-vs-CLI benchmark post and "what if you don't need MCP" quantifies the token-cost criterion.
- "Armin is wrong" post may illuminate design-debate philosophy (low priority).

## Could not find (this digest)
- No statement on the exact threshold for "core-worthy" beyond the negative criteria; the positive criterion is inferred from what is in core (see tools digest).