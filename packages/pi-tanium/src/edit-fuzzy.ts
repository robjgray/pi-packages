/**
 * edit-fuzzy — staged matcher for the `edit` tool's `oldText`.
 *
 * Pure (no I/O, no pi imports). Stages:
 *   0  exact                — `content.indexOf`; cheapest, no gate.
 *   1  whitespace-run       — collapse `\s+`→space per line + strip
 *      leading/trailing + tab⇄space. The normalization dimension pi-core's
 *      `normalizeForFuzzyMatch` lacks (it only `trimEnd`s and maps special
 *      Unicode spaces). Apply on exactly-one.
 *   2  gated multi-pass      — `line_trimmed` / `whitespace_normalized` /
 *      `indentation_flexible` / `escape_normalized` / `unicode_normalized`
 *      (the last is core-parity: a re-implementation of `normalizeForFuzzyMatch`'s
 *      NFKC + smart-quote/dash map, forced because that helper is internal-only).
 *      Gated by pi-tian-edit-safe guards (min length 5, NUL, size cap).
 *
 * Mandatory invariant on every pass: each candidate `actual` is an ORIGINAL
 * substring (taken by slicing `content`, never reconstructed from the normalized
 * query), so `original.includes(actual)` holds trivially — normalized-query
 * bytes are never written. `isDisproportionateMatch` rejects ballooning spans.
 */

import type { EditEntry } from "#src/edit-shape";
import { levenshtein } from "#src/match";

/** Per-line divergence between the model's `oldText` and the actual file. */
export interface LineMismatch {
	/** 1-indexed line in `oldText` that diverged. */
	line: number;
	file?: string;
	/** What the model wrote (the `oldText` line). */
	sent: string;
	/** What the file actually has. */
	got: string;
}

/** Closest current region to a not-found `oldText`, for the Stage 3 error. */
export interface ClosestRegion {
	startLine: number;
	endLine: number;
	/** Raw (un-numbered) region text from the file. */
	preview: string;
	/** 0–1 similarity to `oldText`. */
	similarity: number;
}

/** A `read(offset,limit)` suggestion that re-fetches just the close region. */
export interface ReadSuggestion {
	offset: number;
	limit: number;
}

export type FuzzyResult =
	| { kind: "ok"; start: number; end: number; actual: string; passName: string }
	| { kind: "ambiguous"; spans: { start: number; end: number }[] }
	| { kind: "notFound"; closestRegion: ClosestRegion };

interface LineSpan {
	start: number;
	end: number;
	text: string;
}

/** Split content into per-line spans (text excludes the trailing `\n`). */
function lineSpans(content: string): LineSpan[] {
	const lines = content.split("\n");
	const spans: LineSpan[] = [];
	let offset = 0;
	for (const line of lines) {
		spans.push({ start: offset, end: offset + line.length, text: line });
		offset += line.length + 1;
	}
	return spans;
}

/**
 * All non-overlapping occurrences of `needle` in `content` (indexOf advancing
 * by `needle.length`). Shared by the Stage 0 exact pass and `edit-apply`'s
 * `replaceAll` branch.
 */
export function findAllSpans(content: string, needle: string): { start: number; end: number }[] {
	const spans: { start: number; end: number }[] = [];
	if (needle.length === 0) return spans;
	let from = 0;
	while (from <= content.length) {
		const idx = content.indexOf(needle, from);
		if (idx === -1) break;
		spans.push({ start: idx, end: idx + needle.length });
		from = idx + needle.length;
	}
	return spans;
}

/** Reject fuzzy spans that ballooned far past the query's line count. */
function isDisproportionateMatch(actualLines: number, oldLines: number): boolean {
	return actualLines >= Math.max(oldLines + 3, oldLines * 2);
}

// ── per-line normalizations ────────────────────────────────────────────────

