/**
 * pi-path-recovery — wraps read/write/edit with fuzzy path recovery.
 *
 * When the model garbles a path (e.g. compresses a hex hash: `b57b41f7` → `bf7`),
 * the built-in tools either throw a bare ENOENT (read/edit) or silently create
 * wrong directories (write). This extension intercepts those cases and returns
 * "Did you mean?" suggestions so the model can retry with the correct path
 * instead of looping.
 *
 * Registers tools named `read`, `write`, `edit` that override the built-ins
 * via same-name registration (first registration per name wins in pi's merge).
 * Each wrapper pre-checks the path, throws with suggestions if garbled, then
 * delegates to the built-in tool's execute.
 */

import { dirname } from "node:path";
import { createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSuggestions, suggestPaths } from "#src/recover";

export default function (pi: ExtensionAPI): void {
	pi.registerTool(wrapRead());
	pi.registerTool(wrapWrite());
	pi.registerTool(wrapEdit());
}

/**
 * Pre-check a path for garbling. Throws with "Did you mean?" suggestions
 * if the path doesn't exist and a close match is found in the parent.
 */
async function guardPath(path: string, cwd: string, checkParent: boolean): Promise<void> {
	if (!path) return;
	const target = checkParent ? dirname(path) : path;
	const suggestions = await suggestPaths(target, cwd);
	if (suggestions.length > 0) {
		throw new Error(formatSuggestions(target, suggestions));
	}
}

function wrapRead() {
	const builtin = createReadToolDefinition(process.cwd());
	return {
		...builtin,
		name: "read" as const,
		async execute(...args: Parameters<typeof builtin.execute>) {
			const [, params, , , ctx] = args;
			await guardPath(params.path, ctx.cwd, false);
			return createReadToolDefinition(ctx.cwd).execute(...args);
		},
	};
}

function wrapWrite() {
	const builtin = createWriteToolDefinition(process.cwd());
	return {
		...builtin,
		name: "write" as const,
		async execute(...args: Parameters<typeof builtin.execute>) {
			const [, params, , , ctx] = args;
			// Check the parent directory — prevents silent wrong-directory creation
			// when the model garbles a directory name in the write path.
			await guardPath(params.path, ctx.cwd, true);
			return createWriteToolDefinition(ctx.cwd).execute(...args);
		},
	};
}

function wrapEdit() {
	const builtin = createEditToolDefinition(process.cwd());
	return {
		...builtin,
		name: "edit" as const,
		async execute(...args: Parameters<typeof builtin.execute>) {
			const [, params, , , ctx] = args;
			await guardPath(params.path, ctx.cwd, false);
			return createEditToolDefinition(ctx.cwd).execute(...args);
		},
	};
}