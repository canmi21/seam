/**
 * Svelte's own samples, compiled here and held against Svelte's own render of them.
 *
 * `pkgs/skeleton/src/skeleton.test.ts` is the refusal surface and every case in it was written
 * here, so it measures what somebody thought to write down. This runs the same comparison over a
 * corpus nobody here chose: every sample under `vendor/svelte`, each compiled, injected with
 * the props its own `_config.js` declares, and compared byte for byte -- body and head -- against
 * `render()` of the same component with the same props.
 *
 * **The oracle is `render()` and not the sample's `_expected.html`.** Upstream compares against
 * that file with `assert_html_equal`, which parses both sides and compares trees, so attribute
 * order, insignificant whitespace and the exact anchors do not survive it. Passing upstream's
 * assertion is a weaker claim than the one this protocol makes. See spec/suite.md.
 *
 * **A sample is pass, skip or fail, and `baseline.json` beside this package says which it has to
 * be.** Every sample is run, skipped ones included, and any that disagrees with the list fails --
 * a pass that stopped passing, a skip whose reason changed or that passes now, a sample the list
 * does not name, a name the corpus no longer holds. `--write` records the run as the list, and
 * refuses while anything fails. See spec/suite.md.
 *
 * **`--skip-failing` is the one way past that refusal, and it is for one situation only**: a
 * sample that fails has been decided to be work that is owed rather than a skip, and
 * what else moved still has to be recorded. It writes the list with the failing samples left off
 * it, so they go on failing every run -- as not on the list -- until the work is done. It is not
 * for a failure nobody has read, and not for making `verify` pass: it cannot, by construction.
 */
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { configOf, RUNES, SAMPLES, samplesOf, SERVED, SUITES } from './corpus.ts';
import { ASYNC, NEVER_SETTLED, ours, type Rendered, settling, STAGE, theirs } from './renders.ts';
import {
	BASELINE,
	EMPTY,
	judge,
	keyOf,
	listing,
	lists,
	read,
	type Result,
	stateOf,
	svelteVersion,
	table,
	turned,
} from './verdict.ts';

const need = createRequire(import.meta.url);

