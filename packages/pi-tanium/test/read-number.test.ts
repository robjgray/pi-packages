import { describe, expect, it } from "vitest";
import { numberLines } from "#src/read-number";

describe("numberLines", () => {
	it("prefixes each line with a cat -n number separated by ' | '", () => {
		expect(numberLines("a\nb\nc")).toBe("1 | a\n2 | b\n3 | c");
	});

	it("right-aligns numbers to the width of the largest line number", () => {
		const out = numberLines("a\nb\nc\nd\ne\nf\ng\nh\ni\nj");
		expect(out.startsWith(" 1 | a")).toBe(true);
		expect(out).toContain("10 | j");
	});

	it("honors startLine for offset reads", () => {
		expect(numberLines("a\nb", 42)).toBe("42 | a\n43 | b");
	});

	it("right-aligns using startLine width", () => {
		const out = numberLines("a\nb\nc", 98);
		expect(out.startsWith(" 98 | a")).toBe(true);
		expect(out).toContain("100 | c");
	});

	it("preserves a single trailing newline without inventing an extra numbered line", () => {
		expect(numberLines("a\nb\n")).toBe("1 | a\n2 | b\n");
	});

	it("handles an empty string", () => {
		expect(numberLines("")).toBe("");
	});
});