# pi-preface

**Situational top-of-mind injection for [pi](https://pi.dev).**
Keeps critical instructions at the front of the model's attention — turn start *and* between every tool round — so they never fade as a conversation grows.

> Unlike system prompts or project context files, which can fall out of attention as conversations get long, `pi-preface` re-injects your reminder fresh before each LLM call.
> Inspired by goose's [Top Of Mind](https://block.github.io/goose/docs/mcp/tom-mcp) extension.

## What it does

On every LLM call, pi fires the `context` extension event.
`pi-preface` listens for it and prepends a `<turn-context>…</turn-context>` block — your reminder text — to the latest user-side message.
The transform is **transient**: it shapes what the model sees, never the persisted session transcript, so there's no per-turn bloat.

Each entry in your `preface.json` declares a **when** activation condition, so a reminder only appears when it is relevant:

- `"always"` — injected on every generation regardless of session state (the original, unconditional behavior).
- `"skill_launched"` — injected only while a skill has been invoked in this session.

This is the right cure for the failure mode where a model **drifts** off long-ago instructions (forgets a checkpoint mid-workflow, skips a step after a detour).
For the failure mode where a strong reasoner **consciously rationalizes past** a rule it can see, preface raises the bar — the rule is fresh and at the top of attention, naming the exact excuse — but it is not a hard gate. (A hard gate requires a harness-enforced checkpoint tool, which is a separate, larger mechanism.)

## Install

```bash
pi install @gotgenes/pi-preface
# or, from a local checkout of this monorepo:
pi install /path/to/pi-packages/packages/pi-preface
```

## Configure

`pi-preface` reads two JSON files and concatenates their entries (global first, then project, by declaration order):

| Layer   | Path                       | Purpose                                  |
| ------- | -------------------------- | ---------------------------------------- |
| Global  | `~/.pi/agent/preface.json` | Persistent reminders across all projects |
| Project | `<cwd>/.pi/preface.json`   | Project-specific additions               |

Each file is an array of `{ when, body }` objects:

- `when` — the activation condition: `"always"` or `"skill_launched"`.
- `body` — the prompt prose to inject (markdown).

Presence of at least one valid entry is the enabled flag — **no separate on/off switch**.
When both files are absent or empty, the extension is a no-op.
To disable entirely, empty both files or `pi remove` the package.
Malformed JSON, unknown `when` values, and entries with a missing/empty `body` are skipped with a console warning (emitted on session start) — they never crash the session or invalidate the rest of the file.

Edit either file and run `/reload` in pi to pick up changes without a restart.

### Golden config

A recommended `~/.pi/agent/preface.json` for skill/discipline adherence — injected only once a skill is actually in play, so it never confuses a no-skill session:

```json
[
  {
    "when": "skill_launched",
    "body": "Follow skill instructions as authoritative, including checkpoints and approval gates. Do not self-approve checkpoints."
  }
]
```

### When `skill_launched` activates

The flag is **sticky**: once true it stays true for the rest of the session.
It flips on the first of any of these:

- You run `/skill:<known>` — pi expands it into a `<skill>` block in your message, detected before the first LLM call of that turn. (`/skill:<unknown>` passes through unexpanded, so it does **not** flip.)
- The model autonomously `read`s an actual `SKILL.md` file — detected on the `tool_call` event.
  Reads of other skill assets (`references/X.md`, etc.) do **not** flip it.
- You `resume` or `fork` a session whose history contains a prior `/skill:<name>` user invocation — seeded from history so it is active from turn one. (A session where the flag flipped only via an autonomous `read` of `SKILL.md` is not seeded — that path re-flips on the next such read after resume.)

A mid-session `/reload` resets the flag to false (it is not `resume`/`fork`), so the entry goes quiet until the next invocation.
The flag is session-scoped and never persists beyond it.

## How injection is placed

The block is prepended to the latest agent-visible user-side message, whatever its role:

- **Latest is a `user` message** (first generation of a turn, or a steer): the block is the first content of that message.
  Clean for every provider.
- **Latest is a `toolResult` message** (tool rounds — the common agent case): a separate `role: "system"` message carries the block into the OpenAI-completions (ollama) payload, which hoists and merges it with the base system prompt — never into a `tool` message's content, so no tool-output contamination.
  The `<turn-context>` tag makes clear it is operational context, not a new user instruction or tool output.

## Visibility in the TUI

The injection itself is transient — it wraps the latest message content with a `<turn-context>` block that the model sees but the transcript does not store.
But so you can see exactly **when and where preface fired**, every generation that injects appends a persisted `[preface]` block in the transcript above the response it wrapped, styled like a `[skill]` invocation (purple background, `[preface]` label):

```text
[preface] Preface (Global): /Users/you/.pi/agent/preface.json
          Preface (Project): /Users/you/project/.pi/preface.json
```

Each block is a custom entry — UI-only, **not sent to the LLM** — so the indicator costs zero model tokens.
It IS persisted to the session JSONL (one line per injection), which is the deliberate trade: a visible per-generation history record at the cost of some transcript and file clutter.
Each contributing file is labeled by layer with its absolute path; only the configured layer(s) are shown.

## Limits (by design)

- **No mid-thinking injection.**
  Streaming LLM APIs emit thinking → action as one stream; you can only shape the *next* generation.
  `pi-preface` injects before each generation starts.
- **No enforcement.**
  It is prevention at the thinking-start seam, not a hard halt.
  If a model still powers through a fresh, top-of-attention rule, that's the signal that a harness-enforced checkpoint tool is needed at the specific gates that break.
- **No fading or switching off after activation.**
  Once `skill_launched` flips true it stays true for the session; a future version may add fading.
- **No tools, no commands, no UI.** `pi-preface` is a listener only.

## License

MIT
