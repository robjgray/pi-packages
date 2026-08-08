/**
 * edit-diagnostics — Stage 3 actionable "similar lines" error.
 *
 * Pure (no I/O, no pi imports). Composes three audited techniques, all
 * reimplemented clean-room (no code reused):
 *   - @aboutlo's per-line `LineMismatch {line, sent, got}` concept (the
 *     "which line diverged" piece — concept only; @aboutlo has no license, so
 *     nothing is copied),
 *   - pi-path-guard's computed `read(offset,limit)` suggestion,
 *   - pi-semantic-edit's similarity %.
 *
 * Produces a structured `EditError` (typed metadata — never a regex-parsed
 * string) naming the closest current region with line numbers and the
 * divergent line, so the model closes the loop with one cheap partial read
 * instead of re-`write`ing the whole file.
 */

import type { ClosestRegion, LineMismatch, ReadSuggestion } from "#src/edit-fuzzy";
import type { EditEntry, EditError } from "#src/edit-shape";
import { numberLines } from "#src/read-number";

/** 1-indexed line number of a character offset in `content`. */
export function offsetToLine(content: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < content.length; i++) {
		if (content.charCodeAt(i) === 10) line++;
	}
	return line;
}

function readSuggestionForRegion(region: ClosestRegion): ReadSuggestion {
	return { offset: region.startLine, limit: Math.max(1, region.endLine - region.startLine + 1) };
}

/**
 * Build the Stage 3 not-found `EditError`: the closest current region (line
 * numbered), the first diverging line, and a `read(offset,limit)` suggestion.
 */
export function similarLinesError(edit: EditEntry, closestRegion: ClosestRegion): EditError {
	const sentLines = edit.oldText.split("\n");
	const gotLines = closestRegion.preview.split("\n");
	const n = Math.max(sentLines.length, gotLines.length);

	let lineMismatch: LineMismatch | undefined;
	for (let k = 0; k < n; k++) {
		const sent = k < sentLines.length ? sentLines[k] : undefined;
		const got = k < gotLines.length ? gotLines[k] : undefined;
		const st = sent?.trim() ?? "";
		const gt = got?.trim() ?? "";
		// Skip cosmetic blank-line drift (a blank line in one side but not the
		// other) — report the first substantive content divergence instead.
		if (st === "" || gt === "") continue;
		if (st !== gt) {
			lineMismatch = { line: k + 1, sent: sent ?? "", got: got ?? "" };
			break;
		}
	}

	const readSuggestion = readSuggestionForRegion(closestRegion);
	const pct = Math.round(closestRegion.similarity * 100);

	const lines: string[] = [];
	lines.push("edit could not apply: oldText does not match the current file.");
	lines.push(
		`Closest region (${pct}% similar, lines ${closestRegion.startLine}\u2013${closestRegion.endLine}):`,
	);
	lines.push(numberLines(closestRegion.preview, closestRegion.startLine).trimEnd());
	if (lineMismatch) {
		lines.push(
			`Your oldText diverged at line ${lineMismatch.line}: you wrote \`${lineMismatch.sent}\`; the file has \`${lineMismatch.got}\`.`,
		);
	}
	lines.push(
		`Re-issue edit with oldText copied from the region above, or read(path, offset=${readSuggestion.offset}, limit=${readSuggestion.limit}) to fetch just those lines.`,
	);

	return {
		kind: "not-found",
		message: lines.join("\n"),
		closestRegion,
		lineMismatch,
		readSuggestion,
	};
}

/**
 * Build the not-unique `EditError`: every occurrence (with line numbers) and a
 * `read` suggestion covering the first occurrence.
 */
export function notUniqueError(
	content: string,
	spans: { start: number; end: number }[],
): { error: EditError } {
	const occurrences = spans.map((s) => ({
		startLine: offsetToLine(content, s.start),
		endLine: offsetToLine(content, s.end),
	}));
	const first = occurrences[0];
	const readSuggestion: ReadSuggestion = {
		offset: Math.max(1, first.startLine),
		limit: Math.max(1, first.endLine - first.startLine + 1),
	};
	const lines: string[] = [];
	lines.push(`edit could not apply: oldText is not unique (${occurrences.length} occurrences).`);
	for (const o of occurrences) {
		lines.push(`  lines ${o.startLine}\u2013${o.endLine}`);
	}
	lines.push(
		"Provide more context to make oldText unique, or set `replaceAll: true` on that edit to replace every occurrence.",
	);
	lines.push(
		`Read the region with read(path, offset=${readSuggestion.offset}, limit=${readSuggestion.limit}) to copy exact text.`,
	);
	return {
		error: { kind: "not-unique", message: lines.join("\n"), occurrences, readSuggestion },
	};
}