/**
 * inject.ts — Pure, provider-portable message injection.
 *
 * The `context` extension event fires before every LLM call (turn start and
 * between every tool round) and its result is transient — it shapes what the
 * provider sees, never the persisted transcript. `injectPreface` is the pure
 * transform: prepend a `<preface>` text block to the latest agent-visible
 * user-side message, whatever its role.
 *
 * Why "latest message, whatever its role" rather than appending a new user
 * message: pi carries `toolResult`s as separate messages, and its Anthropic
 * conversion merges only consecutive `toolResult`s (not user+user), so a
 * standalone appended user message would break role alternation on Anthropic.
 * Prepending into the latest message is the one path that works for every
 * provider:
 *
 *   - latest is `user`      → block at the front of the last user message
 *                              (clean for all providers; the common first-gen
 *                              and steer cases).
 *   - latest is `toolResult`→ Anthropic places the text as sibling content
 *                              *after* the tool_results in the merged user
 *                              message (end of the last user turn, clean);
 *                              OpenAI-completions prefixes it onto the last
 *                              `tool` message's text (top-of-attention; the
 *                              `<preface>` tag signals "meta, not tool
 *                              output").
 *
 * The function is generic in the element type so the real `AgentMessage[]`
 * flows through unchanged; the structural `InjectableMessage` constraint keeps
 * the module free of a direct SDK dependency and trivially unit-testable with
 * plain objects.
 */

/** Minimal content-block shape the injector observes. */
export interface InjectableContent {
  type: string;
  text?: string;
}

/** Minimal message shape the injector observes; the real `AgentMessage` satisfies this.
 *  `content` is optional because `AgentMessage` includes custom message types that
 *  carry no content — the injector only ever touches `user`/`toolResult`, which do. */
export interface InjectableMessage {
  role: string;
  content?: string | InjectableContent[];
}

/** Roles that render on the user side of the conversation for the next generation. */
const USER_SIDE_ROLES = new Set(["user", "toolResult"]);

/**
 * Prepend `block` to the latest user-side message in `messages`.
 *
 * - No-op when `block` is empty, `messages` is empty, or no user-side message
 *   exists (e.g. the latest message is an assistant turn).
 * - Idempotent: if the block is already the first content block of the target,
 *   the array is returned unchanged (guards against a double-fire of the
 *   `context` event for one generation).
 * - Non-mutating: returns a new array with one replaced element; the input is
 *   never modified.
 */
export function injectPreface<T extends InjectableMessage>(
  messages: T[],
  block: string,
): T[] {
  if (!block || messages.length === 0) return messages;

  // Only the last message is at the top of attention for the upcoming generation.
  // If it isn't user-side (e.g. an assistant turn on a resume/continue), don't
  // reach back and rewrite an earlier user turn — that would not be top-of-
  // attention and would mutate a past message.
  const target = messages[messages.length - 1];
  if (!USER_SIDE_ROLES.has(target.role)) return messages;

  const textBlock = { type: "text", text: block };

  // Normalize string/absent content to a block array so the prepend is uniform.
  const existing: InjectableContent[] =
    typeof target.content === "string"
      ? [{ type: "text", text: target.content }]
      : target.content
        ? [...target.content]
        : [];

  // Idempotence: the block is already first.
  if (
    existing.length > 0 &&
    existing[0]?.type === "text" &&
    existing[0]?.text === block
  ) {
    return messages;
  }

  // We preserve the element type `T` by spreading the original message and
  // replacing only `content`. The structural constraint means the new content
  // array is looser than `T`'s content field, so a cast is required here; the
  // shape (role + all other fields) is carried over verbatim from `target`.
  const newTarget = {
    ...target,
    content: [textBlock, ...existing],
  } as unknown as T;

  const result = messages.slice();
  result[result.length - 1] = newTarget;
  return result;
}
