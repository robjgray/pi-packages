import { describe, expect, it } from "vitest";
import { notUniqueError, offsetToLine, similarLinesError } from "#src/edit-diagnostics";
import type { ClosestRegion } from "#src/edit-fuzzy";
import type { EditEntry } from "#src/edit-shape";

const region: ClosestRegion = {
	startLine: 42,
	endLine: 45,
	preview: "## Tasks & Acceptance\n**Execution:**\n- [ ] `cmd/timer/main.go`: drive the counter\n- [ ] `cmd/timer/main.go`: (continued)",
	similarity: 0.62,
};

describe("similarLinesError", () => {
	it("names the closest region with line numbers", () => {
		const err = similarLinesError({ oldText: "x", newText: "y" } as EditEntry, region);
		expect(err.kind).toBe("not-found");
		if (err.kind !== "not-found") return;
		expect(err.message).toContain("lines 42\u201345");
		expect(err.message).toContain("42 | ## Tasks & Acceptance");
	});

	it("identifies the diverging line (the §1.2 content-drift case)", () => {
		const edit = {
			oldText:
				"\n**Execution:**\n- [ ] `cmd/tmer/clicker.go` \u2026 define ONE accessor\n- [ ] `cmd/timer/main.go` \u2026 (continued)",
			newText: "x",
		} as EditEntry;
		const err = similarLinesError(edit, region);
		if (err.kind !== "not-found") throw new Error("expected not-found");
		expect(err.lineMismatch).toBeDefined();
		if (err.lineMismatch) {
			expect(err.lineMismatch.line).toBe(3);
			expect(err.lineMismatch.sent).toContain("cmd/tmer");
			expect(err.lineMismatch.got).toContain("cmd/timer/main.go");
		}
		expect(err.message).toContain("diverged at line 3");
	});

	it("computes a read(offset,limit) suggestion covering the region", () => {
		const err = similarLinesError({ oldText: "x", newText: "y" } as EditEntry, region);
		if (err.kind !== "not-found") throw new Error("expected not-found");
		expect(err.readSuggestion).toEqual({ offset: 42, limit: 4 });
		expect(err.message).toContain("offset=42");
	});
});

describe("notUniqueError", () => {
	it("lists every occurrence with line numbers and a read suggestion", () => {
		const content = "foo\nbar\nfoo\nbaz\nfoo\n";
		const { error } = notUniqueError(content, [
			{ start: 0, end: 3 },
			{ start: 8, end: 11 },
			{ start: 16, end: 19 },
		]);
		expect(error.kind).toBe("not-unique");
		if (error.kind !== "not-unique") return;
		expect(error.occurrences).toHaveLength(3);
		expect(error.occurrences[0]).toEqual({ startLine: 1, endLine: 1 });
		expect(error.occurrences[2]).toEqual({ startLine: 5, endLine: 5 });
		expect(error.message).toContain("3 occurrences");
		expect(error.message).toContain("replaceAll: true");
	});
});

describe("offsetToLine", () => {
	it("returns 1 for offset 0 and counts newlines", () => {
		expect(offsetToLine("a\nb\nc", 0)).toBe(1);
		expect(offsetToLine("a\nb\nc", 2)).toBe(2);
		expect(offsetToLine("a\nb\nc", 4)).toBe(3);
	});
});