import { describe, expect, it } from "vitest";
import { coerceReadArgs } from "#src/read-shape";

describe("coerceReadArgs", () => {
	it("coerces string offset/limit to numbers", () => {
		expect(coerceReadArgs({ path: "a.txt", offset: "42", limit: "10" })).toEqual({
			path: "a.txt",
			offset: 42,
			limit: 10,
		});
	});

	it("leaves numeric offset/limit as numbers", () => {
		expect(coerceReadArgs({ path: "a.txt", offset: 5, limit: 7 })).toEqual({
			path: "a.txt",
			offset: 5,
			limit: 7,
		});
	});

	it("drops invalid (non-numeric) offset/limit to undefined", () => {
		expect(coerceReadArgs({ path: "a.txt", offset: "abc", limit: "" })).toEqual({ path: "a.txt" });
	});

	it("passes path through unchanged and floors fractional offsets", () => {
		expect(coerceReadArgs({ path: "x/y.go", offset: 3.9 })).toEqual({ path: "x/y.go", offset: 3 });
	});

	it("clamps offset/limit to a minimum of 1", () => {
		expect(coerceReadArgs({ path: "a", offset: 0, limit: -3 })).toEqual({ path: "a", offset: 1, limit: 1 });
	});

	it("returns a fresh object and never mutates the input", () => {
		const input = { path: "a.txt", offset: "3" };
		const out = coerceReadArgs(input);
		expect(input).toEqual({ path: "a.txt", offset: "3" });
		expect(out).not.toBe(input);
	});

	it("handles non-object input", () => {
		expect(coerceReadArgs(null)).toEqual({ path: "" });
	});
});