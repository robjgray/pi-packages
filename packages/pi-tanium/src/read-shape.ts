/**
 * read-shape — `read` argument coercion.
 *
 * Pure (no I/O, no pi imports). Coerces `offset`/`limit` from the strings small
 * models sometimes emit into the numbers the schema requires. No alias folding:
 * the schema documents `path`/`offset`/`limit` only, and unevidenced aliases
 * lifted from other packages (`file`/`filePath`/`start`/`lines`) are slop
 * (CONTRIBUTING.md "One Rule"). `pi`'s `Value.Convert` already coerces declared
 * number fields, but a `prepareArguments` shim lets pi-tanium normalize before
 * validation and keep the resolved `offset` for the line-numbering wrapper.
 */

export interface ReadArgs {
	path: string;
	offset?: number;
	limit?: number;
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed === "") return undefined;
		const n = Number(trimmed);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}

/**
 * Coerce `read` arguments into a schema-conforming fresh object. Idempotent;
 * never mutates the caller's input. Passes `path` through unchanged.
 */
export function coerceReadArgs(input: unknown): ReadArgs {
	if (input === null || typeof input !== "object") {
		return { path: "" };
	}
	const obj = input as Record<string, unknown>;
	const path = typeof obj.path === "string" ? obj.path : "";
	const offset = toNumber(obj.offset);
	const limit = toNumber(obj.limit);
	const result: ReadArgs = { path };
	if (offset !== undefined) result.offset = Math.max(1, Math.floor(offset));
	if (limit !== undefined) result.limit = Math.max(1, Math.floor(limit));
	return result;
}