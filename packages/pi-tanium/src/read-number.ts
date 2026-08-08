/**
 * read-number — `cat -n` line numbering for `read` output.
 *
 * Pure (no I/O, no pi imports). The one genuinely novel read piece: no audited
 * package numbers read output, and pi-core returns raw lines. Numbering makes
 * the output self-describing so the model can quote exact regions into
 * `edit.oldText` and so edit's Stage 3 line refs map 1:1 to what `read` returns.
 */

/**
 * Prefix each line with its `cat -n`-style number: right-aligned to the width of
 * the largest line number, followed by ` | `.
 *
 * `startLine` is the file line number of the first line (for `offset` reads).
 */
export function numberLines(text: string, startLine = 1): string {
	const lines = text.split("\n");
	// A trailing empty element from a final newline is not a real line — drop it
	// so `cat -n` does not invent an extra numbered blank line.
	const last = lines[lines.length - 1];
	const hasTrailingNewline = last === "";
	const real = hasTrailingNewline ? lines.slice(0, -1) : lines;
	if (real.length === 0) return hasTrailingNewline ? "" : "";
	const lastNum = startLine + real.length - 1;
	const width = String(lastNum).length;
	const out = real.map((line, i) => `${String(startLine + i).padStart(width, " ")} | ${line}`);
	return out.join("\n") + (hasTrailingNewline ? "\n" : "");
}