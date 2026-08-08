import { writeFile as fsWriteFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import factory, { numberReadText } from "#src/index";

interface Captured {
	registered: Map<string, { name: string; promptGuidelines?: string[]; prepareArguments?: (i: unknown) => unknown; execute: (...args: unknown[]) => Promise<unknown> }>;
	onEvents: string[];
	handlers: Record<string, (...args: unknown[]) => void>;
}

function load(): Captured {
	const registered = new Map();
	const onEvents: string[] = [];
	const handlers: Record<string, (...args: unknown[]) => void> = {};
	const pi = {
		registerTool: (tool: { name: string }) => registered.set(tool.name, tool),
		on: (event: string, handler: (...args: unknown[]) => void) => {
			onEvents.push(event);
			handlers[event] = handler;
		},
	} as unknown as Parameters<typeof factory>[0];
	factory(pi);
	return { registered, onEvents, handlers };
}

function ctx(cwd: string) {
	return { cwd };
}

describe("pi-tanium registration", () => {
	it("overrides read, write, and edit", () => {
		const { registered } = load();
		expect(registered.has("read")).toBe(true);
		expect(registered.has("write")).toBe(true);
		expect(registered.has("edit")).toBe(true);
	});

	it("resets the write-count map on session_start", () => {
		const { onEvents } = load();
		expect(onEvents).toContain("session_start");
	});
});

describe("edit promptGuidelines extend-with-filter", () => {
	it("drops the built-in 'must match exactly' bullet and appends the new contract", () => {
		const { registered } = load();
		const edit = registered.get("edit");
		const guidelines = edit?.promptGuidelines ?? [];
		expect(guidelines.some((g) => g.includes("must match exactly"))).toBe(false);
		expect(guidelines.some((g) => g.includes("replaceAll"))).toBe(true);
		expect(guidelines.some((g) => g.includes("whitespace normalization"))).toBe(true);
		expect(guidelines.some((g) => g.includes("closest current region"))).toBe(true);
	});
});

describe("read/write promptGuidelines extend", () => {
	it("read keeps the built-in bullet and adds the line-numbering guidance", () => {
		const { registered } = load();
		const read = registered.get("read");
		const g = read?.promptGuidelines ?? [];
		expect(g.some((x) => x.includes("cat or sed"))).toBe(true);
		expect(g.some((x) => x.includes("line-numbered"))).toBe(true);
	});
	it("write keeps the built-in bullet and adds the rewrite-loop guidance", () => {
		const { registered } = load();
		const write = registered.get("write");
		const g = write?.promptGuidelines ?? [];
		expect(g.some((x) => x.includes("new files or complete rewrites"))).toBe(true);
		expect(g.some((x) => x.includes("prefer edit"))).toBe(true);
	});
});

describe("edit prepareArguments layering", () => {
	it("unwraps a stringified single object (the §A1 gap)", () => {
		const { registered } = load();
		const edit = registered.get("edit");
		const out = edit?.prepareArguments?.({
			path: "a.txt",
			edits: JSON.stringify({ oldText: "a", newText: "b" }),
		}) as { path: string; edits: { oldText: string; newText: string }[] } | undefined;
		expect(out).toBeDefined();
		expect(out?.edits).toEqual([{ oldText: "a", newText: "b" }]);
	});

	it("throws a shape error with the canonical example for an unparseable edits", () => {
		const { registered } = load();
		const edit = registered.get("edit");
		expect(() => edit?.prepareArguments?.({ path: "a.txt", edits: "{not json" })).toThrow(/Canonical form/);
	});
});

describe("edit end-to-end I/O matrix", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "tanium-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("applies a whitespace-drift edit via Stage 1 with a [tanium] notice", async () => {
		const { registered } = load();
		const edit = registered.get("edit");
		const file = join(dir, "main.go");
		await fsWriteFile(file, "\ttextHello   = \"Hello, World!\"\n\twindowTitle = \"Hello World\"\n", "utf-8");
		const result = (await edit?.execute(
			"id",
			{
				path: file,
				edits: [
					{
						oldText: "\ttextHello    = \"Hello, World!\" \n\twindowTitle  = \"Hello World\"",
						newText: "\ttextHello   = \"Bye\"\n\twindowTitle = \"Bye\"",
					},
				],
			},
			undefined,
			undefined,
			ctx(dir),
		)) as { content: { type: string; text: string }[] };
		expect(result.content[0].text).toContain("Successfully replaced 1 block(s)");
		expect(result.content[0].text).toContain("[tanium]");
		expect(await readFile(file, "utf-8")).toBe("\ttextHello   = \"Bye\"\n\twindowTitle = \"Bye\"\n");
	});

	it("returns a structured not-found error on content drift (does not guess-apply)", async () => {
		const { registered } = load();
		const edit = registered.get("edit");
		const file = join(dir, "spec.md");
		await fsWriteFile(file, "## Tasks\n**Execution:**\n- [ ] `cmd/timer/main.go`: drive the counter\n", "utf-8");
		await expect(
			edit?.execute(
				"id",
				{
					path: file,
					edits: [{ oldText: "## Tasks\n- [ ] `cmd/tmer/clicker.go` \u2026 define ONE", newText: "x" }],
				},
				undefined,
				undefined,
				ctx(dir),
			),
		).rejects.toThrow(/Closest region/);
	});

	it("replaces every occurrence with replaceAll: true", async () => {
		const { registered } = load();
		const edit = registered.get("edit");
		const file = join(dir, "r.txt");
		await fsWriteFile(file, "foo bar foo baz foo", "utf-8");
		await edit?.execute(
			"id",
			{ path: file, edits: [{ oldText: "foo", newText: "qux", replaceAll: true }] },
			undefined,
			undefined,
			ctx(dir),
		) as { content: { type: string; text: string }[] };
		expect(await readFile(file, "utf-8")).toBe("qux bar qux baz qux");
	});
});

