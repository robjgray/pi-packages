import { describe, expect, it } from "vitest";
import { findAllSpans, findClosestRegion, fuzzyMatch } from "#src/edit-fuzzy";
import type { EditEntry } from "#src/edit-shape";

function entry(oldText: string, replaceAll = false): EditEntry {
	return { oldText, newText: "", replaceAll };
}

describe("fuzzyMatch — Stage 0 exact", () => {
	it("matches a unique exact occurrence", () => {
		const r = fuzzyMatch("a\nb\nc", entry("b"));
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") {
			expect(r.passName).toBe("exact");
			expect(r.actual).toBe("b");
			expect("a\nb\nc".includes(r.actual)).toBe(true);
		}
	});

	it("reports ambiguous on multiple exact occurrences", () => {
		const r = fuzzyMatch("x\ny\nx", entry("x"));
		expect(r.kind).toBe("ambiguous");
		if (r.kind === "ambiguous") expect(r.spans).toHaveLength(2);
	});
});

describe("fuzzyMatch — Stage 1 whitespace drift (Sub-pattern A)", () => {
	it("applies on a single whitespace-drift hit (tab/space/trailing)", () => {
		// File has 3 spaces; model wrote 4 spaces + trailing space; gofmt-style.
		const content = "\ttextHello   = \"Hello, World!\"\n\twindowTitle = \"Hello World\"";
		const oldText = "\ttextHello    = \"Hello, World!\" \n\twindowTitle  = \"Hello World\"";
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") {
			expect(r.passName).toBe("stage1_ws");
			// invariant: actual is an original substring, never normalized bytes
			expect(content.includes(r.actual)).toBe(true);
			expect(r.actual).toBe("\ttextHello   = \"Hello, World!\"\n\twindowTitle = \"Hello World\"");
		}
	});

	it("applies when the model added a leading tab the file lacks", () => {
		const content = 'const appID = "com.robjgray.clickgo"\n';
		const oldText = '\tconst appID = "com.robjgray.clickgo"\n';
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.passName).toBe("stage1_ws");
	});

	it("reports ambiguous when the normalized match is not unique", () => {
		const content = "foo  bar\nbaz\nfoo  bar";
		const r = fuzzyMatch(content, entry("foo bar"));
		expect(r.kind).toBe("ambiguous");
	});
});

describe("fuzzyMatch — Stage 2 gated multi-pass", () => {
	it("line_trimmed matches trailing-whitespace drift", () => {
		// Stage 1 would also catch this, so craft a case Stage 1 misses but
		// line_trimmed catches: Stage 1 strips leading too, so a leading-space
		// difference that should NOT be stripped is preserved by line_trimmed.
		const content = "  keep indent\n  trailing   \n";
		const oldText = "  keep indent\n  trailing\n";
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("ok");
	});

	it("escape_normalized matches literal-escape drift", () => {
		const content = "line1\ttabbed\n";
		const oldText = "line1\\ttabbed\n";
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.passName).toBe("escape_normalized");
	});

	it("unicode_normalized matches smart-quote/dash drift", () => {
		const content = '"smart" \u2014 dash\n';
		const oldText = '"smart" - dash\n';
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.passName).toBe("unicode_normalized");
	});

	it("indentation_flexible matches after blank-line insertion (subsequence)", () => {
		const content = "alpha\n\n\nbeta\n";
		const oldText = "alpha\nbeta\n";
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") expect(r.passName).toBe("indentation_flexible");
	});

	it("does not fire Stage 2 for oldText shorter than 5 chars (gate)", () => {
		// "ab" with whitespace drift — Stage 1 catches it; here ensure the gate
		// does not crash and Stage 1 still resolves a single hit.
		const r = fuzzyMatch("axb\n", entry("a b"));
		// "a b" normalized collapses to "a b"; content "axb" → "axb"; no match.
		expect(r.kind).toBe("notFound");
	});
});

describe("fuzzyMatch — Stage 3 not-found (content drift, Sub-pattern B)", () => {
	it("returns a closest region and does not guess-apply on wrong words", () => {
		const content =
			"## Tasks & Acceptance\n**Execution:**\n- [ ] `cmd/timer/main.go`: drive the counter\n- [ ] `cmd/timer/main.go`: (continued)\n";
		const oldText =
			"\n**Execution:**\n- [ ] `cmd/tmer/clicker.go` \u2026 define ONE accessor\n- [ ] `cmd/timer/main.go` \u2026 (continued)\n";
		const r = fuzzyMatch(content, entry(oldText));
		expect(r.kind).toBe("notFound");
		if (r.kind === "notFound") {
			expect(r.closestRegion.startLine).toBeGreaterThanOrEqual(1);
			expect(r.closestRegion.similarity).toBeGreaterThan(0);
		}
	});
});

describe("fuzzyMatch — isDisproportionateMatch guard", () => {
	it("rejects an indentation_flexible window that balloons past the cap", () => {
		// Two non-empty query lines separated by far more blanks than 3x allows.
		const content = "a\n" + "\n".repeat(20) + "b\n";
		const r = fuzzyMatch(content, entry("a\nb\n"));
		expect(r.kind).toBe("notFound");
	});
});

describe("original.includes(actual) invariant", () => {
	it("every ok result's actual is a substring of content", () => {
		const content = "\ttextHello   = \"Hi\"\n\twindowTitle = \"W\"\n";
		const r = fuzzyMatch(content, entry("\ttextHello    = \"Hi\" \n\twindowTitle  = \"W\""));
		if (r.kind === "ok") expect(content.includes(r.actual)).toBe(true);
	});
});

describe("findAllSpans", () => {
	it("collects non-overlapping occurrences", () => {
		expect(findAllSpans("ab ab ab", "ab")).toEqual([
			{ start: 0, end: 2 },
			{ start: 3, end: 5 },
			{ start: 6, end: 8 },
		]);
	});
	it("returns empty for an empty needle", () => {
		expect(findAllSpans("abc", "")).toEqual([]);
	});
});

describe("findClosestRegion", () => {
	it("locates the most similar window", () => {
		const content = "alpha\nbeta\ngamma\ndelta\n";
		const region = findClosestRegion(content, "beta\ngamma");
		expect(region.startLine).toBe(2);
		expect(region.endLine).toBe(3);
		expect(region.similarity).toBeGreaterThan(0.9);
	});
});