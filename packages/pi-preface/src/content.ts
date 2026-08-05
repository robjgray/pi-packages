/**
 * content.ts — Pure composition of the `<preface>` injection block.
 *
 * Extracted so the shaping policy (tag, size cap, empty-handling) has a focused
 * home independent of IO (`settings.ts`) and message mechanics (`inject.ts`).
 * The 64 KB cap and UTF-8-safe truncation mirror goose's `tom` extension.
 */

export const PREFACE_TAG = "preface";

/** Maximum byte length of the injected body, matching goose's tom cap. */
export const MAX_BYTES = 65_536;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Compose the `<preface>` block from raw content. Returns `""` when the content
 * is empty or whitespace-only, so callers can treat a falsy result as "no-op".
 */
export function composePrefaceBlock(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `<${PREFACE_TAG}>\n${truncateUtf8(trimmed, MAX_BYTES)}\n</${PREFACE_TAG}>`;
}

/**
 * Compose the single footer status line naming each contributing file by layer.
 * Pure — lives here with the other pure string composition so `index.ts` stays
 * wiring-only. Paths are emitted verbatim (absolute), only the layers present.
 */
export function prefaceFooterText(globalPath: string | undefined, projectPath: string | undefined): string {
  const parts: string[] = [];
  if (globalPath) parts.push(`Preface (Global): ${globalPath}`);
  if (projectPath) parts.push(`Preface (Project): ${projectPath}`);
  return parts.join("  ");
}

/**
 * Truncate to a UTF-8 byte limit on a character boundary, so a multibyte
 * sequence is never split. O(n) and Web-API-only (no Node `Buffer`), keeping
 * the module portable across Node and Bun runtimes.
 */
export function truncateUtf8(s: string, maxBytes: number): string {
  const bytes = encoder.encode(s);
  if (bytes.length <= maxBytes) return s;
  // Walk back while the byte at `end` is a UTF-8 continuation byte (10xxxxxx),
  // i.e. we would be mid-codepoint. Stops at the last complete codepoint start.
  let end = maxBytes;
  while (end > 0) {
    const b = bytes[end] ?? 0;
    if ((b & 0xc0) !== 0x80) break;
    end--;
  }
  return decoder.decode(bytes.subarray(0, end));
}
