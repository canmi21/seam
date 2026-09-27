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
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
	configOf,
	type Pass,
	PASSES,
	RUNES,
	SAMPLES,
	samplesOf,
	SERVED,
	SUITES,
} from './corpus.ts';
import { asyncOption, NEVER_SETTLED, ours, type Rendered, settling, theirs } from './renders.ts';
import {
	type Baseline,
	BASELINE,
	EMPTY,
	judge,
	keyOf,
	lists,
	merged,
	read,
	type Result,
	section,
	stateOf,
	svelteVersion,
	table,
	turned,
} from './verdict.ts';

const need = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/** A `--name=value` argument, or undefined where none was given. */
function argument(name: string): string | undefined {
	return process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/**
 * Which pass this process measures, or none where it is the parent that runs both and holds them
 * to the list.
 *
 * **One pass per process**: Svelte's async flag is turned on by importing a compiled component that
 * asks for it, and nothing turns it off, so the synchronous render and the async one cannot share a
 * process. `sync` is the render a project without `experimental.async` gets, `async` the one a
 * project with it gets; upstream measures both. See spec/suite.md.
 */
const PASS = argument('pass') as Pass | undefined;

/**
 * A substring of the sample names to measure, for reading one failure at a time; every sample
 * otherwise. A run so narrowed cannot be written as the list, since it measured nothing else.
 */
const ONLY = argument('only');

/**
 * Where a sample is copied to before it is compiled, one directory per pass since the two run at
 * once.
 *
 * Copied rather than read in place, because both halves write beside the component -- `skeleton()`
 * stages Svelte's compiled output next to it and the oracle writes its bundle there -- and the
 * vendored files are upstream's, unedited. `.build*` is ignored by name.
 */
const STAGE = resolve(here, `../.build-suite-${PASS ?? 'results'}`);

/** Why one pass skips a sample that is the other's to measure, in each direction. */
const ONLY_ASYNC =
	'upstream renders it on the server only with `experimental.async`, which the async pass measures';
const ONLY_SYNC =
	'upstream renders it on the server only without `experimental.async`, which the sync pass measures';

/** One sample, staged, compiled, rendered and compared, in one pass. */
async function attempt(pass: Pass, suite: string, name: string): Promise<Result> {
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
	// **A sample is skipped in a pass exactly where upstream skips it in that render, and nowhere
	// else.** The server render each pass makes has a name in each runner's vocabulary (`SERVED`);
	// a sample whose `mode` leaves that name out, or whose `skip_mode` names it, is upstream's skip
	// in this pass. `skip_no_async` and a directory named `async-*` (`async*` in the SSR suite) are
	// upstream's word that a sample runs only with the flag, and `skip_async` the reverse; the
	// legacy suite has no async render at all. A sample upstream renders in the other pass alone
	// is skipped here saying so, and measured there. See spec/suite.md.
	const modes = SERVED[suite];
	const mode = modes?.[pass] ?? null;
	const served = (): boolean =>
		mode !== null &&
		(!Array.isArray(config.mode) || config.mode.includes(mode)) &&
		!(Array.isArray(config.skip_mode) && config.skip_mode.includes(mode));
	const other = modes?.[pass === 'sync' ? 'async' : 'sync'] ?? null;
	const servedOther = (): boolean =>
		other !== null &&
		(!Array.isArray(config.mode) || config.mode.includes(other)) &&
		!(Array.isArray(config.skip_mode) && config.skip_mode.includes(other));
	// Upstream's word that a sample runs only with the flag applies where upstream has a run without
	// it: the runes suite, whose no-async pass reads `skip_no_async` and the `async-` name, and the
	// SSR suite, whose `sync` variant leaves `async*` out. The legacy suite is compiled without the
	// flag whatever the pass, and every sample of it runs there.
	const asyncOnly =
		suite === 'server-side-rendering'
			? name.startsWith('async')
			: suite === 'runtime-runes' && (config.skip_no_async === true || name.startsWith('async-'));
	const why =
		config.skip === true
			? 'upstream skips it'
			: pass === 'async' && mode === null
				? 'upstream never renders the legacy suite with `experimental.async`'
				: pass === 'async' && config.skip_async === true
					? 'upstream skips it with `experimental.async`'
					: pass === 'sync' && asyncOnly
						? ONLY_ASYNC
						: !served()
							? servedOther()
								? pass === 'sync'
									? ONLY_ASYNC
									: ONLY_SYNC
								: Array.isArray(config.mode)
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
	// gives it: `runes` per suite, and `experimental.async` in the async pass alone. See `RUNES`
	// and `asyncOption`.
	const compilerOptions = {
		...(runes === undefined ? {} : { runes }),
		...asyncOption(pass === 'async'),
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
	// The oracle's own props, from its own evaluation of the config: a render can write into what it
	// was given, and what this compiler's render wrote must not reach Svelte's. See `configOf`.
	const oracleConfig = await config.again();
	try {
		oracleConfig.before_test?.();
	} catch {
		// As above: a hook that wants a DOM says so on its own.
	}
	let theirProps: Record<string, unknown>;
	try {
		theirProps = oracleConfig.server_props ?? oracleConfig.props ?? {};
	} catch (error) {
		return {
			suite,
			name,
			outcome: 'oracle',
			why: `its props are the harness's: ${firstLine(error)}`,
		};
	}
	let svelte: Rendered;
	try {
		svelte = await settling(
			theirs(dir, theirProps, config.transformError, runes, config.csp, false, pass === 'async'),
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
		// **A sample Svelte's own compiler will not build without the flag is the async pass's**,
		// whatever this compiler said of it: the oracle is upstream's judgement that the sample is
		// async Svelte, and the sync pass is the render without it. Both spellings of the message.
		if (pass === 'sync' && /experimental[._]async/.test(text)) {
			return { suite, name, outcome: 'skipped', why: ONLY_ASYNC };
		}
		// **A sample that renders only with a DOM is upstream's environment, not a server's.**
		if (
			await theirs(
				dir,
				theirProps,
				config.transformError,
				runes,
				config.csp,
				true,
				pass === 'async',
			).then(
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
	// A throw that is not an error -- a string, as a sample throws on purpose -- is its own text.
	const message = typeof error === 'object' && error !== null ? (error as Error).message : error;
	// eslint-disable-next-line no-control-regex
	const text = String(message).replaceAll(/\u001B\[[0-9;]*m/g, '');
	let said = 'it failed and said nothing';
	for (const line of text.split('\n')) {
		const held = line.trim();
		if (held === '' || /^Build failed with \d+ error/.test(held)) continue;
		said = held;
		break;
	}
	// And what it was caused by, where the error says: a derivation that failed names the source
	// that threw and carries the throw as its cause, which is the half that says what went wrong.
	const cause = (error as { cause?: unknown } | null)?.cause;
	return cause === undefined ? said : `${said}; caused by: ${firstLine(cause)}`;
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

/** One pass, run in this process, its results written where the parent reads them. */
async function measure(pass: Pass, out: string): Promise<void> {
	// A sample is free to throw from a promise nobody awaits -- several are written to -- and the
	// default is to end the process. The outcome of the sample that did it is already recorded by
	// the time this fires, so the run continues. Only here, where samples run: the parent's own
	// errors are its errors.
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
				if (ONLY !== undefined && !name.includes(ONLY)) continue;
				// Each side's render carries its own deadline; see `settling` in `attempt`.
				found.push(await attempt(pass, suite, name));
			}
		}
		return found;
	});
	writeFileSync(out, JSON.stringify(results));
	rmSync(STAGE, { recursive: true, force: true });
}

/** Both passes, each in a process of its own and the two at once, read back when they are done. */
async function both(): Promise<Record<Pass, Result[]>> {
	mkdirSync(STAGE, { recursive: true });
	const one = (pass: Pass): Promise<[Pass, Result[]]> => {
		const out = resolve(STAGE, `${pass}.json`);
		return new Promise((settle, fail) => {
			const child = spawn(
				process.execPath,
				[
					...process.execArgv,
					fileURLToPath(import.meta.url),
					`--pass=${pass}`,
					`--out=${out}`,
					...(ONLY === undefined ? [] : [`--only=${ONLY}`]),
				],
				{ stdio: ['ignore', 'ignore', 'inherit'] },
			);
			child.on('error', fail);
			child.on('exit', (code) => {
				if (code !== 0) {
					fail(new Error(`the ${pass} pass exited ${String(code)}`));
					return;
				}
				settle([pass, JSON.parse(readFileSync(out, 'utf8')) as Result[]]);
			});
		});
	};
	const found = Object.fromEntries(await Promise.all(PASSES.map(one))) as Record<Pass, Result[]>;
	rmSync(STAGE, { recursive: true, force: true });
	return found;
}

if (PASS !== undefined) {
	const out = argument('out');
	if (out === undefined) throw new Error('a pass is run by the parent, which names `--out`');
	await measure(PASS, out);
	process.exit(0);
}

const results = await both();
const all = PASSES.flatMap((pass) => results[pass].map((one) => ({ pass, one })));
const failing = all.filter(({ one }) => stateOf(one).state === 'fail');

// `--write` records the run as the list, and only a run with nothing failing can be recorded: a
// failure is not a state the list has. Otherwise the run is held to the list. See spec/suite.md.
if (process.argv.includes('--write')) {
	if (ONLY !== undefined)
		throw new Error('a run narrowed by `--only` measured nothing else, and is not the list');
	if (failing.length > 0 && !process.argv.includes('--skip-failing')) {
		lists(
			failing.map(({ pass, one }) => ({
				pass,
				key: keyOf(one),
				suite: one.suite,
				...stateOf(one),
			})),
		);
		console.log(
			`\n${String(failing.length)} sample run(s) fail, and a failure is not something the ` +
				'baseline records. Only where each of them has been decided to be work that is ' +
				'owed, `--write --skip-failing` records the rest and leaves these off the list, ' +
				'where they go on failing until the work is done. See spec/suite.md.',
		);
		process.exit(1);
	}
	const held: Baseline = {
		version: 4,
		svelte: svelteVersion(),
		sync: section(results.sync),
		async: section(results.async),
	};
	writeFileSync(BASELINE, `${JSON.stringify(held, null, '\t')}\n`);
	console.log(
		`\nbaseline.json records ${String(all.length - failing.length)} sample runs across both passes` +
			(failing.length > 0
				? `, and leaves ${String(failing.length)} failing off it: ` +
					failing.map(({ pass, one }) => `${pass} ${keyOf(one)}`).join(', ')
				: '') +
			'.',
	);
	process.exit(0);
}

const listed = read();
const verdicts = PASSES.flatMap((pass) => judge(pass, results[pass], listed?.[pass]));
const folded = merged(verdicts);
const version = svelteVersion();
// The lists first and the tables last: a terminal shows the end of what a command wrote, and the
// merged table is what the run is for. `--table` is the same run with the lists left out.
if (!process.argv.includes('--table')) lists(verdicts);
table(verdicts, folded);

const failed = folded.filter((one) => one.state === 'fail').length;
const moved = listed !== null && listed.svelte !== version;
console.log(
	listed === null
		? '\nThere is no baseline.json; `mise run vendor-baseline -- --write` records one.'
		: `\n${String(failed)} sample(s) disagree with baseline.json.` +
				(moved ? ` It was recorded against svelte@${listed.svelte}, and this is ${version}.` : ''),
);
process.exit(failed === 0 && !moved && listed !== null ? 0 : 1);
