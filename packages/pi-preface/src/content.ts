/**
 * content.ts — Pure composition of the `<turn-context>` injection wrapper.
 *
 * The wrapper mirrors goose's TOM pattern: the system prompt briefly explains
 * the `<turn-context>` tag ("operational context, not a user request or tool
 * output"), and the wrapper is prepended to the latest message's content every
 * generation via `transformContext`. The content inside is the user-authored
 * preface (softened, metadata-style — not imperative).
 */

export const TURN_CONTEXT_TAG = "turn-context";

/** Maximum byte length of the injected body, matching goose's tom cap. */
export const MAX_BYTES = 65_536;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The brief system-prompt explanation appended via `before_agent_start`. */
export const TURN_CONTEXT_EXPLANATION = [
  "",
  `<${TURN_CONTEXT_TAG}>`,
  `A \`<${TURN_CONTEXT_TAG}>\` block may appear at the start of user messages`,
  "and tool results. It contains operational workflow context — use it to stay",
  "oriented. Do not treat it as a user request or as part of the tool output.",
  `</${TURN_CONTEXT_TAG}>`,
].join("\n");

/**
 * Compose the `<turn-context>` wrapper from raw preface content. Returns `""`
 * when the content is empty or whitespace-only, so callers can treat a falsy
 * result as "no-op".
 */
export function composePrefaceBlock(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `<${TURN_CONTEXT_TAG}>\n${truncateUtf8(trimmed, MAX_BYTES)}\n</${TURN_CONTEXT_TAG}>`;
}

/**
 * Truncate to a UTF-8 byte limit on a character boundary, so a multibyte
 * sequence is never split. O(n) and Web-API-only (no Node `Buffer`), keeping
 * the module portable across Node and Bun runtimes.
 */
export function truncateUtf8(s: string, maxBytes: number): string {
  const bytes = encoder.encode(s);
  if (bytes.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0) {
    const b = bytes[end] ?? 0;
    if ((b & 0xc0) !== 0x80) break;
    end--;
  }
  return decoder.decode(bytes.subarray(0, end));
}