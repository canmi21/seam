/**
 * Replacing spans of a source file, which is how every pass in this compiler edits one.
 *
 * Nothing here parses or regenerates. A pass finds the spans it wants to change and says what goes
 * there, and the text between them is the author's own bytes, unchanged.
 */

/** Where to write, and what to write there, so a render given no data does not evaluate it. */
export type Neutral = [[number, number], string];

/** One replacement in a source file: where it goes, and what goes there. */
export type Edit = [number, number, string];

/**
 * Applies replacements to source text, back to front so the offsets ahead stay valid.
 *
 * **Two edits over the same characters is not a case to resolve, it is a mistake upstream.** It
 * means one place in the file was recorded twice, and applying both writes the second into the
 * middle of the first; what comes out is a file nobody wrote, reported on by Svelte's compiler in
 * terms of the wreckage. That happened once, a destructuring declaring several names being
 * recorded once per name rather than once per place, and it surfaced as an undefined variable
 * naming nothing anybody could act on. So it is refused here instead.
 */
export function apply(text: string, edits: readonly Edit[], offset = 0): string {
	const ordered = [...edits].toSorted((a, b) => b[0] - a[0]);
	for (const [at, [start]] of ordered.entries()) {
		const next = ordered[at + 1];
		if (next !== undefined && next[1] > start) {
			throw new Error(`two edits cover ${next[0]}..${next[1]}, so one place was recorded twice`);
		}
	}

	let out = text;
	for (const [start, end, replacement] of ordered) {
		out = out.slice(0, start - offset) + replacement + out.slice(end - offset);
	}
	return out;
}
