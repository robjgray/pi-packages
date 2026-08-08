import { describe, expect, it } from "vitest";
import { applyEdits, detectLineEnding } from "#src/edit-apply";
import type { EditEntry } from "#src/edit-shape";

describe("applyEdits — non-replaceAll via fuzzy match", () => {
	it("applies an exact single edit", () => {
		const out = applyEdits("a\nb\nc", [{ oldText: "b", newText: "B" }]);
		if ("error" in out) throw new Error("expected ok");
		expect(out.content).toBe("a\nB\nc");
		expect(out.results).toHaveLength(1);
		expect(out.results[0].passName).toBe("exact");
	});

	it("applies a whitespace-drift edit via Stage 1", () => {
		const content = "\ttextHello   = \"Hi\"\n";
		const out = applyEdits(content, [{ oldText: "\ttextHello    = \"Hi\" ", newText: "\ttextHello   = \"Bye\"" }]);
		if ("error" in out) throw new Error("expected ok");
		expect(out.content).toBe("\ttextHello   = \"Bye\"\n");
	});
});

describe("applyEdits — replaceAll", () => {
	it("replaces every occurrence", () => {
		const out = applyEdits("foo bar foo baz foo", [{ oldText: "foo", newText: "qux", replaceAll: true }]);
		if ("error" in out) throw new Error("expected ok");
		expect(out.content).toBe("qux bar qux baz qux");
		expect(out.results[0].passName).toBe("replace_all");
		expect(out.results[0].replaced).toBe(3);
	});

	it("returns a not-found error when oldText is absent", () => {
		const out = applyEdits("a\nb\nc", [{ oldText: "z", newText: "Z", replaceAll: true }]);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("not-found");
	});
});

describe("applyEdits — against-original (non-incremental)", () => {
	it("edit 2 is matched against the original, not edit 1's result", () => {
		const content = "alpha\nbeta\n";
		const edits: EditEntry[] = [
			{ oldText: "alpha", newText: "ALPHA" },
			{ oldText: "beta", newText: "BETA" },
		];
		const out = applyEdits(content, edits);
		if ("error" in out) throw new Error("expected ok");
		expect(out.content).toBe("ALPHA\nBETA\n");
	});

	it("detects overlapping edits", () => {
		const out = applyEdits("abcde", [
			{ oldText: "bcd", newText: "X" },
			{ oldText: "cde", newText: "Y" },
		]);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("overlap");
	});
});

describe("applyEdits — no-op and empty", () => {
	it("reports no-change when the replacement is identical", () => {
		const out = applyEdits("a\nb\n", [{ oldText: "a", newText: "a" }]);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("no-change");
	});

	it("reports a shape error for empty oldText", () => {
		const out = applyEdits("a\nb\n", [{ oldText: "", newText: "x" }]);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("shape");
	});
});

describe("applyEdits — not-unique (no replaceAll)", () => {
	it("returns a not-unique error for multiple occurrences and applies nothing", () => {
		const out = applyEdits("foo\nbar\nfoo", [{ oldText: "foo", newText: "qux" }]);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("not-unique");
	});
});

describe("detectLineEnding — dominant by count", () => {
	it("returns LF for a mostly-LF file even if the first newline is CRLF", () => {
		expect(detectLineEnding("crlf\r\nlf\nlf\nlf\n")).toBe("\n");
	});
	it("returns CRLF for a mostly-CRLF file", () => {
		expect(detectLineEnding("a\r\nb\r\nc\r\nd\n")).toBe("\r\n");
	});
	it("returns LF when there are no line endings", () => {
		expect(detectLineEnding("no newlines here")).toBe("\n");
	});
});

describe("applyEdits — not-found diagnostics", () => {
	it("returns a not-found error naming the closest region", () => {
		const content = "## Tasks\n**Execution:**\n- [ ] `cmd/timer/main.go`: drive the counter\n";
		const out = applyEdits(content, [
			{ oldText: "## Tasks\n- [ ] `cmd/tmer/clicker.go` … define ONE", newText: "x" },
		]);
		expect("error" in out).toBe(true);
		if (!("error" in out)) return;
		expect(out.error.kind).toBe("not-found");
		if (out.error.kind === "not-found") {
			expect(out.error.message).toContain("Closest region");
			expect(out.error.readSuggestion.offset).toBeGreaterThanOrEqual(1);
		}
	});
});