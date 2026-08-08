/**
 * schema.ts — Pure config schema + lenient parser for `preface.json`.
 *
 * `preface.json` is an array of `{ when, body }` entries. `when` declares the
 * activation condition for that entry's `body` (a v1 enum, forward-compatible —
 * unknown values are skipped with a warning rather than rejecting the file).
 * The parser is deliberately lenient: a single malformed entry never throws or
 * invalidates the rest of the file — it is skipped with a warning so the
 * session never blocks on a config typo.
 */

/** v1 activation conditions. `"always"` injects every generation; `"skill_launched"` injects only while the skill flag is true. */
export type PrefaceWhen = "always" | "skill_launched";

/** A single preface entry: a body of prompt prose plus the condition under which it is injected. */
export interface PrefaceEntry {
  when: PrefaceWhen;
  body: string;
}

const KNOWN_WHEN: ReadonlySet<PrefaceWhen> = new Set(["always", "skill_launched"]);

/**
 * Parse a raw (already JSON-decoded) value into valid `PrefaceEntry[]` plus
 * human-readable warnings for every skipped item.
 *
 * - Non-array input → empty entries + one warning (the whole file is wrong).
 * - Each item that is not an object, has an unknown `when`, or a missing/empty
 *   `body` → skipped with a per-item warning; valid siblings are kept.
 * - Never throws.
 */
export function parsePrefaceConfig(raw: unknown): {
  entries: PrefaceEntry[];
  warnings: string[];
} {
  const entries: PrefaceEntry[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(raw)) {
    warnings.push("preface config must be an array of {when, body} entries");
    return { entries, warnings };
  }

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const at = `entry ${i}`;

    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      warnings.push(`${at}: not an object, skipped`);
      continue;
    }

    const obj = item as Record<string, unknown>;
    const { when } = obj;
    if (typeof when !== "string" || !KNOWN_WHEN.has(when as PrefaceWhen)) {
      warnings.push(`${at}: unknown \`when\` value ${JSON.stringify(when)}, skipped`);
      continue;
    }

    const { body } = obj;
    if (typeof body !== "string" || body.trim() === "") {
      warnings.push(`${at}: missing or empty \`body\`, skipped`);
      continue;
    }

    entries.push({ when: when as PrefaceWhen, body });
  }

  return { entries, warnings };
}
