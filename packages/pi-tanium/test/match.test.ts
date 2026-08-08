import { describe, expect, it } from "vitest";
import { commonPrefixLength, levenshtein, rankCandidates, scoreMatch } from "#src/match";

describe("levenshtein", () => {
	it("returns 0 for identical strings", () => {
		expect(levenshtein("abc", "abc")).toBe(0);
	});

	it("counts single substitution", () => {
		expect(levenshtein("bmad", "bmod")).toBe(1);
	});

	it("counts insertions", () => {
		// Compression recovery: `bf7` → `b57b41f7` requires 5 insertions
		expect(levenshtein("bf7", "b57b41f7")).toBe(5);
	});

	it("counts deletions", () => {
		expect(levenshtein("b57b41f7", "bf7")).toBe(5);
	});

	it("handles empty strings", () => {
		expect(levenshtein("", "abc")).toBe(3);
		expect(levenshtein("abc", "")).toBe(3);
		expect(levenshtein("", "")).toBe(0);
	});
});

describe("commonPrefixLength", () => {
	it("finds shared prefix", () => {
		expect(commonPrefixLength("7b6e94173825bf7", "7b6e94173825b57b41f7")).toBe(13);
	});

	it("returns 0 for no common prefix", () => {
		expect(commonPrefixLength("abc", "xyz")).toBe(0);
	});

	it("returns full length for identical strings", () => {
		expect(commonPrefixLength("hello", "hello")).toBe(5);
	});
});

describe("scoreMatch", () => {
	it("returns 1 for identical strings", () => {
		expect(scoreMatch("abc", "abc")).toBe(1);
	});

	it("returns 0 for empty strings", () => {
		expect(scoreMatch("", "abc")).toBe(0);
		expect(scoreMatch("abc", "")).toBe(0);
	});

	it("scores hex hash compression above threshold", () => {
		// `7b6e94173825bf7` (garbled) vs `7b6e94173825b57b41f7` (correct)
		// levenshtein=5, maxLen=20, similarity=0.75, prefix=13, prefixBonus≈0.13
		const score = scoreMatch("7b6e94173825bf7", "7b6e94173825b57b41f7");
		expect(score).toBeGreaterThan(0.5);
		expect(score).toBeLessThan(1);
	});

	it("scores dissimilar strings below threshold", () => {
		// `7b6e94173825bf7` vs `8ca1d5727e41586f78e1` (completely different hash)
		const score = scoreMatch("7b6e94173825bf7", "8ca1d5727e41586f78e1");
		expect(score).toBeLessThan(0.5);
	});

	it("scores single-char typo high", () => {
		// `workfow.md` (missing 'l') vs `workflow.md`
		const score = scoreMatch("workfow.md", "workflow.md");
		expect(score).toBeGreaterThan(0.8);
	});
});

describe("rankCandidates", () => {
	it("ranks the correct match first among siblings", () => {
		const requested = "7b6e94173825bf7";
		const candidates = ["8ca1d5727e41586f78e1", "7b6e94173825b57b41f7"];
		const ranked = rankCandidates(requested, candidates);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].candidate).toBe("7b6e94173825b57b41f7");
	});

	it("filters out candidates below threshold", () => {
		const requested = "abc";
		const candidates = ["xyz", "def", "abc"];
		const ranked = rankCandidates(requested, candidates);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].candidate).toBe("abc");
		expect(ranked[0].score).toBe(1);
	});

	it("respects maxResults", () => {
		const requested = "ab";
		const candidates = ["ab", "ac", "ad", "ae", "af"];
		const ranked = rankCandidates(requested, candidates, { maxResults: 2 });
		expect(ranked).toHaveLength(2);
	});

	it("returns empty for no matches above threshold", () => {
		const ranked = rankCandidates("zzz", ["aaa", "bbb", "ccc"]);
		expect(ranked).toHaveLength(0);
	});
});