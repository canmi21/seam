/**
 * What a sample comes out as -- pass, skip or fail -- and the list every run is held to: reading
 * it, judging a run against it, writing a run as it, and printing the result. See spec/suite.md.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Pass, PASSES, SUITES } from './corpus.ts';

const here = dirname(fileURLToPath(import.meta.url));
const need = createRequire(import.meta.url);

/** What every sample has to come out as, kept here and not under `vendor/`. See spec/suite.md. */
export const BASELINE = resolve(here, '../baseline.json');
/** Taken off a reason, so a path in one reads the same on every machine. */
const ROOT = `${resolve(here, '../../..')}/`;

/**
 * A stream of 20 bytes or fewer, which is `<!--[--><!--]-->` and nothing else.
 *
 * A sample that renders to nothing agrees with Svelte, and the two runtime suites hold some because
 * they were written to be driven by a client. The bytes are the same, so it is a pass; this only
 * keeps the outcome apart where it is worth knowing, and `stateOf` reads the two alike.
 *
 * **Both streams, because a sample can render everything it has into the other one.** This read
 * the body alone, and fourteen samples whose whole content is a `<svelte:head>` were filed as
 * saying nothing: every head and title case the corpus has -- which title wins, a block standing
 * in the head stream, a child's head merged into its parent's, the anchor a `$props.id()` writes.
 * They were the only evidence there is for the half of the IR that spec/ir.md records was missed
 * once already by reading the body and not the head.
 */
export const EMPTY = 20;

export type Outcome = 'identical' | 'empty' | 'differs' | 'gap' | 'skipped' | 'oracle';

export interface Result {
	suite: string;
	name: string;
	outcome: Outcome;
	/** Why, for everything but an agreement: the refusal, the skip's reason, the stream that differs. */
	why?: string;
}

/**
 * A refusal is a gap, whatever it says: work nobody has done. No refusal is a skip, because
 * compile-time rendering differs from Svelte's server render only in when the render runs, so
 * nothing Svelte renders is out of this compiler's reach -- and which samples need Svelte's async
 * mode is Svelte's own compiler to say, which the oracle already asks. See spec/suite.md.
 */
export function turned(suite: string, name: string, why: string): Result {
	return { suite, name, outcome: 'gap', why };
}

export type State = 'pass' | 'skip' | 'fail';

/**
 * What an outcome is once it is read against the list: pass, skip or fail.
 *
 * Empty is a pass, since both sides wrote the same bytes. A skip carries whose it is -- `upstream`
 * where the sample's own config says so, `harness` where this runner could not ask the oracle --
 * because a skip nobody can attribute is a number made to look better. See spec/suite.md.
 */
export function stateOf(one: Result): { state: State; reason?: string } {
	switch (one.outcome) {
		case 'identical':
		case 'empty':
			return { state: 'pass' };
		case 'skipped':
			return { state: 'skip', reason: `upstream: ${one.why ?? ''}` };
		case 'oracle':
			return { state: 'skip', reason: `harness: ${(one.why ?? '').replaceAll(ROOT, '')}` };
		case 'differs':
		case 'gap':
			return { state: 'fail', reason: one.why ?? '' };
	}
}

/** One pass's half of the list: which samples pass in it and which are skipped, and why. */
export interface Section {
	pass: string[];
	/** Each skipped sample and why, in the words `stateOf` writes. */
	skip: Record<string, string>;
}

/**
 * The list every run is held to, one section per pass. Both are kept rather than a merge of them,
 * because a sample upstream measures in one render and skips in the other is two facts, and the
 * diff of this file is the account of what moved in which. See spec/suite.md.
 */
export interface Baseline {
	version: 4;
	/** The Svelte the oracle is, since the same corpus renders differently under another one. */
	svelte: string;
	sync: Section;
	async: Section;
}

/** One sample's verdict in one pass: what it came out as, read against what the list says. */
export interface Verdict {
	pass: Pass;
	key: string;
	suite: string;
	state: State;
	/** For a skip, whose it is and why; for a fail, what went wrong. */
	reason?: string;
}

/**
 * Every sample of one pass held to that pass's section, and every name in the section held to the
 * corpus.
 *
 * A skip is checked like a pass: the sample still runs, and a reason that changed -- or a skip that
 * passes now -- fails until the list says so. The list is only as true as the last run that read
 * it. See spec/suite.md.
 */
export function judge(
	pass: Pass,
	results: readonly Result[],
	listed: Section | undefined,
): Verdict[] {
	const passes = new Set(listed?.pass ?? []);
	const skips = new Map(Object.entries(listed?.skip ?? {}));
	const verdicts: Verdict[] = [];
	for (const one of results) {
		const key = keyOf(one);
		const { state, reason } = stateOf(one);
		const wanted = passes.has(key) ? 'pass' : skips.get(key);
		passes.delete(key);
		skips.delete(key);
		const wrong = disagreement(state, reason, wanted);
		verdicts.push(
			wrong === null
				? { pass, key, suite: one.suite, state, ...(reason === undefined ? {} : { reason }) }
				: { pass, key, suite: one.suite, state: 'fail', reason: wrong },
		);
	}
	for (const key of [...passes, ...skips.keys()]) {
		verdicts.push({
			pass,
			key,
			suite: key.slice(0, key.indexOf('/')),
			state: 'fail',
			reason: 'in the baseline, and not in the corpus',
		});
	}
	return verdicts;
}

