/**
 * Pure fuzzy matching utilities for path recovery.
 *
 * Zero dependencies, zero I/O — designed for core inclusion.
 * Catches two garbling patterns observed in LLM tool calls:
 * - Compression: boundary chars kept, middle dropped (`b57b41f7` → `bf7`)
 * - Substitution: middle tokens swapped (`bmad` → `bmock`)
 */

export interface ScoredMatch {
	/** The candidate string that was scored. */
	candidate: string;
	/** Match score 0–1, higher is better. */
	score: number;
}

/**
 * Levenshtein edit distance between two strings.
 * Counts insertions, deletions, and substitutions.
 */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;

	// Rolling arrays for O(min(a,b)) space.
	let prev = new Array<number>(b.length + 1);
	let curr = new Array<number>(b.length + 1);

	for (let j = 0; j <= b.length; j++) prev[j] = j;

	for (let i = 0; i < a.length; i++) {
		curr[0] = i + 1;
		for (let j = 0; j < b.length; j++) {
			const cost = a.charCodeAt(i) === b.charCodeAt(j) ? 0 : 1;
			curr[j + 1] = Math.min(prev[j + 1] + 1, curr[j] + 1, prev[j] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[b.length];
}

/**
 * Length of the common prefix between two strings.
 * Paths typically go wrong in the middle, not the start —
 * a strong prefix match signals path garbling.
 */
export function commonPrefixLength(a: string, b: string): number {
	const max = Math.min(a.length, b.length);
	let i = 0;
	while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
	return i;
}

/**
 * Score how well a candidate matches a requested string (0–1, higher is better).
 *
 * Combines Levenshtein similarity (catches substitutions and compressions)
 * with a prefix bonus (paths go wrong in the middle, not the start).
 */
export function scoreMatch(requested: string, candidate: string): number {
	if (requested === candidate) return 1;
	if (!requested || !candidate) return 0;

	const maxLen = Math.max(requested.length, candidate.length);
	const similarity = 1 - levenshtein(requested, candidate) / maxLen;
	const prefixBonus = (commonPrefixLength(requested, candidate) / maxLen) * 0.2;
	return similarity + prefixBonus;
}

/**
 * Rank candidates by match score, returning the top matches above a threshold.
 */
export function rankCandidates(
	requested: string,
	candidates: string[],
	options?: { maxResults?: number; threshold?: number },
): ScoredMatch[] {
	const maxResults = options?.maxResults ?? 3;
	const threshold = options?.threshold ?? 0.6;

	return candidates
		.map((candidate) => ({ candidate, score: scoreMatch(requested, candidate) }))
		.filter((m) => m.score >= threshold)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults);
}