/** One sample, staged, compiled, rendered and compared. */
async function attempt(suite: string, name: string): Promise<Result> {
	const from = resolve(SAMPLES, suite, 'samples', name);
	const dir = resolve(STAGE, suite, name);
	mkdirSync(dir, { recursive: true });
	cpSync(from, dir, { recursive: true });

	const config = await configOf(from, dir);
	// **A config this harness cannot read is not a skip, and that is the whole finding.** It used
	// to be filed as one, which put 342 samples in the column spec/suite.md requires to be
	// upstream's own judgement -- nobody skipped them and nobody measured them. There is one left
	// and the rule holds for one the same as for 342: it goes where "neither side answered" goes.
	if (config.broken !== undefined) {
		return {
			suite,
			name,
			outcome: 'oracle',
			why: `its config will not evaluate: ${config.broken}`,
		};
	}
	// The server renders upstream gives the sample, by the mode each is. A sample upstream renders
	// on the server in either mode is measured, in the one render made here; only a sample upstream
	// renders in neither is upstream's skip. See `SERVED` and spec/suite.md.
	const served = (mode: string | undefined): boolean =>
		mode !== undefined &&
		(!Array.isArray(config.mode) || config.mode.includes(mode)) &&
		!(Array.isArray(config.skip_mode) && config.skip_mode.includes(mode));
	const why =
		config.skip === true
			? 'upstream skips it'
			: config.skip_async === true
				? 'upstream skips it in async mode'
				: !(SERVED[suite] ?? []).some(served)
					? Array.isArray(config.mode)
						? `upstream runs it only in ${config.mode.toSorted().join(', ')} mode`
						: 'upstream skips it in server mode'
					: config.error !== undefined
						? 'upstream expects it to error'
						: config.load_compiled === true
							? 'upstream loads its output precompiled'
							: null;
	if (why !== null) return { suite, name, outcome: 'skipped', why };

	// Upstream's own setup, where this process can run it, and before the props, which is upstream's
	// order (`runtime-legacy/shared.ts`): a config's getter may read what its setup made. See
	// `Config.before_test`.
	try {
		config.before_test?.();
	} catch {
		// A hook that wants a DOM is not setup this render can be given, and the oracle says so
		// on its own when the sample then reads what the hook would have set.
	}
	// **A props getter that reaches for upstream's harness is nobody's answer, so it is a harness
	// skip.** Fourteen configs write `get props()`, and most build what they return out of
	// `create_deferred()`, which `STANDS_IN` copies. A helper that is still stubbed throws there
	// rather than inventing a value, and a sample neither side was given the same props for is one
	// nobody measured.
	let props: Record<string, unknown>;
	try {
		props = config.server_props ?? config.props ?? {};
	} catch (error) {
		return {
			suite,
			name,
			outcome: 'oracle',
			why: `its props are the harness's: ${firstLine(error)}`,
		};
	}
	const runes =
		config.compileOptions !== undefined && 'runes' in config.compileOptions
			? config.compileOptions.runes
			: RUNES[suite];
	// Both sides compile in the mode the project would set, ours by reading it the way a project
	// gives it. See `RUNES` and `ASYNC`.
	const compilerOptions = {
		...(runes === undefined ? {} : { runes }),
		...ASYNC,
	};
	if (Object.keys(compilerOptions).length > 0) {
		writeFileSync(
			resolve(dir, 'svelte.config.js'),
			`export default { compilerOptions: ${JSON.stringify(compilerOptions)} };\n`,
		);
	}
	// **Each side has its own deadline, because the two sides not settling are two different
	// outcomes.** An awaited render can wait forever, and one deadline over both sides could not
	// say whose render it was: five samples were filed as the oracle's failure with a note that
	// upstream's own render does not finish either, and measured apart, Svelte's render finished
	// every one of them and this compiler's did not. A build that never settles is this
	// compiler's gap; an oracle that never settles is nobody's answer. See spec/suite.md.
	let mine: Rendered | null = null;
	let refusal: string | null = null;
	try {
		mine = await settling(
			ours(dir, props, config.csp, config.transformError),
			"this compiler's render never settled",
		);
	} catch (error) {
		refusal = firstLine(error);
	}
	let svelte: Rendered;
	try {
		svelte = await settling(
			theirs(dir, props, config.transformError, runes, config.csp),
			NEVER_SETTLED,
		);
	} catch (error) {
		// Neither side's answer: the oracle could not be built or run. Reported apart so it is never
		// read as agreement, and never as a refusal either.
		//
		// **Asked even where this compiler already refused.** It used to be asked second and only
		// where we had an answer, which made every sample the oracle cannot render our gap: fifteen
		// of them, a quarter of what was being ranked as work. A boundary whose body throws needs
		// the `transformError` upstream's harness passes and this one does not; `$: document.title`
		// needs a DOM; two samples exist to raise upstream's own error. None of those is a
		// difference between the two renders, because there is only one render.
		const text = String((error as Error).message);
		// A render that never settled is not asked again with a DOM: that is another deadline
		// spent to learn the same thing.
		if (text === NEVER_SETTLED) return { suite, name, outcome: 'oracle', why: NEVER_SETTLED };
		// **A sample that renders only with a DOM is upstream's environment, not a server's.**
		if (
			await theirs(dir, props, config.transformError, runes, config.csp, true).then(
				() => true,
				() => false,
			)
		) {
			return {
				suite,
				name,
				outcome: 'skipped',
				why: "it renders only with a DOM, which upstream's jsdom environment has and a server has not",
			};
		}
		// **Upstream's own `runtime_error` is upstream saying the render throws, where it is what
		// came out.** That is `error` one word along -- the compiler raising it rather than the
		// renderer -- and it is a skip for the same reason: not our judgement, and no bytes for
		// either side to be held to. Matched against what was thrown rather than taken from the
		// declaration alone, which is the difference between reading upstream and guessing at it:
		// seven samples write the field and six of them render on the server perfectly well, their
		// `runtime_error` being what upstream's *client* test asserts. Skipping on the declaration
		// took those six out of the measurement, which is the one thing this column must not do.
		if (typeof config.runtime_error === 'string' && text.includes(config.runtime_error)) {
			return {
				suite,
				name,
				outcome: 'skipped',
				why: `upstream expects it to throw \`${config.runtime_error}\` while it renders`,
			};
		}
		return { suite, name, outcome: 'oracle', why: firstLine(error) };
	}
	if (mine === null) {
		return turned(suite, name, refusal ?? 'it failed and said nothing');
	}

	if (mine.body !== svelte.body) {
		return { suite, name, outcome: 'differs', why: divergence('body', mine.body, svelte.body) };
	}
	if (mine.head !== svelte.head) {
		return { suite, name, outcome: 'differs', why: divergence('head', mine.head, svelte.head) };
	}
	// What a `hash` policy has to allow, which a server adds to the header. See `Config.csp`.
	const hashes = [mine, svelte].map((one) => JSON.stringify(one.hashes?.script ?? []));
	if (hashes[0] !== hashes[1]) {
		return {
			suite,
			name,
			outcome: 'differs',
			why: `script hashes: ours ${String(hashes[0])}, Svelte's ${String(hashes[1])}`,
		};
	}
	const nothing = svelte.body.length <= EMPTY && svelte.head.length <= EMPTY;
	return { suite, name, outcome: nothing ? 'empty' : 'identical' };
}

/**
 * Where two renders part, as the bytes around it from both sides.
 *
 * The name of a differing sample says nothing about why it differs, and forty of them are read one
 * at a time to be grouped into causes -- which was a second tool until it was this. Anchored at the
 * first byte that disagrees rather than at a whole-string diff: what is wanted is the construct,
 * and the construct is at the seam.
 */
function divergence(stream: string, own: string, svelte: string): string {
	let at = 0;
	while (at < own.length && at < svelte.length && own[at] === svelte[at]) at += 1;
	const from = Math.max(0, at - 40);
	const show = (text: string): string =>
		JSON.stringify(text.slice(from, at + 60)).replaceAll('\\n', ' ');
	return `${stream} at ${String(at)}\n      ours   ${show(own)}\n      svelte ${show(svelte)}`;
}

