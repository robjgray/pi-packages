import { describe, expect, it } from "vitest";
import { normalizeEdits } from "#src/edit-shape";

/**
 * Mimics pi-core's `prepareEditArguments`: recovers a stringified `edits`
 * **array** and top-level legacy `oldText`/`newText`. It does NOT recover a
 * stringified single object (the §A1 gap pi-tanium layers on top).
 */
function builtinPrepare(input: unknown): unknown {
	if (!input || typeof input !== "object") return input;
	const args = { ...(input as Record<string, unknown>) };
	if (typeof args.edits === "string") {
		try {
			const parsed = JSON.parse(args.edits);
			if (Array.isArray(parsed)) args.edits = parsed;
		} catch {
			/* leave edits as string — the gap pi-tanium closes */
		}
	}
	const legacy = args as { oldText?: unknown; newText?: unknown; edits?: unknown };
	if (typeof legacy.oldText === "string" && typeof legacy.newText === "string") {
		const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
		edits.push({ oldText: legacy.oldText, newText: legacy.newText });
		const { oldText: _o, newText: _n, ...rest } = legacy;
		return { ...rest, edits };
	}
	return args;
}

describe("normalizeEdits", () => {
	it("unwraps a stringified single object to one edit (the §A1 gap)", () => {
		const input = { path: "a.txt", edits: JSON.stringify({ oldText: "a", newText: "b" }) };
		const out = normalizeEdits(input, builtinPrepare);
		expect("error" in out).toBe(false);
		if ("error" in out) return;
		expect(out.edits).toEqual([{ oldText: "a", newText: "b", replaceAll: undefined }]);
	});

	it("returns a shape error for an unparseable stringified edits", () => {
		const out = normalizeEdits({ path: "a.txt", edits: "{not json" }, builtinPrepare);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("shape");
		if (out.error.kind === "shape") {
			expect(out.error.canonicalExample).toContain("edits");
			expect(out.error.canonicalExample).toContain("oldText");
		}
	});

	it("wraps a bare single edit object (not array-wrapped)", () => {
		const out = normalizeEdits({ path: "a.txt", edits: { oldText: "a", newText: "b" } }, builtinPrepare);
		expect("error" in out).toBe(false);
		if ("error" in out) return;
		expect(out.edits).toHaveLength(1);
	});

	it("passes a normal array through, preserving replaceAll", () => {
		const out = normalizeEdits(
			{ path: "a.txt", edits: [{ oldText: "a", newText: "b", replaceAll: true }] },
			builtinPrepare,
		);
		if ("error" in out) throw new Error("expected ok");
		expect(out.edits).toEqual([{ oldText: "a", newText: "b", replaceAll: true }]);
	});

	it("delegates top-level legacy oldText/newText to the built-in", () => {
		const out = normalizeEdits({ path: "a.txt", oldText: "a", newText: "b" }, builtinPrepare);
		if ("error" in out) throw new Error("expected ok");
		expect(out.edits).toEqual([{ oldText: "a", newText: "b", replaceAll: undefined }]);
	});

	it("delegates a stringified array to the built-in", () => {
		const out = normalizeEdits(
			{ path: "a.txt", edits: JSON.stringify([{ oldText: "a", newText: "b" }]) },
			builtinPrepare,
		);
		if ("error" in out) throw new Error("expected ok");
		expect(out.edits).toHaveLength(1);
	});

	it("is idempotent — running twice yields the same output", () => {
		const input = { path: "a.txt", edits: JSON.stringify({ oldText: "a", newText: "b" }) };
		const once = normalizeEdits(input, builtinPrepare);
		const twice = normalizeEdits(once, builtinPrepare);
		expect(twice).toEqual(once);
	});

	it("never mutates the caller's input", () => {
		const input = { path: "a.txt", edits: JSON.stringify({ oldText: "a", newText: "b" }) };
		const snapshot = JSON.parse(JSON.stringify(input));
		normalizeEdits(input, builtinPrepare);
		expect(input).toEqual(snapshot);
	});

	it("returns a shape error for a non-string, non-array, non-object edits", () => {
		const out = normalizeEdits({ path: "a.txt", edits: 42 }, builtinPrepare);
		expect("error" in out).toBe(true);
	});

	it("returns a shape error for an edit entry missing newText", () => {
		const out = normalizeEdits({ path: "a.txt", edits: [{ oldText: "a" }] }, builtinPrepare);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("shape");
	});
});