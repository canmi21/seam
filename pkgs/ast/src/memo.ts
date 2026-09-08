/**
 * A pure pass over a source, asked once per source rather than once per walk.
 *
 * The walk runs once per render and a route renders hundreds of times, so every question asked of
 * a component is asked hundreds of times about the same characters. Measured on one route of a
 * real application: Svelte's parser ran 107,424 times over 1,461 distinct sources -- 561MB of text
 * parsed to produce 115MB of answers -- and `descend()` alone parsed each component it enters
 * eleven times over, once for each pass that reads it.
 *
 * The passes below hand back a string, a record of names or a list of statements, never a tree, so
 * what a memo holds is bounded by the number of distinct sources a compile meets and each entry is
 * the size of its answer. That is the difference between this and the memo `parsedComponent`
 * refuses: a whole component's tree is megabytes and this is not. See spec/build.md.
 *
 * The answer is handed out shared, which is sound for the same reason the trees are: nothing
 * writes into one. A pass that ever needs to change what it was given has to copy it first.
 */
const registered: (() => number)[] = [];

/** The given pass, run once per distinct source. */
export function bySource<T>(compute: (source: string) => T): (source: string) => T {
	const held = new Map<string, T>();
	registered.push(() => held.size);
	return (source) => {
		if (held.has(source)) return held.get(source) as T;
		const answer = compute(source);
		held.set(source, answer);
		return answer;
	};
}

/** How many answers the source memos hold, across every pass that uses one. */
export function rememberedSources(): number {
	return registered.reduce((sum, size) => sum + size(), 0);
}