/** Stage 1: collapse whitespace runs, strip leading/trailing, tab⇄space. */
function normWhitespaceRun(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

/** Stage 2 `line_trimmed`: strip trailing whitespace only. */
function normLineTrimmed(line: string): string {
	return line.replace(/\s+$/, "");
}

/** Stage 2 `whitespace_normalized`: collapse `\s+`→space (no leading strip). */
function normWhitespaceNormalized(line: string): string {
	return line.replace(/\s+/g, " ");
}

/** Stage 2 `escape_normalized`: unescape common literal escapes. */
function normEscape(line: string): string {
	return line
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\\\/g, "\\")
		.replace(/\\"/g, '"')
		.replace(/\\'/g, "'");
}

/** Stage 2 `unicode_normalized`: NFKC + typographic quotes/dashes → ASCII. */
function normUnicode(line: string): string {
	return line
		.normalize("NFKC")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

// ── line-window matcher (line-count-preserving passes) ─────────────────────

function findWindowsByLineNorm(
	content: string,
	spans: LineSpan[],
	oldText: string,
	normLine: (line: string) => string,
): { start: number; end: number; actual: string }[] {
	const queryLines = oldText.split("\n").map(normLine);
	const qlen = queryLines.length;
	if (qlen === 0 || qlen > spans.length) return [];
	const results: { start: number; end: number; actual: string }[] = [];
	for (let i = 0; i <= spans.length - qlen; i++) {
		let match = true;
		for (let k = 0; k < qlen; k++) {
			if (normLine(spans[i + k].text) !== queryLines[k]) {
				match = false;
				break;
			}
		}
		if (match) {
			const start = spans[i].start;
			const end = spans[i + qlen - 1].end;
			results.push({ start, end, actual: content.slice(start, end) });
		}
	}
	return results;
}

// ── indentation_flexible: trimmed, empty-dropped subsequence ───────────────

function findWindowsIndentationFlexible(
	content: string,
	spans: LineSpan[],
	oldText: string,
): { start: number; end: number; actual: string }[] {
	const queryLines = oldText.split("\n").map((l) => l.trim()).filter((l) => l !== "");
	const qlen = queryLines.length;
	if (qlen === 0) return [];
	const cap = qlen * 3;
	const results: { start: number; end: number; actual: string }[] = [];
	for (let i = 0; i < spans.length; i++) {
		// Walk forward, consuming non-empty content lines as a subsequence of
		// the (trimmed, non-empty) query lines. The window grows up to `cap`.
		let q = 0;
		let j = i;
		const consumed: LineSpan[] = [];
		while (j < spans.length && q < qlen && consumed.length < cap) {
			const t = spans[j].text.trim();
			if (t === "") {
				consumed.push(spans[j]);
				j++;
				continue;
			}
			if (t === queryLines[q]) {
				consumed.push(spans[j]);
				q++;
				j++;
			} else {
				break;
			}
		}
		if (q === qlen && consumed.length > 0) {
			const start = consumed[0].start;
			const end = consumed[consumed.length - 1].end;
			results.push({ start, end, actual: content.slice(start, end) });
		}
	}
	return results;
}

// ── closest region (Stage 3 input) ─────────────────────────────────────────

function lineSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (!a && !b) return 1;
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	return 1 - levenshtein(a, b) / maxLen;
}

function blockSimilarity(aLines: string[], bLines: string[]): number {
	const n = Math.max(aLines.length, bLines.length);
	if (n === 0) return 1;
	let sum = 0;
	for (let k = 0; k < n; k++) {
		const a = k < aLines.length ? aLines[k] : "";
		const b = k < bLines.length ? bLines[k] : "";
		sum += lineSimilarity(a, b);
	}
	return sum / n;
}

/**
 * Find the content region most similar to `oldText`. Searches windows of
 * `oldText`-line-count ± 1 to tolerate off-by-one blank-line drift, scoring by
 * average per-line similarity. Exported so `edit-apply` can build a not-found
 * error for the `replaceAll` branch (which otherwise only does exact spans).
 */
export function findClosestRegion(content: string, oldText: string): ClosestRegion {
	const spans = lineSpans(content);
	const queryLines = oldText.split("\n");
	const qlen = queryLines.length;
	if (qlen === 0 || spans.length === 0) {
		return { startLine: 1, endLine: 1, preview: "", similarity: 0 };
	}
	let best: ClosestRegion = { startLine: 1, endLine: Math.min(qlen, spans.length), preview: "", similarity: 0 };
	for (const w of [qlen - 1, qlen, qlen + 1]) {
		const width = Math.max(1, w);
		if (width > spans.length) continue;
		for (let i = 0; i <= spans.length - width; i++) {
			const window = spans.slice(i, i + width).map((s) => s.text);
			const sim = blockSimilarity(window, queryLines);
			if (sim > best.similarity) {
				const start = spans[i].start;
				const end = spans[i + width - 1].end;
				best = {
					startLine: i + 1,
					endLine: i + width,
					preview: content.slice(start, end),
					similarity: sim,
				};
			}
		}
	}
	return best;
}

// ── stage runner ───────────────────────────────────────────────────────────

function pickUnique(
	content: string,
	oldText: string,
	candidates: { start: number; end: number; actual: string }[],
	passName: string,
): FuzzyResult {
	if (candidates.length === 0) return { kind: "notFound", closestRegion: findClosestRegion(content, oldText) };
	if (candidates.length === 1) {
		const c = candidates[0];
		return { kind: "ok", start: c.start, end: c.end, actual: c.actual, passName };
	}
	return { kind: "ambiguous", spans: candidates.map((c) => ({ start: c.start, end: c.end })) };
}

function runStage(
	content: string,
	spans: LineSpan[],
	oldText: string,
	normLine: (line: string) => string,
	passName: string,
): FuzzyResult {
	const qlen = oldText.split("\n").length;
	const candidates = findWindowsByLineNorm(content, spans, oldText, normLine).filter(
		(c) => !isDisproportionateMatch(c.end - c.start === 0 ? 0 : content.slice(c.start, c.end).split("\n").length, qlen),
	);
	return pickUnique(content, oldText, candidates, passName);
}

/**
 * Staged fuzzy match of `edit.oldText` against `content` (LF-normalized).
 * Returns the first stage that resolves to exactly one region.
 */
export function fuzzyMatch(content: string, edit: EditEntry): FuzzyResult {
	const oldText = edit.oldText;
	const spans = lineSpans(content);

	// Stage 0 — exact (no gate; cheapest).
	const exact = findAllSpans(content, oldText);
	if (exact.length === 1) {
		return { kind: "ok", start: exact[0].start, end: exact[0].end, actual: content.slice(exact[0].start, exact[0].end), passName: "exact" };
	}
	if (exact.length > 1) {
		return { kind: "ambiguous", spans: exact };
	}

	// Stage 1 — whitespace-run + leading/trailing + tab⇄space (novel dimension).
	const stage1 = runStage(content, spans, oldText, normWhitespaceRun, "stage1_ws");
	if (stage1.kind === "ok" || stage1.kind === "ambiguous") return stage1;

	// Stage 2 — gated multi-pass fallback.
	const trimmed = oldText.trim();
	const hasNul = oldText.includes("\0");
	const tooLarge = oldText.length > 1_000_000 || oldText.split("\n").length > 50_000;
	if (trimmed.length >= 5 && !hasNul && !tooLarge) {
		const passes: { norm: (l: string) => string; name: string }[] = [
			{ norm: normLineTrimmed, name: "line_trimmed" },
			{ norm: normWhitespaceNormalized, name: "whitespace_normalized" },
			{ norm: normEscape, name: "escape_normalized" },
			{ norm: normUnicode, name: "unicode_normalized" },
		];
		for (const pass of passes) {
			const result = runStage(content, spans, oldText, pass.norm, pass.name);
			if (result.kind === "ok" || result.kind === "ambiguous") return result;
		}
		// indentation_flexible (subsequence; line count may differ).
		const qlen = oldText.split("\n").length;
		const flex = findWindowsIndentationFlexible(content, spans, oldText).filter(
			(c) => !isDisproportionateMatch(content.slice(c.start, c.end).split("\n").length, qlen),
		);
		const flexResult = pickUnique(content, oldText, flex, "indentation_flexible");
		if (flexResult.kind === "ok" || flexResult.kind === "ambiguous") return flexResult;
	}

	return { kind: "notFound", closestRegion: findClosestRegion(content, oldText) };
}