/**
 * The first line of an error that says something.
 *
 * A bundler's message opens with a banner -- `Build failed with 1 error:` -- and the cause is
 * lines below it, so taking the first line reported twenty-seven samples under one label that
 * names no cause. The banner is skipped and the colour codes a terminal writer put in are taken
 * out, which is what makes the line readable in a file.
 */
function firstLine(error: unknown): string {
	// eslint-disable-next-line no-control-regex
	const text = String((error as Error).message).replaceAll(/\u001B\[[0-9;]*m/g, '');
	for (const line of text.split('\n')) {
		const held = line.trim();
		if (held === '' || /^Build failed with \d+ error/.test(held)) continue;
		return held;
	}
	return 'it failed and said nothing';
}

/**
 * Runs something with the samples' own writing to the terminal swallowed.
 *
 * A sample is a component somebody wrote to exercise Svelte, and several of them log: 127 lines
 * of `0n`, `1n`, `100`, `undefined` came out of the corpus before the table did, which is the one
 * thing a run of this is read for. Upstream's output, not a result, so it goes nowhere. Errors
 * are unaffected: every outcome here is a returned value or a thrown one.
 */
async function quietly<T>(what: () => Promise<T>): Promise<T> {
	const held = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
	Object.assign(console, { log: NOTHING, info: NOTHING, warn: NOTHING, debug: NOTHING });
	try {
		return await what();
	} finally {
		Object.assign(console, held);
	}
}

const NOTHING = (): void => undefined;

/** Every sample of every suite, run in this process. */
async function measure(): Promise<Result[]> {
	// A sample is free to throw from a promise nobody awaits -- several are written to -- and the
	// default is to end the process. The outcome of the sample that did it is already recorded by
	// the time this fires, so the run continues.
	process.on('unhandledRejection', () => undefined);
	// And from a timer, which is the same statement one channel along: `reactive-values-text-node`
	// starts a `setTimeout` in its instance script and calls a method on a prop upstream's own
	// harness builds. Both renders write their bytes and agree; what throws does so five
	// milliseconds later, with nothing left to record. Unguarded it ends the process, which ends
	// the run.
	process.on('uncaughtException', () => undefined);
	rmSync(STAGE, { recursive: true, force: true });
	mkdirSync(resolve(STAGE, 'node_modules'), { recursive: true });
	// The bundled oracle keeps Svelte's own runtime external, so it has to resolve from where it
	// sits.
	symlinkSync(
		dirname(need.resolve('svelte/package.json')),
		resolve(STAGE, 'node_modules/svelte'),
		'dir',
	);
	const results: Result[] = await quietly(async () => {
		const found: Result[] = [];
		for (const suite of SUITES) {
			for (const name of samplesOf(suite)) {
				// Each side's render carries its own deadline; see `settling` in `attempt`.
				found.push(await attempt(suite, name));
			}
		}
		return found;
	});
	rmSync(STAGE, { recursive: true, force: true });
	return results;
}

const results = await measure();
const failing = results.filter((one) => stateOf(one).state === 'fail');

// `--write` records the run as the list, and only a run with nothing failing can be recorded: a
// failure is not a state the list has. Otherwise the run is held to the list. See spec/suite.md.
if (process.argv.includes('--write')) {
	if (failing.length > 0 && !process.argv.includes('--skip-failing')) {
		lists(failing.map((one) => ({ key: keyOf(one), suite: one.suite, ...stateOf(one) })));
		console.log(
			`\n${String(failing.length)} sample(s) fail, and a failure is not something the ` +
				'baseline records. Only where each of them has been decided to be work that is ' +
				'owed, `--write --skip-failing` records the rest and leaves these off the list, ' +
				'where they go on failing until the work is done. See spec/suite.md.',
		);
		process.exit(1);
	}
	writeFileSync(BASELINE, `${JSON.stringify(listing(results), null, '\t')}\n`);
	console.log(
		`\nbaseline.json records ${String(results.length - failing.length)} samples` +
			(failing.length > 0
				? `, and leaves ${String(failing.length)} failing off it: ` +
					failing.map((one) => keyOf(one)).join(', ')
				: '') +
			'.',
	);
	process.exit(0);
}

const listed = read();
const verdicts = judge(results, listed);
const version = svelteVersion();
// The lists first and the table last: a terminal shows the end of what a command wrote, and the
// table is what the run is for. `--table` is the same run with the lists left out.
if (!process.argv.includes('--table')) lists(verdicts);
table(verdicts);

const failed = verdicts.filter((one) => one.state === 'fail').length;
const moved = listed !== null && listed.svelte !== version;
console.log(
	listed === null
		? '\nThere is no baseline.json; `mise run vendor-baseline -- --write` records one.'
		: `\n${String(failed)} sample(s) disagree with baseline.json.` +
				(moved ? ` It was recorded against svelte@${listed.svelte}, and this is ${version}.` : ''),
);
process.exit(failed === 0 && !moved && listed !== null ? 0 : 1);
