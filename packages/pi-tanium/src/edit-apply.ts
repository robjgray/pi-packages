/**
 * edit-apply — apply orchestration for the `edit` tool.
 *
 * Pure (no I/O, no pi imports). Owns the apply because pi-core's
 * `applyEditsToNormalizedContent` throws on >1 occurrence with no `replaceAll`
 * flag, so `replaceAll` cannot be delegated. Applies all edits against the
 * ORIGINAL (non-incremental), like pi-core: every edit is matched against the
 * original `normalizedContent`, then replacements are spliced in reverse order
 * so offsets stay stable. Overlapping/nested edits are rejected; a no-op apply
 * is surfaced as a `no-change` error.
 *
 * Also reexports the line-ending/BOM helpers (reimplementations of pi-core's
 * internal-only `stripBom`/`detectLineEnding`/`normalizeToLF`/
 * `restoreLineEndings`) so the adapter can round-trip CRLF/BOM without pi imports.
 */

import { notUniqueError, similarLinesError } from "#src/edit-diagnostics";
import { findAllSpans, findClosestRegion, fuzzyMatch } from "#src/edit-fuzzy";
import type { ApplyResult, EditEntry, EditError } from "#src/edit-shape";

// ── line-ending / BOM helpers (reimplemented; pi-core's are internal-only) ──

/** Strip a UTF-8 BOM if present. */
export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

/** Normalize all line endings to LF. */
export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Detect the dominant line ending (LF or CRLF); LF for mixed/none. */
export function detectLineEnding(content: string): "\n" | "\r\n" {
	// Count CRLF vs lone-LF occurrences and return the dominant line ending
	// (tie-break LF). The prior first-index-wins logic mislabeled a mostly-LF
	// file whose first newline was CRLF. A lone CR with no LF can't be
	// represented by the return type, so CR-only (classic Mac) degrades to LF.
	let crlf = 0;
	let lf = 0;
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") {
			if (i > 0 && content[i - 1] === "\r") crlf++;
			else lf++;
		}
	}
	return crlf > lf ? "\r\n" : "\n";
}

/** Restore the detected line ending after editing LF-normalized content. */
export function restoreLineEndings(text: string, ending: "\n" | "\r\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

// ── apply ──────────────────────────────────────────────────────────────────

interface Match {
	editIndex: number;
	start: number;
	end: number;
	newText: string;
	passName: string;
}

/**
 * Apply `edits` against `normalizedContent` (LF-normalized, BOM-stripped).
 * Returns the new content plus per-edit `ApplyResult[]`, or a structured error.
 */
export function applyEdits(
	normalizedContent: string,
	edits: EditEntry[],
): { content: string; results: ApplyResult[] } | { error: EditError } {
	const base = normalizedContent;
	const normalizedEdits = edits.map((e) => ({
		oldText: normalizeToLF(e.oldText),
		newText: normalizeToLF(e.newText),
		replaceAll: e.replaceAll === true,
	}));

	const matches: Match[] = [];
	for (let i = 0; i < normalizedEdits.length; i++) {
		const edit = normalizedEdits[i];
		if (edit.oldText.length === 0) {
			return {
				error: {
					kind: "shape",
					message: normalizedEdits.length === 1 ? "oldText must not be empty." : `edits[${i}].oldText must not be empty.`,
					canonicalExample: '{"path":"...","edits":[{"oldText":"...","newText":"..."}]}',
				},
			};
		}

		if (edit.replaceAll) {
			const spans = findAllSpans(base, edit.oldText);
			if (spans.length === 0) {
				const closestRegion = findClosestRegion(base, edit.oldText);
				return { error: similarLinesError(edit, closestRegion) };
			}
			for (const span of spans) {
				matches.push({ editIndex: i, start: span.start, end: span.end, newText: edit.newText, passName: "replace_all" });
			}
		} else {
			const result = fuzzyMatch(base, edit);
			if (result.kind === "ok") {
				matches.push({ editIndex: i, start: result.start, end: result.end, newText: edit.newText, passName: result.passName });
			} else if (result.kind === "ambiguous") {
				return notUniqueError(base, result.spans);
			} else {
				return { error: similarLinesError(edit, result.closestRegion) };
			}
		}
	}

	// Overlap/nested check (across all edits, sorted by start).
	const sorted = [...matches].sort((a, b) => a.start - b.start || a.end - b.end);
	for (let k = 1; k < sorted.length; k++) {
		const prev = sorted[k - 1];
		const cur = sorted[k];
		if (prev.end > cur.start) {
			return {
				error: {
					kind: "overlap",
					message: `edits[${prev.editIndex}] and edits[${cur.editIndex}] overlap. Merge them into one edit or target disjoint regions.`,
				},
			};
		}
	}

	// Apply in reverse order so earlier offsets stay valid.
	let newContent = base;
	for (let k = sorted.length - 1; k >= 0; k--) {
		const m = sorted[k];
		newContent = newContent.slice(0, m.start) + m.newText + newContent.slice(m.end);
	}

	if (newContent === base) {
		return {
			error: {
				kind: "no-change",
				message: "No changes made — the replacement produced identical content.",
			},
		};
	}

	// One ApplyResult per edit (replaceAll collapses its spans into one result).
	const results: ApplyResult[] = [];
	for (let i = 0; i < normalizedEdits.length; i++) {
		const editMatches = matches.filter((m) => m.editIndex === i);
		if (editMatches.length === 0) continue;
		const first = editMatches[0];
		const last = editMatches[editMatches.length - 1];
		results.push({
			passName: first.passName,
			start: first.start,
			end: last.end,
			replaced: editMatches.length,
		});
	}

	return { content: newContent, results };
}