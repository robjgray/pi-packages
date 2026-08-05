# pi-foremost

**Top-of-mind injection for [pi](https://pi.dev).**
Keeps critical instructions at the front of the model's attention on **every generation** — turn start *and* between every tool round — so they never fade as a conversation grows.

> Unlike system prompts or project context files, which can fall out of attention as conversations get long, `pi-foremost` re-injects your reminder fresh before each LLM call.
> Inspired by goose's [Top Of Mind](https://block.github.io/goose/docs/mcp/tom-mcp) extension.

## What it does

On every LLM call, pi fires the `context` extension event.
`pi-foremost` listens for it and prepends a `<foremost>…</foremost>` block — your reminder text — to the latest user-side message.
The transform is **transient**: it shapes what the model sees, never the persisted session transcript, so there's no per-turn bloat.

This is the right cure for the failure mode where a model **drifts** off long-ago instructions (forgets a checkpoint mid-workflow, skips a step after a detour).
For the failure mode where a strong reasoner **consciously rationalizes past** a rule it can see, foremost raises the bar — the rule is fresh and at the top of attention, naming the exact excuse — but it is not a hard gate. (A hard gate requires a harness-enforced checkpoint tool, which is a separate, larger mechanism.)

## Install

```bash
pi install @gotgenes/pi-foremost
# or, from a local checkout of this monorepo:
pi install /path/to/pi-packages/packages/pi-foremost
```

## Configure

`pi-foremost` reads two markdown files and concatenates them (global first, then project, separated by a blank line):

| Layer   | Path                      | Purpose                                  |
| ------- | ------------------------- | ---------------------------------------- |
| Global  | `~/.pi/agent/foremost.md` | Persistent reminders across all projects |
| Project | `<cwd>/.pi/foremost.md`   | Project-specific additions               |

Presence of content is the enabled flag — **no separate JSON config**.
When both files are absent or empty, the extension is a no-op.
To disable entirely, empty both files or `pi remove` the package.

Edit either file and run `/reload` in pi to pick up changes without a restart.

### Starter content

A recommended `~/.pi/agent/foremost.md` for skill/discipline adherence:

```markdown
All instructions in skills must be followed as if the user explicitly
requested them. This includes checkpoints, halting for approval, and
circling back to earlier parts of the skill. Self-approving a checkpoint
is forbidden — "the user was explicit" is not an exception; the halt
exists precisely so the human verifies even when the goal seems clear.
```

## How injection is placed

The block is prepended to the latest agent-visible user-side message, whatever its role:

- **Latest is a `user` message** (first generation of a turn, or a steer): the block is the first content of that message.
  Clean for every provider.
- **Latest is a `toolResult` message** (tool rounds — the common agent case): Anthropic places the text as sibling content *after* the tool results in the merged user message; OpenAI-completions (ollama) prefixes it onto the last `tool` message's text.
  In both cases it lands at the top of the last user-side turn.
  The `<foremost>` tag makes clear it is a meta-instruction, not tool output.

## Limits (by design)

- **No mid-thinking injection.**
  Streaming LLM APIs emit thinking → action as one stream; you can only shape the *next* generation.
  `pi-foremost` injects before each generation starts.
- **No enforcement.**
  It is prevention at the thinking-start seam, not a hard halt.
  If a model still powers through a fresh, top-of-attention rule, that's the signal that a harness-enforced checkpoint tool is needed at the specific gates that break.
- **No tools, no commands, no UI.** `pi-foremost` is a listener only.

## License

MIT
