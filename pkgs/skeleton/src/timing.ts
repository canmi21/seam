/**
 * Where a compile spends its time, by stage, printed when `SEAM_TIME` is set.
 *
 * A compile is a walk, a render, Svelte's codegen, a module load and a bundle, nested inside one
 * another, and which of them costs what is not guessable from the outside: two readings of the
 * same trace pointed at two different stages, and a CPU sample could not symbolise the JavaScript
 * frames to settle it. So each stage is measured where it runs, and the numbers are the ones that
 * decide what to make faster. See spec/build.md.
 *
 * Wall time, and nested stages overlap on purpose: `render` holds the `codegen` and `load` inside
 * it, so a stage's share of its parent is what the report is read for rather than a total.
 */
const spent = new Map<string, { ms: number; calls: number }>();

/** Runs the given work, adding what it took to the named stage. */
export async function timed<T>(stage: string, work: () => Promise<T>): Promise<T> {
	const from = performance.now();
	try {
		return await work();
	} finally {
		add(stage, performance.now() - from);
	}
}

/** The synchronous form, for a stage that is not a promise. */
export function timedSync<T>(stage: string, work: () => T): T {
	const from = performance.now();
	try {
		return work();
	} finally {
		add(stage, performance.now() - from);
	}
}

function add(stage: string, ms: number): void {
	const held = spent.get(stage) ?? { ms: 0, calls: 0 };
	held.ms += ms;
	held.calls += 1;
	spent.set(stage, held);
}

/** What each stage took, longest first, and how many times it ran. Empty when nothing was timed. */
export function timings(): string {
	if (spent.size === 0) return '';
	const rows = [...spent].sort(([, a], [, b]) => b.ms - a.ms);
	const width = Math.max(...rows.map(([stage]) => stage.length));
	return rows
		.map(
			([stage, { ms, calls }]) =>
				`  ${stage.padEnd(width)}  ${(ms / 1000).toFixed(1).padStart(8)}s  ${String(calls).padStart(6)} call(s)`,
		)
		.join('\n');
}

/** Forgets what was measured, so one process timing two compiles reports them apart. */
export function forgetTimings(): void {
	spent.clear();
}