/** One sample across both passes: what it came out as once the two are merged. See `merged`. */
export interface Merged {
	key: string;
	suite: string;
	state: State;
	/** Each pass's verdict, in pass order. */
	passes: Verdict[];
}

/**
 * The two passes folded into one verdict per sample: a failure in either is a failure, a pass in
 * either is a pass, and a sample both passes skip is a skip. A skip in one pass beside a pass in
 * the other is upstream measuring the sample in one render and not the other, which is a pass --
 * the sample was measured. See spec/suite.md.
 */
export function merged(verdicts: readonly Verdict[]): Merged[] {
	const byKey = new Map<string, Verdict[]>();
	for (const one of verdicts) byKey.set(one.key, [...(byKey.get(one.key) ?? []), one]);
	return [...byKey].map(([key, passes]) => ({
		key,
		suite: passes[0]?.suite ?? '',
		state: passes.some((one) => one.state === 'fail')
			? 'fail'
			: passes.some((one) => one.state === 'pass')
				? 'pass'
				: 'skip',
		passes: PASSES.flatMap((pass) => passes.filter((one) => one.pass === pass)),
	}));
}

/** What is wrong with one sample, or null where it came out as the list says it has to. */
function disagreement(
	state: State,
	reason: string | undefined,
	wanted: string | undefined,
): string | null {
	if (state === 'fail') return reason ?? '';
	if (wanted === undefined) return `not in the baseline; it ${describe(state, reason)}`;
	if (wanted === 'pass') {
		return state === 'pass' ? null : `the baseline has it passing; it ${describe(state, reason)}`;
	}
	return state === 'skip' && reason === wanted
		? null
		: `the baseline skips it, ${wanted}; it ${describe(state, reason)}`;
}

function describe(state: State, reason: string | undefined): string {
	return state === 'pass' ? 'passes' : `is skipped, ${reason ?? ''}`;
}

/** The Svelte the oracle renders with. */
export function svelteVersion(): string {
	const manifest = JSON.parse(readFileSync(need.resolve('svelte/package.json'), 'utf8')) as {
		version: string;
	};
	return manifest.version;
}

export function read(): Baseline | null {
	let text: string;
	try {
		text = readFileSync(BASELINE, 'utf8');
	} catch {
		return null;
	}
	const held = JSON.parse(text) as { version?: unknown };
	if (held.version !== 4) {
		throw new Error(
			`baseline.json is version ${String(held.version)}, and this reads 4: one section per ` +
				'pass, every sample in each. `mise run vendor-baseline -- --write` records it. See spec/suite.md',
		);
	}
	return held as Baseline;
}

/** One pass's run, written as its section: sorted, so a sample that moves is one line in a diff. */
export function section(results: readonly Result[]): Section {
	const pass: string[] = [];
	const skip: Record<string, string> = {};
	for (const one of results.toSorted((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
		const { state, reason } = stateOf(one);
		// A failure is not a state the list has, so a failing sample is left off it. See
		// `--skip-failing`, which is the only way one reaches here.
		if (state === 'pass') pass.push(keyOf(one));
		else if (state === 'skip') skip[keyOf(one)] = reason ?? '';
	}
	return { pass, skip };
}

export function keyOf(one: Result): string {
	return `${one.suite}/${one.name}`;
}

/**
 * The three counts per suite: one table per pass, and the merged one last, since a terminal shows
 * the end of what a command wrote and the merged count is what the run is for.
 */
export function table(verdicts: readonly Verdict[], folded: readonly Merged[]): void {
	const width = Math.max(...SUITES.map((one) => one.length));
	const states: readonly State[] = ['pass', 'skip', 'fail'];
	const row = (name: string, mine: readonly { state: State }[]): string =>
		`${name.padEnd(width)}  ${String(mine.length).padStart(8)}` +
		states
			.map((state) => String(mine.filter((one) => one.state === state).length).padStart(7))
			.join('');
	const head = (title: string): void => {
		console.log(
			`\n${title.padEnd(width)}  ${'samples'.padStart(8)}${states.map((one) => one.padStart(7)).join('')}`,
		);
	};
	for (const pass of PASSES) {
		const mine = verdicts.filter((one) => one.pass === pass);
		head(`${pass} pass`);
		for (const suite of SUITES)
			console.log(
				row(
					suite,
					mine.filter((one) => one.suite === suite),
				),
			);
		console.log(row('total', mine));
	}
	head('merged');
	for (const suite of SUITES)
		console.log(
			row(
				suite,
				folded.filter((one) => one.suite === suite),
			),
		);
	console.log(row('total', folded));
}

/** The failures one at a time with what went wrong, and the skips by reason. */
export function lists(verdicts: readonly Verdict[]): void {
	const failed = verdicts.filter((one) => one.state === 'fail');
	if (failed.length > 0) {
		console.log(`\nfail (${String(failed.length)})`);
		for (const one of failed) console.log(`  ${one.pass} ${one.key}\n      ${one.reason ?? ''}`);
	}
	for (const pass of PASSES) {
		const reasons = new Map<string, number>();
		for (const one of verdicts) {
			if (one.pass !== pass || one.state !== 'skip') continue;
			const said = one.reason ?? '';
			reasons.set(said, (reasons.get(said) ?? 0) + 1);
		}
		if (reasons.size === 0) continue;
		console.log(`\n${pass} pass: skip, by reason; the names are in baseline.json`);
		for (const [reason, many] of [...reasons].toSorted((a, b) => b[1] - a[1])) {
			console.log(`  ${String(many).padStart(4)}  ${reason}`);
		}
	}
}