describe("read end-to-end", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "tanium-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("prefixes each returned line with a cat -n number", async () => {
		const { registered } = load();
		const read = registered.get("read");
		const file = join(dir, "lines.txt");
		await fsWriteFile(file, "alpha\nbeta\ngamma\n", "utf-8");
		const result = (await read?.execute("id", { path: file }, undefined, undefined, ctx(dir))) as {
			content: { type: string; text: string }[];
		};
		expect(result.content[0].text).toContain("1 | alpha");
		expect(result.content[0].text).toContain("2 | beta");
		expect(result.content[0].text).toContain("3 | gamma");
	});

	it("preserves a \n\n[Showing lines…] continuation notice verbatim (not undefined, not numbered)", () => {
		const numbered = numberReadText("alpha\nbeta\n\n[Showing lines 1-3 of 10. Use offset=4 to continue.]", 1);
		expect(numbered).toContain("1 | alpha");
		expect(numbered).toContain("2 | beta");
		expect(numbered).toContain("[Showing lines 1-3 of 10. Use offset=4 to continue.]");
		expect(numbered).not.toContain("undefined");
		expect(numbered).not.toMatch(/\d+ \| \[Showing/);
	});
	it("preserves a \n[Truncated: …] notice verbatim", () => {
		const numbered = numberReadText("alpha\nbeta\n[Truncated: showing 2 of 100 lines]", 1);
		expect(numbered).toContain("1 | alpha");
		expect(numbered).toContain("2 | beta");
		expect(numbered).toContain("[Truncated: showing 2 of 100 lines]");
		expect(numbered).not.toContain("undefined");
	});
});

describe("write rewrite-loop guard", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "tanium-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("fires a notice on the 3rd write to a large existing file but not the 1st", async () => {
		const { registered } = load();
		const write = registered.get("write");
		const file = join(dir, "big.txt");
		const big = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n") + "\n";
		const r1 = (await write?.execute("id", { path: file, content: big }, undefined, undefined, ctx(dir))) as {
			content: { type: string; text: string }[];
		};
		expect(r1.content.some((c) => c.text.includes("[tanium]"))).toBe(false);
		await write?.execute("id", { path: file, content: big }, undefined, undefined, ctx(dir));
		const r3 = (await write?.execute("id", { path: file, content: big }, undefined, undefined, ctx(dir))) as {
			content: { type: string; text: string }[];
		};
		expect(r3.content.some((c) => c.text.includes("[tanium]"))).toBe(true);
	});

	it("clears the write-count map on session_start (a subsequent write starts fresh)", async () => {
		const { registered, handlers } = load();
		const write = registered.get("write");
		const file = join(dir, "reset.txt");
		const big = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n") + "\n";
		await write?.execute("id", { path: file, content: big }, undefined, undefined, ctx(dir));
		await write?.execute("id", { path: file, content: big }, undefined, undefined, ctx(dir));
		handlers.session_start?.({ type: "session_start", reason: "reload" });
		const after = (await write?.execute("id", { path: file, content: big }, undefined, undefined, ctx(dir))) as {
			content: { type: string; text: string }[];
		};
		expect(after.content.some((c) => c.text.includes("[tanium]"))).toBe(false);
	});
});