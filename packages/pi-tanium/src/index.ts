/**
 * pi-tanium — hardens the file operations a small-model agent depends on.
 *
 * Composes, never reimplements the tool surface: spreads the built-in
 * `read`/`write`/`edit` tool definitions (exported by pi-core) so their
 * `parameters`/`renderCall`/`renderResult`/`promptSnippet` flow through, and
 * overrides only `prepareArguments` + `execute`. Owns only the edit apply
 * orchestration (pi-core throws on >1 occurrence with no `replaceAll` flag, so
 * `replaceAll` cannot be delegated) plus the pure shape/fuzzy/diagnostic/read
 * modules. Reuses pi-core's exported `withFileMutationQueue`,
 * `generateDiffString`, `generateUnifiedPatch`; the internal-only line-ending/
 * BOM/fuzzy helpers are reimplemented in the pure modules.
 *
 * Also keeps `pi-path-recovery`'s path "Did you mean?" guard (recover.ts) for
 * read/write/edit, adds `cat -n` line numbering to `read`, and a soft
 * rewrite-loop guard to `write`.
 */

import { access, constants, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	generateDiffString,
	generateUnifiedPatch,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { applyEdits, detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "#src/edit-apply";
import { type EditEntry, normalizeEdits } from "#src/edit-shape";
import { numberLines } from "#src/read-number";
import { coerceReadArgs } from "#src/read-shape";
import { formatSuggestions, suggestPaths } from "#src/recover";

/** A `write` to an existing large file counts toward the rewrite-loop guard. */
const REWRITE_LOOP_LARGE_LINES = 120;

const writeCounts = new Map<string, number>();

export default function (pi: ExtensionAPI): void {
	pi.registerTool(wrapRead());
	pi.registerTool(wrapWrite());
	pi.registerTool(wrapEdit());
	// The write-count Map is session-scoped: a /reload, new, resume, or fork
	// resets it so the guard does not grow unbounded across session lifecycles.
	pi.on("session_start", () => {
		writeCounts.clear();
	});
}

/** Resolve a path relative to cwd, expanding a bare `~` or `~/...` to the home dir. */
function resolveToCwd(filePath: string, cwd: string): string {
	// Expand only `~` and `~/...`; leave `~user/...` (another user's home) untouched
	// so it isn't mis-expanded to homedir() + "user/...".
	const expanded = filePath === "~" || filePath.startsWith("~/") ? filePath.replace(/^~/, homedir()) : filePath;
	return resolve(cwd, expanded);
}

/** Pre-check a path for garbling; throw with "Did you mean?" suggestions. */
async function guardPath(path: string, cwd: string, checkParent: boolean): Promise<void> {
	if (!path) return;
	const target = checkParent ? resolveToCwd(path, cwd).split("/").slice(0, -1).join("/") || "/" : path;
	const suggestions = await suggestPaths(target, cwd);
	if (suggestions.length > 0) {
		throw new Error(formatSuggestions(target, suggestions));
	}
}

// ── read ───────────────────────────────────────────────────────────────────

function wrapRead() {
	const builtin = createReadToolDefinition(process.cwd());
	return {
		...builtin,
		name: "read" as const,
		promptGuidelines: [
			...(builtin.promptGuidelines ?? []),
			"Output is line-numbered (`cat -n` style). For files >120 lines, read with `offset`/`limit` around the region you need; only read the whole file when you actually need all of it.",
		],
		prepareArguments: (input: unknown) => coerceReadArgs(input),
		async execute(...args: Parameters<typeof builtin.execute>) {
			const [, params, , , ctx] = args;
			await guardPath(params.path, ctx.cwd, false);
			const result = await createReadToolDefinition(ctx.cwd).execute(...args);
			return { ...result, content: numberReadContent(result.content as ToolContent[], params.offset ?? 1) as typeof result.content };
		},
	};
}

/** A read result content entry (TextContent | ImageContent, structural). */
type ToolContent =
	| { type: "text"; text: string; textSignature?: string }
	| { type: "image"; data: string; mimeType: string };

/**
 * Number a `read` result's file-content lines (`cat -n`), preserving pi-core's
 * trailing continuation/error notices verbatim. Image reads are left as-is.
 */
function numberReadContent(content: ToolContent[], startLine: number): ToolContent[] {
	const hasImage = content.some((c) => c.type === "image");
	if (hasImage) return content;
	return content.map((entry) => {
		if (entry.type !== "text") return entry;
		if (entry.text.startsWith("Read image file")) return entry;
		return { ...entry, text: numberReadText(entry.text, startLine) };
	});
}

/** Number file lines, leaving pi-core's trailing continuation/truncation notices verbatim. */
export function numberReadText(text: string, startLine: number): string {
	// pi-core appends notices in two forms: `\n\n[Showing lines …]` (the common
	// continuation hint) and `\n[Truncated: …]` / `\n[First line exceeds …]`.
	// Capture the trailing notice (including its leading newline) and preserve
	// it verbatim, numbering only the file body. (The regex has no capture group
	// issue — `noticeMatch[0]` is the whole notice.)
	const noticeMatch = text.match(/(\n\n|\n)\[[^\n]*\]$/);
	if (noticeMatch) {
		const notice = noticeMatch[0];
		const body = text.slice(0, text.length - notice.length);
		return numberLines(body, startLine) + notice;
	}
	// A whole-output bracketed notice (e.g. first-line-exceeds-limit) has no
	// file content to number.
	if (/^\s*\[[^\n]*\]\s*$/.test(text)) return text;
	return numberLines(text, startLine);
}

// ── write ──────────────────────────────────────────────────────────────────

function wrapWrite() {
	const builtin = createWriteToolDefinition(process.cwd());
	return {
		...builtin,
		name: "write" as const,
		promptGuidelines: [
			...(builtin.promptGuidelines ?? []),
			"If you have already written the same path this session, prefer edit for further changes — repeated full-file writes bloat context.",
		],
		async execute(...args: Parameters<typeof builtin.execute>) {
			const [, params, , , ctx] = args;
			await guardPath(params.path, ctx.cwd, true);
			const absolutePath = resolveToCwd(params.path, ctx.cwd);
			const fileExisted = await pathExists(absolutePath);
			const contentLines = params.content.split("\n").length;
			const count = (writeCounts.get(absolutePath) ?? 0) + 1;

			const result = await createWriteToolDefinition(ctx.cwd).execute(...args);

			// Only count successful writes — a failed/aborted write must not inflate
			// the loop counter (otherwise a later retry falsely trips the guard).
			writeCounts.set(absolutePath, count);
			if (count >= 2 && fileExisted && contentLines > REWRITE_LOOP_LARGE_LINES) {
				const notice =
					`[tanium] ${params.path} has been written ${count} times this session. ` +
					"For further changes, prefer edit over re-writing the whole file — repeated full-file writes bloat context.";
				return {
					...result,
					content: [...result.content, { type: "text" as const, text: notice }],
				};
			}
			return result;
		},
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

// ── edit ────────────────────────────────────────────────────────────────────

const EDIT_GUIDELINE_NEW_BULLETS = [
	"Use edit for surgical changes to existing files. Prefer edit over write whenever the change is smaller than the whole file.",
	"You may pass a single edit `{oldText,newText}` or an array `edits:[\u2026]`. The array-of-objects shape is supported but not required.",
	"oldText is matched after whitespace normalization (tabs/spaces/trailing whitespace are tolerant). If oldText is not unique, set `replaceAll: true` on that edit.",
	"On a not-found error, the tool returns the closest current region with line numbers — copy the real text from that region (or `read` with offset/limit) and re-issue.",
];

/** Custom edit parameter schema: declares per-edit `replaceAll` and an `oldText`
 * description matching the fuzzy/replaceAll contract. The built-in's spread-
 * through schema says oldText "must be unique... non-overlapping" and declares no
 * `replaceAll` — both contradict pi-tanium's behavior, so override `parameters`. */
const TITANIUM_EDIT_SCHEMA = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	edits: Type.Array(
		Type.Object({
			oldText: Type.String({
				description:
					"The text to replace. Matched after whitespace normalization (tabs/spaces/trailing whitespace are tolerant). Must be unique unless `replaceAll` is set.",
			}),
			newText: Type.String({ description: "Replacement text for this targeted edit." }),
			replaceAll: Type.Optional(
				Type.Boolean({ description: "Replace every occurrence of oldText. Default false." }),
			),
		}),
	),
});

const TITANIUM_EDIT_DESCRIPTION =
	"Edit a single file. oldText is matched after whitespace normalization (tabs/spaces/trailing whitespace are tolerant); set `replaceAll: true` on an edit to replace every occurrence. On a not-found error the tool returns the closest current region with line numbers.";

function wrapEdit() {
	const builtin = createEditToolDefinition(process.cwd());
	const inherited = (builtin.promptGuidelines ?? []).filter((g) => !g.includes("must match exactly"));
	return {
		...builtin,
		name: "edit" as const,
		description: TITANIUM_EDIT_DESCRIPTION,
		parameters: TITANIUM_EDIT_SCHEMA,
		promptGuidelines: [...inherited, ...EDIT_GUIDELINE_NEW_BULLETS],
		prepareArguments: (input: unknown) => {
			const builtinPrepare = builtin.prepareArguments ?? ((x: unknown) => x);
			const normalized = normalizeEdits(input, builtinPrepare);
			if ("error" in normalized) {
				// Surface the structured shape error (with its canonical retry example)
				// directly to the model instead of swallowing it into an empty edit
				// list — the I/O matrix promises the canonical form.
				const err = normalized.error;
				throw new Error(
					err.kind === "shape"
						? `${err.message}\nCanonical form: ${err.canonicalExample}`
						: err.message,
				);
			}
			return { path: normalized.path, edits: normalized.edits };
		},
		async execute(...args: Parameters<typeof builtin.execute>) {
			const [, params, signal, , ctx] = args;
			await guardPath(params.path, ctx.cwd, false);
			if (!params.path) {
				throw new Error("edit requires a `path`.");
			}
			const edits = params.edits as EditEntry[];
			if (!Array.isArray(edits) || edits.length === 0) {
				throw new Error("edit requires at least one edit in `edits`.");
			}
			const absolutePath = resolveToCwd(params.path, ctx.cwd);
			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				throwIfAborted();
				try {
					await access(absolutePath, constants.R_OK | constants.W_OK);
				} catch (error) {
					throwIfAborted();
					const detail = error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);
					throw new Error(`Could not edit file: ${params.path}. ${detail}.`);
				}
				throwIfAborted();
				const raw = (await readFile(absolutePath)).toString("utf-8");
				throwIfAborted();
				const { bom, text } = stripBom(raw);
				const ending = detectLineEnding(text);
				const normalizedContent = normalizeToLF(text);
				const applied = applyEdits(normalizedContent, edits);
				if ("error" in applied) {
					throwIfAborted();
					throw new Error(applied.error.message);
				}
				throwIfAborted();
				const restored = restoreLineEndings(applied.content, ending);
				const finalContent = bom + restored;
				await writeFile(absolutePath, finalContent, "utf-8");
				throwIfAborted();
				const diff = generateDiffString(normalizedContent, applied.content);
				const patch = generateUnifiedPatch(params.path, normalizedContent, applied.content);
				const fuzzy = applied.results.some(
					(r) => r.passName !== "exact" && r.passName !== "replace_all",
				);
				const replaced = applied.results.reduce((sum, r) => sum + r.replaced, 0);
				const successText =
					`Successfully replaced ${replaced} block(s) in ${params.path}.` +
					(fuzzy ? "\n[tanium] applied after normalizing whitespace (tab/space/trailing diffs)." : "");
				return {
					content: [{ type: "text" as const, text: successText }],
					details: { diff: diff.diff, patch, firstChangedLine: diff.firstChangedLine },
				};
			});
		},
	};
}