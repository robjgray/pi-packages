/**
 * Path recovery IO — finds similar paths when a requested path doesn't exist.
 *
 * Walks up the path to find the deepest existing ancestor, then ranks the
 * ancestor's entries against the first missing (garbled) component.
 * Catches garbling at any depth, not just the filename.
 */

import { access, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath, sep } from "node:path";
import { rankCandidates, type ScoredMatch } from "#src/match";

export interface Suggestion {
	/** Absolute path of the suggested alternative. */
	path: string;
	/** Match score 0–1, higher is better. */
	score: number;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Suggest similar paths when a requested path doesn't exist.
 *
 * Walks up the path to find the deepest existing ancestor, then ranks the
 * ancestor's entries against the first missing component. Returns absolute
 * suggested paths that swap the garbled component for the closest match,
 * preserving the remaining path segments.
 */
export async function suggestPaths(requestedPath: string, cwd: string): Promise<Suggestion[]> {
	const absolute = resolvePath(cwd, requestedPath);

	// If the path exists, no suggestions needed.
	if (await pathExists(absolute)) return [];

	// Walk up to find the deepest existing ancestor and collect missing components.
	let existingParent = dirname(absolute);
	const missingComponents: string[] = [basename(absolute)];

	while (!(await pathExists(existingParent)) && existingParent !== dirname(existingParent)) {
		missingComponents.unshift(basename(existingParent));
		existingParent = dirname(existingParent);
	}

	// missingComponents[0] is the first missing (garbled) component.
	if (missingComponents.length === 0) return [];

	const garbledComponent = missingComponents[0];

	let entries: string[];
	try {
		entries = await readdir(existingParent);
	} catch {
		// Parent can't be read — no suggestions possible.
		return [];
	}

	const matches: ScoredMatch[] = rankCandidates(garbledComponent, entries);
	const remainingPath = missingComponents.slice(1).join(sep);

	return matches.map((m) => ({
		path: remainingPath ? join(existingParent, m.candidate, remainingPath) : join(existingParent, m.candidate),
		score: m.score,
	}));
}

/**
 * Format a "Path not found. Did you mean?" error message for the model.
 */
export function formatSuggestions(requestedPath: string, suggestions: Suggestion[]): string {
	if (suggestions.length === 0) return "";
	const lines = [`Path not found: ${requestedPath}`];
	if (suggestions.length === 1) {
		lines.push(`Did you mean: ${suggestions[0].path}?`);
	} else {
		lines.push("Did you mean one of:");
		for (const s of suggestions) {
			lines.push(`  ${s.path}`);
		}
	}
	return lines.join("\n");
}