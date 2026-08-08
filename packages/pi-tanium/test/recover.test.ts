import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatSuggestions, suggestPaths } from "#src/recover";

describe("suggestPaths", () => {
	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await mkdtemp(join(tmpdir(), "pi-path-recovery-"));
	});

	afterEach(async () => {
		await rm(tmpRoot, { recursive: true, force: true });
	});

	it("returns no suggestions when path exists", async () => {
		await writeFile(join(tmpRoot, "exists.txt"), "content");
		const suggestions = await suggestPaths(join(tmpRoot, "exists.txt"), tmpRoot);
		expect(suggestions).toHaveLength(0);
	});

	it("suggests correct directory for garbled hex hash", async () => {
		// Simulate the bmad render directory structure
		const parent = join(tmpRoot, "clickgo-e2320812c8a7");
		await mkdir(parent, { recursive: true });
		await mkdir(join(parent, "7b6e94173825b57b41f7"), { recursive: true });
		await mkdir(join(parent, "8ca1d5727e41586f78e1"), { recursive: true });
		await writeFile(join(parent, "7b6e94173825b57b41f7", "workflow.md"), "# Workflow");

		// Model garbles the hash: `7b6e94173825bf7` instead of `7b6e94173825b57b41f7`
		const garbledPath = join(parent, "7b6e94173825bf7", "workflow.md");
		const suggestions = await suggestPaths(garbledPath, tmpRoot);

		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].path).toBe(join(parent, "7b6e94173825b57b41f7", "workflow.md"));
		expect(suggestions[0].score).toBeGreaterThan(0.5);
	});

	it("suggests correct filename for typo", async () => {
		await writeFile(join(tmpRoot, "step-01-clarify-and-route.md"), "content");
		await writeFile(join(tmpRoot, "step-02-plan.md"), "content");

		// Model writes `clarity` instead of `clarify`
		const suggestions = await suggestPaths("step-01-clarity-and-route.md", tmpRoot);
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0].path).toBe(join(tmpRoot, "step-01-clarify-and-route.md"));
	});

	it("returns no suggestions when parent dir has no similar entries", async () => {
		await writeFile(join(tmpRoot, "completely-different.txt"), "content");
		const suggestions = await suggestPaths("not-similar-at-all.md", tmpRoot);
		expect(suggestions).toHaveLength(0);
	});

	it("returns no suggestions when parent dir doesn't exist", async () => {
		const suggestions = await suggestPaths(join(tmpRoot, "nonexistent", "deeply", "nested", "path.md"), tmpRoot);
		// Walks up to tmpRoot (which exists), finds no similar entries to "nonexistent"
		expect(suggestions).toHaveLength(0);
	});
});

describe("formatSuggestions", () => {
	it("formats single suggestion as 'Did you mean?'", () => {
		const result = formatSuggestions("/foo/bar", [
			{ path: "/foo/baz", score: 0.8 },
		]);
		expect(result).toContain("Path not found: /foo/bar");
		expect(result).toContain("Did you mean: /foo/baz?");
	});

	it("formats multiple suggestions as a list", () => {
		const result = formatSuggestions("/foo/bar", [
			{ path: "/foo/baz", score: 0.8 },
			{ path: "/foo/bay", score: 0.6 },
		]);
		expect(result).toContain("Did you mean one of:");
		expect(result).toContain("/foo/baz");
		expect(result).toContain("/foo/bay");
	});

	it("returns empty string for no suggestions", () => {
		expect(formatSuggestions("/foo/bar", [])).toBe("");
	});
});