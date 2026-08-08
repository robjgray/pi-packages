/**
 * edit-shape — argument shape recovery for the `edit` tool.
 *
 * Pure (no I/O, no pi imports). Additive over the built-in `prepareArguments`:
 * it delegates the recoveries pi-core already does (stringified `edits` array,
 * top-level legacy `oldText`/`newText`), then layers only the corpus-evidenced
 * gaps pi-core discards — a stringified **single object** `{"oldText":…,"newText":…}`
 * and an unparseable stringified `edits` — and normalizes each entry into a
 * fresh `EditEntry[]`. No alias table: the schema documents `oldText`/`newText`/
 * `edits`/`path` only, and unevidenced aliases lifted from other packages are
 * slop (CONTRIBUTING.md "One Rule").
 *
 * Idempotent: returns a fresh object, never mutates the caller's input.
 */

import type { ClosestRegion, LineMismatch, ReadSuggestion } from "#src/edit-fuzzy";

/** A single targeted replacement. `replaceAll` is the per-edit escape hatch. */
export interface EditEntry {
	oldText: string;
	newText: string;
	replaceAll?: boolean;
}

/**
 * Structured edit error. Carries typed metadata — pi-tanium never regex-parsses
 * its own errors (only foreign pi-core errors would warrant that). `shape`
 * is the canonical-form error emitted by this module; the other kinds are
 * produced by `edit-apply`/`edit-diagnostics`.
 */
export type EditError =
	| {
			kind: "not-found";
			message: string;
			closestRegion: ClosestRegion;
			lineMismatch?: LineMismatch;
			readSuggestion: ReadSuggestion;
	  }
	| {
			kind: "not-unique";
			message: string;
			occurrences: { startLine: number; endLine: number }[];
			readSuggestion: ReadSuggestion;
	  }
	| { kind: "shape"; message: string; canonicalExample: string }
	| { kind: "no-change" | "overlap"; message: string };

/** Per-edit apply outcome, for `[tanium]` notice assembly. */
export interface ApplyResult {
	passName: string;
	start: number;
	end: number;
	replaced: number;
}

/** Canonical `edits` shape, used in the `shape` error. */
const CANONICAL_EXAMPLE = '{"path":"...","edits":[{"oldText":"...","newText":"..."}]}';

function shapeError(message: string): { error: EditError } {
	return { error: { kind: "shape", message, canonicalExample: CANONICAL_EXAMPLE } };
}

function isEditObject(value: unknown): value is { oldText: unknown; newText: unknown } {
	return typeof value === "object" && value !== null && "oldText" in value && "newText" in value;
}

/**
 * Recover `edits` into a normalized `EditEntry[]`.
 *
 * `builtinPrepare` is the built-in `prepareEditArguments` (passed in by the
 * adapter so this module stays import-free). It already recovers a stringified
 * `edits` **array** and top-level legacy `oldText`/`newText`; this function adds
 * the single-object unwrap and stringified-single-object recovery it misses,
 * and surfaces an unparseable stringified `edits` as a structured `shape` error
 * with the canonical example so the model retries correctly.
 *
 * Returns a fresh object; never mutates the caller's `input`.
 */
export function normalizeEdits(
	input: unknown,
	builtinPrepare: (input: unknown) => unknown,
): { path: string; edits: EditEntry[] } | { error: EditError } {
	// Shallow-clone before delegating: pi-core's prepareEditArguments mutates its
	// input in place — clone so the caller's args are untouched, and so the fresh
	// result we build is independent of the original.
	const clone = input !== null && typeof input === "object" ? { ...(input as Record<string, unknown>) } : input;
	const phase1 = builtinPrepare(clone);

	if (phase1 === null || typeof phase1 !== "object") {
		return shapeError("edit arguments must be an object with `path` and `edits`.");
	}

	const obj = phase1 as Record<string, unknown>;
	const path = typeof obj.path === "string" ? obj.path : "";
	let edits: unknown = obj.edits;

	// Layer 1: `edits` is a string — pi-core only accepts a stringified *array*
	// here; recover a stringified single object too, and surface unparseable
	// JSON as a structured shape error instead of silently no-op-ing.
	if (typeof edits === "string") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(edits);
		} catch {
			return shapeError("`edits` was a string that is not valid JSON.");
		}
		if (Array.isArray(parsed)) {
			edits = parsed;
		} else if (isEditObject(parsed)) {
			edits = [parsed];
		} else {
			return shapeError("`edits` was a string that did not parse to an array or a single edit object.");
		}
	}

	// Layer 2: a bare single edit object (not array-wrapped) — the shape small
	// models actually emit when they send `{"oldText":…,"newText":…}` directly.
	if (edits !== null && typeof edits === "object" && !Array.isArray(edits) && isEditObject(edits)) {
		edits = [edits];
	}

	if (!Array.isArray(edits)) {
		return shapeError("`edits` must be an array of {oldText,newText} objects.");
	}

	const normalized: EditEntry[] = [];
	for (const entry of edits) {
		if (!isEditObject(entry)) {
			return shapeError("each edit must be an object with string `oldText` and `newText`.");
		}
		const { oldText, newText } = entry;
		if (typeof oldText !== "string" || typeof newText !== "string") {
			return shapeError("each edit's `oldText` and `newText` must be strings.");
		}
		const replaceAll = (entry as Record<string, unknown>).replaceAll === true ? true : undefined;
		normalized.push({ oldText, newText, replaceAll });
	}

	if (normalized.length === 0) {
		return shapeError("`edits` must contain at least one replacement.");
	}

	return { path, edits: normalized };
}