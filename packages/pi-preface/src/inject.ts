/**
 * inject.ts — Pure, provider-portable message wrapping.
 *
 * Prepends a `<turn-context>` block to the latest message's content — whether
 * it's a `user` message (first generation) or a `toolResult` (tool rounds).
 * The system prompt (set via `before_agent_start`) explains the tag, so the
 * model recognizes the wrapper as operational context and separates it from
 * the actual message content. This matches goose's TOM pattern, adapted for
 * pi's separate-toolResult architecture.
 *
 * The function is generic in the element type so the real `AgentMessage[]`
 * flows through unchanged; the structural `InjectableMessage` constraint keeps
 * the module free of a direct SDK dependency and trivially unit-testable with
 * plain objects.
 */

/** Minimal content-block shape the injector observes. */
interface InjectableContent {
  type: string;
  text?: string;
}

/** Minimal message shape the injector observes; the real `AgentMessage` satisfies this. */
export interface InjectableMessage {
  role: string;
  content?: string | InjectableContent[];
}

/** Only user — injecting into toolResult contaminates tool output on ollama
 *  (the model reads the wrapper as file content and tries to strip it). */
const WRAPPABLE_ROLES = new Set(["user"]);

/**
 * Prepend `block` to the latest wrappable message's content.
 *
 * - No-op when `block` is empty, `messages` is empty, or the latest message
 *   is not `user` or `toolResult` (e.g. an assistant turn on a resume).
 * - Non-mutating: returns a new array with one replaced element.
 */
export function injectPreface<T extends InjectableMessage>(
  messages: T[],
  block: string,
): T[] {
  if (!block || messages.length === 0) return messages;

  const target = messages[messages.length - 1];
  if (!WRAPPABLE_ROLES.has(target.role)) return messages;

  const textBlock = { type: "text", text: block };

  const existing: InjectableContent[] =
    typeof target.content === "string"
      ? [{ type: "text", text: target.content }]
      : target.content
        ? [...target.content]
        : [];

  const newTarget = {
    ...target,
    content: [textBlock, ...existing],
  } as unknown as T;

  const result = messages.slice();
  result[result.length - 1] = newTarget;
  return result;
}
