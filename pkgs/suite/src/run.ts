/**
 * Svelte's own samples, compiled here and held against Svelte's own render of them.
 *
 * `pkgs/skeleton/src/skeleton.test.ts` is the refusal surface and every case in it was written
 * here, so it measures what somebody thought to write down. This runs the same comparison over a
 * corpus nobody here chose: the 2388 samples under `vendor/svelte`, each compiled, injected with
 * the props its own `_config.js` declares, and compared byte for byte -- body and head -- against
 * `render()` of the same component with the same props.
 *
 * **The oracle is `render()` and not the sample's `_expected.html`.** Upstream compares against
 * that file with `assert_html_equal`, which parses both sides and compares trees, so attribute
 * order, insignificant whitespace and the exact anchors do not survive it. Passing upstream's
 * assertion is a weaker claim than the one this protocol makes. See spec/suite.md.
 *
 * **It fails when a sample compiled and wrote the wrong bytes, and only then.** A refusal stopped
 * a build and named a specification file, so the author knows; a difference shipped bytes nobody
 * asked for, and the whole claim here is that the bytes are Svelte's. The refusals are printed as
 * a list, ranked elsewhere -- spec/roadmap.md -- rather than counted as failures.
 *
 * Run by `mise run suite`, apart from `verify`: a check that cannot pass stops being read, and
 * every commit would carry it. It joins the gate when the count that differs reaches zero, at
 * which point its condition becomes a regression check. See spec/suite.md.
 */
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { compile as compileComponent, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import { carry } from 'carry';
import { joined, merged, structures } from 'compiler';
import { compile as compileDerivations } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';

const here = dirname(fileURLToPath(import.meta.url));
/** The vendored corpus, at the tag `vendor/svelte/VENDOR.md` pins. */
const SAMPLES = resolve(here, '../../../vendor/svelte/tests');
/**
 * Where a sample is copied to before it is compiled.
 *
 * Copied rather than read in place, because both halves write beside the component -- `skeleton()`
 * stages Svelte's compiled output next to it and the oracle writes its bundle there -- and the
 * vendored files are upstream's, unedited. `.build*` is ignored by name.
 */
const STAGE = resolve(here, '../.build-suite');

/**
 * The suites whose assertions a server render can be held to, and what each was written for.
 *
 * Only the first is about server bytes. The two runtime suites are the client's, repurposed: both
 * sides are handed the same props and the server render is what is compared. They are in because
 * they found most of what was wrong -- 97 of the 115 samples that compiled and wrote the wrong
 * bytes the first time this ran were theirs. See spec/suite.md.
 */
const SUITES = ['server-side-rendering', 'runtime-runes', 'runtime-legacy'] as const;

/**
 * A stream of 20 bytes or fewer, which is `<!--[--><!--]-->` and nothing else.
 *
 * A sample that renders to nothing agrees with Svelte for a reason that says nothing about the
 * compiler, and the two runtime suites hold some because they were written to be driven by a
 * client. Counted apart rather than dropped: they are agreements, just not evidence.
 *
 * **Both streams, because a sample can render everything it has into the other one.** This read
 * the body alone, and fourteen samples whose whole content is a `<svelte:head>` were filed as
 * saying nothing: every head and title case the corpus has -- which title wins, a block standing
 * in the head stream, a child's head merged into its parent's, the anchor a `$props.id()` writes.
 * They were the only evidence there is for the half of the IR that spec/ir.md records was missed
 * once already by reading the body and not the head.
 */
const EMPTY = 20;

/**
 * What upstream's own `_config.js` says about a sample, read rather than judged.
 *
 * A sample is skipped here only where upstream skips it: `skip` outright, a `mode` upstream does
 * not run on the server, an `error` the sample is written to produce, or output it loads
 * precompiled. Nothing else is skipped, because a skip nobody upstream asked for is a number made
 * to look better. `props` is what both sides are handed.
 *
 * **`mode` is a list of the modes upstream runs the sample in, and `skip_mode` a list of the ones
 * it leaves out.** The modes are `client`, `hydrate`, `server`, `async` and `async-server`; the
 * one this suite is, is `server`. This used to read `mode` for `sync`, which is not a mode any
 * sample names, so the test was true wherever `mode` was written at all and every sample carrying
 * one was skipped -- twenty of them server tests upstream runs, `head-payload-validation` among
 * them, saying `mode: ['server']` in as many words. A condition that cannot be false does not
 * fail; it makes the denominator smaller and says nothing.
 *
 * **What a sample says about how to render it is read too, and two fields were not.** A sample
 * whose own config names what the render needs is not a sample the oracle cannot render; it is one
 * this harness did not read. `transformError` is the larger of the two: `Renderer`'s constructor
 * defaults it to a function that rethrows, and `boundary()` calls it where the children throw, so
 * without the sample's own the throw escapes and both sides come back with nothing. Eight samples
 * write one, and every one of them was counted as the oracle's failure and taken out of the
 * denominator. `runtime_error` is upstream saying the sample is written to throw at run time,
 * which is `error` one word along and is a skip for the same reason.
 */
interface Config {
	skip?: boolean;
	mode?: string[];
	skip_mode?: string[];
	error?: unknown;
	/** Upstream's own: the sample is written to throw while it renders, which is a skip here. */
	runtime_error?: unknown;
	load_compiled?: boolean;
	props?: Record<string, unknown>;
	/**
	 * What upstream hands a **server** render, where it differs from the client's.
	 *
	 * Fourteen samples write one, and reading `props` for both gave the server the client's: two of
	 * them guard a `MutationObserver` on a `browser` prop that `server_props` sets false, so the
	 * instance script reached for a DOM this process has not got and the oracle was counted as
	 * unable to run. Both sides are handed the same object either way, so this never showed as a
	 * difference -- it showed as a payload upstream does not use for the server.
	 */
	server_props?: Record<string, unknown>;
	/**
	 * What upstream runs before the test, which for a handful of samples is the environment.
	 *
	 * `globals-deconflicted` is `<p>{frag}</p>` over a `globalThis.frag` its config sets here, so
	 * without it the render reads a name nothing binds. Fifty-five samples write one and most are
	 * the client's, so it is called where it does not throw and left alone where it does: a hook
	 * that wants a DOM says so by failing, and a sample whose setup this process cannot run is one
	 * the oracle genuinely cannot be given.
	 */
	before_test?: () => void;
	after_test?: () => void;
	/**
	 * What the sample hands `render()` for an error a `<svelte:boundary>` catches.
	 *
	 * `Renderer`'s default rethrows, so a boundary whose body throws writes nothing without one.
	 * Passed to the oracle only: this compiler's own artifact holds bytes and has nowhere to put a
	 * function that maps an error to what the `failed` snippet is handed, which is the refusal
	 * spec/refusals.md records. The point of passing it is to have an oracle to hold that refusal
	 * against, since eight samples had neither side answering.
	 */
	transformError?: (error: unknown) => unknown;
}

type Outcome = 'identical' | 'empty' | 'differs' | 'gap' | 'decided' | 'skipped' | 'oracle';

interface Result {
	suite: string;
	name: string;
	outcome: Outcome;
	/** Why, for everything but an agreement: the refusal, the skip's reason, the stream that differs. */
	why?: string;
	/** For a refusal the scope line settles, which of its shapes it is. See `DECIDED`. */
	kind?: string;
}

/**
 * The refusals the scope line settles, by a phrase each of their messages says.
 *
 * **A refusal is not a skip and is not counted as one.** A skip is upstream saying not to run the
 * sample; these ran, this compiler read them and turned them away on purpose, and the message
 * names where the question lives. What they are not is work: [conformance.md](conformance.md)
 * takes them out of the denominator, and they were being read out of prose while the table said
 * one number for them and for the gaps together.
 *
 * Matched on the message rather than carried from the refusal, because the classification is the
 * measurement's and nothing in a build has a use for it. **An unmatched refusal is a gap**, which
 * is the safe direction: a refusal nobody has classified is work until somebody says otherwise.
 */
const DECIDED: readonly { says: string; kind: string }[] = [
	{ says: 'async Svelte', kind: "async Svelte, which is the load stage's" },
	{ says: 'assigned after being declared', kind: 'a value the render changes' },
	{ says: 'changed by a function this render calls', kind: 'a value the render changes' },
	{ says: 'is a prop this component changes', kind: 'a value the render changes' },
	{ says: "is a store this component's own script writes", kind: 'a value the render changes' },
	{
		says: 'is assigned inside a value this compiler has to write itself',
		kind: 'a value the render changes',
	},
	{
		says: 'is written to, and it is not a value this compiler holds',
		kind: 'a value the render changes',
	},
	{
		says: '`$store` subscription over a value the request brings',
		kind: 'the payload carries data and no function',
	},
	{
		says: 'is handed a component the request decides',
		kind: 'the payload carries data and no function',
	},
	{ says: 'does not read the same twice', kind: 'a value that is not the same twice' },
	{
		says: 'a render option a server passes',
		kind: 'a boundary whose body throws, which is a render option',
	},
	{
		says: 'is a raw snippet whose bytes the request decides',
		kind: 'a string an artifact would have to render per request',
	},
	{
		says: 'no script in this file writes',
		kind: 'a global of whatever is running, which a second backend has not got',
	},
];

/** Which shape of decision a refusal is, or null where nobody has said and it is work. */
function settled(why: string): string | null {
	return DECIDED.find((one) => why.includes(one.says))?.kind ?? null;
}

/** A refusal, sorted into the two things a refusal can be. */
function turned(suite: string, name: string, why: string): Result {
	const kind = settled(why);
	return kind === null
		? { suite, name, outcome: 'gap', why }
		: { suite, name, outcome: 'decided', why, kind };
}

const need = createRequire(import.meta.url);

/**
 * The sample's configuration, with the harness import it opens with stood in for.
 *
 * Every `_config.js` is `import { test } from '../../test'; export default test({ ... })`, and
 * that harness is upstream's runner rather than its fixtures, so it is not vendored. The import is
 * replaced by an identity and the object read straight off the default export. A config that will
 * not evaluate is a skip that says so, not a silent empty one.
 */
async function configOf(from: string, into: string): Promise<Config & { broken?: string }> {
	let source: string;
	try {
		source = readFileSync(resolve(from, '_config.js'), 'utf8');
	} catch {
		// Most samples have none, and a sample with no config is one with no props.
		return {};
	}
	const shimmed = source.replace(
		/import\s*\{\s*test\s*\}\s*from\s*['"][^'"]+['"];?/,
		'const test = (one) => one;',
	);
	const at = resolve(into, '_config.mjs');
	writeFileSync(at, shimmed);
	try {
		const mod = (await import(pathToFileURL(at).href)) as { default?: Config };
		return mod.default ?? {};
	} catch (error) {
		return { broken: (error as Error).message };
	}
}

/** What this compiler makes of the sample, through the same steps a build takes. */
async function ours(
	dir: string,
	props: Record<string, unknown>,
): Promise<ReturnType<typeof inject>> {
	// Not `compile()`: that batches lowering across a whole project and writes artifacts to disk,
	// and this is one component compared in memory. The steps are its steps.
	const runs = await structures({ path: '/', component: 'main.svelte' }, dir);
	const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
	for (const one of lowered) {
		if (one === undefined) throw new Error('nothing came back from lowering');
		if ('error' in one) throw new Error(one.error);
	}
	const first = runs[0];
	if (first === undefined) throw new Error('the component compiled to no structures at all');
	const compiled = joined(
		first.id,
		runs.map((one, at) => ({
			fixed: one.fixed,
			decided: one.decided,
			compiled: lowered[at] as unknown as Parameters<typeof joined>[1][number]['compiled'],
		})),
		first.skeleton.defaults,
	);
	// One bundle over what every structure of it calls, which is what a route gets.
	const carried = await carry(first.file, merged(runs.map((one) => one.names)));
	const derive = compileDerivations(compiled.derivations, carried);
	return inject(compiled.ir as Parameters<typeof inject>[0], derive(props));
}

/**
 * What Svelte makes of it, bundled the way the refusal check bundles its oracle.
 *
 * Node cannot load a `.svelte`, so every component the entry reaches is compiled where it sits and
 * its runes modules with it, and Svelte's own runtime stays external so one copy of it runs. The
 * `rootDir` is the sample's directory, which is what the compile above used: Svelte hashes the
 * filename relative to it into a head anchor and into a scoped class, so an oracle rooted
 * elsewhere renders a different component.
 */
async function theirs(
	dir: string,
	props: Record<string, unknown>,
	/** What the sample hands `render()` for an error a boundary catches. See `Config`. */
	transformError?: (error: unknown) => unknown,
): Promise<{ body: string; head: string }> {
	const out = resolve(dir, 'oracle.js');
	// **The entry re-exports the component rather than holding a compiled copy of it.** Compiled
	// into the entry, `main.svelte` was in the graph twice -- once here and once through the
	// plugin, for every child that imports the entry's own `<script module>` -- so its module block
	// ran twice and everything it declares had two identities. `createContext()` returns a closure
	// over a fresh key, so `set` in one copy and `get` in the other is `missing_context`:
	// `runtime-runes/create-context` and `error-boundary-27` were counted as the oracle failing
	// where they render perfectly well. It is the same fault `spec/refusals.md` records for a copy
	// this compiler stages, met on the other side of the comparison.
	writeFileSync(out, `export { default } from ${JSON.stringify(resolve(dir, 'main.svelte'))};\n`);
	const bundle = await rolldown({
		input: out,
		platform: 'node',
		resolve: { conditionNames: ['svelte', 'import', 'default'] },
		external: [/^svelte(?:\/|$)/],
		logLevel: 'silent',
		plugins: [
			{
				name: 'svelte',
				load(id: string) {
					if (id.endsWith('.svelte')) {
						return compileComponent(readFileSync(id, 'utf8'), {
							generate: 'server',
							name: basename(id, '.svelte'),
							filename: id,
							rootDir: dir,
							...ASYNC,
						}).js.code;
					}
					if (/\.svelte\.(?:js|ts)$/.test(id)) {
						const text = readFileSync(id, 'utf8');
						return compileModule(id.endsWith('.ts') ? stripTypeScriptTypes(text) : text, {
							generate: 'server',
							filename: id,
							...ASYNC,
						}).js.code;
					}
					return null;
				},
			},
		],
	});
	const { output } = await bundle.generate({ format: 'es' });
	await bundle.close();
	const [chunk] = output;
	if (chunk === undefined) throw new Error('nothing came out of bundling the oracle');
	writeFileSync(out, chunk.code);
	const mod = (await import(pathToFileURL(out).href)) as { default: Parameters<typeof render>[0] };
	const rendered = render(mod.default, {
		props: props as never,
		...(transformError === undefined ? {} : { transformError }),
	});
	if (Object.keys(ASYNC).length > 0) {
		const held = (await rendered) as { body: string; head: string };
		return { body: held.body, head: held.head };
	}
	return { body: rendered.body, head: rendered.head };
}

/**
 * The experiment: both sides compiled with `experimental.async` and both renders awaited.
 *
 * Off by default. Upstream's flag is process-global and irreversible once a compiled component
 * imports `svelte/internal/flags/async`, so this is the whole process or none of it. See
 * spec/roadmap.md.
 */
const ASYNC =
	process.env['SEAM_ASYNC'] === undefined ? {} : { experimental: { async: true as const } };

/** One sample, staged, compiled, rendered and compared. */
async function attempt(suite: string, name: string): Promise<Result> {
	const from = resolve(SAMPLES, suite, 'samples', name);
	const dir = resolve(STAGE, suite, name);
	mkdirSync(dir, { recursive: true });
	cpSync(from, dir, { recursive: true });

	const config = await configOf(from, dir);
	const why =
		config.broken !== undefined
			? `its config will not evaluate: ${config.broken}`
			: config.skip === true
				? 'upstream skips it'
				: Array.isArray(config.mode) && !config.mode.includes('server')
					? `upstream runs it only in ${config.mode.join(', ')} mode`
					: Array.isArray(config.skip_mode) && config.skip_mode.includes('server')
						? 'upstream skips it in server mode'
						: config.error !== undefined
							? 'upstream expects it to error'
							: config.load_compiled === true
								? 'upstream loads its output precompiled'
								: null;
	if (why !== null) return { suite, name, outcome: 'skipped', why };

	const props = config.server_props ?? config.props ?? {};
	// Upstream's own setup, where this process can run it. See `Config.before_test`.
	try {
		config.before_test?.();
	} catch {
		// A hook that wants a DOM is not setup this render can be given, and the oracle says so
		// on its own when the sample then reads what the hook would have set.
	}
	let mine: { body: string; head: string } | null = null;
	let refusal: string | null = null;
	try {
		mine = await ours(dir, props);
	} catch (error) {
		refusal = firstLine(error);
	}
	let svelte: { body: string; head: string };
	try {
		svelte = await theirs(dir, props, config.transformError);
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
		//
		// **Except where the oracle's refusal is this harness's own.** Upstream compiles the runtime
		// suites with `experimental.async` on and this one does not, so Svelte's compiler turns away
		// every async sample -- and that is not the oracle failing, it is a question this harness did
		// not ask. The flag is process-global and irreversible once set, so passing it would make
		// every later sample's render depend on the order samples ran in. The sample stays ours to
		// answer, and what we answer is the scope line: async Svelte is the load stage's. See
		// spec/roadmap.md.
		const text = String((error as Error).message);
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
		if (!/experimental\.async/.test(text) || mine !== null) {
			return { suite, name, outcome: 'oracle', why: firstLine(error) };
		}
		// Which samples are async Svelte is upstream's compiler to say, not a message match here.
		// Two of them this compiler turns away earlier for a reason of its own -- a boundary given
		// its pending snippet as a value -- and were ranked as gaps on the strength of that message
		// while being out of scope whatever the message said. Both facts are reported.
		const said = refusal ?? 'it failed and said nothing';
		const why = said.includes('async Svelte')
			? said
			: `upstream builds it with \`experimental.async\`, so it is async Svelte and the load ` +
				`stage's. This compiler turned it away earlier and for another reason: ${said}`;
		return turned(suite, name, why);
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
function divergence(stream: string, mine: string, theirs: string): string {
	let at = 0;
	while (at < mine.length && at < theirs.length && mine[at] === theirs[at]) at += 1;
	const from = Math.max(0, at - 40);
	const show = (text: string): string =>
		JSON.stringify(text.slice(from, at + 60)).replaceAll('\\n', ' ');
	return `${stream} at ${String(at)}\n      ours   ${show(mine)}\n      svelte ${show(theirs)}`;
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

function samplesOf(suite: string): string[] {
	return readdirSync(resolve(SAMPLES, suite, 'samples'), { withFileTypes: true })
		.filter((one) => one.isDirectory())
		.map((one) => one.name)
		.sort();
}

function count(results: readonly Result[], outcome: Outcome): number {
	return results.filter((one) => one.outcome === outcome).length;
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

/**
 * The counts, which is what a run is read for, so it is written last and on its own.
 *
 * `gap` and `decided` are the two things a refusal can be, apart because reading them together
 * says nothing: one is the list of what is left to do and the other is the scope line holding.
 * `skipped` stays upstream's own and only upstream's -- a skip nobody upstream asked for is a
 * number made to look better, and a decision of ours is not a skip. See spec/suite.md.
 */
function table(results: readonly Result[]): void {
	const width = Math.max(...SUITES.map((one) => one.length));
	const columns: readonly [name: string, of: Outcome, pad: number][] = [
		['identical', 'identical', 11],
		['empty', 'empty', 7],
		['differs', 'differs', 9],
		['gap', 'gap', 6],
		['decided', 'decided', 9],
		['skipped', 'skipped', 9],
		['oracle', 'oracle', 8],
	];
	const row = (name: string, mine: readonly Result[]): string =>
		`${name.padEnd(width)}  ${String(mine.length).padStart(8)}` +
		columns.map(([, of, pad]) => String(count(mine, of)).padStart(pad)).join('');
	console.log(
		`\n${'suite'.padEnd(width)}  ${'samples'.padStart(8)}` +
			columns.map(([name, , pad]) => name.padStart(pad)).join(''),
	);
	for (const suite of SUITES) {
		console.log(
			row(
				suite,
				results.filter((one) => one.suite === suite),
			),
		);
	}
	console.log(row('total', results));
}

function list(results: readonly Result[], outcome: Outcome, title: string): void {
	const found = results.filter((one) => one.outcome === outcome);
	if (found.length === 0) return;
	console.log(`\n${title} (${String(found.length)})`);
	for (const one of found) {
		console.log(`  ${one.suite}/${one.name}${one.why === undefined ? '' : `\n      ${one.why}`}`);
	}
}

/**
 * The decided refusals grouped by which decision they are, names only.
 *
 * The message is the same sentence 183 times for one of these, and what a reader wants of them is
 * the shape and the count. A gap is printed with its message, because a gap is read one at a time.
 */
function decided(results: readonly Result[]): void {
	const found = results.filter((one) => one.outcome === 'decided');
	if (found.length === 0) return;
	const kinds = new Map<string, Result[]>();
	for (const one of found) {
		const held = kinds.get(one.kind ?? '') ?? [];
		held.push(one);
		kinds.set(one.kind ?? '', held);
	}
	console.log(`\nrefused by decision, which the scope line settles (${String(found.length)})`);
	for (const [kind, held] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
		console.log(`  ${kind} (${String(held.length)})`);
		for (const one of held) console.log(`      ${one.suite}/${one.name}`);
	}
}

// A sample is free to throw from a promise nobody awaits -- several are written to -- and the
// default is to end the process. The outcome of the sample that did it is already recorded by the
// time this fires, so the run continues.
process.on('unhandledRejection', () => undefined);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(resolve(STAGE, 'node_modules'), { recursive: true });
// The bundled oracle keeps Svelte's own runtime external, so it has to resolve from where it sits.
symlinkSync(
	dirname(need.resolve('svelte/package.json')),
	resolve(STAGE, 'node_modules/svelte'),
	'dir',
);

const results: Result[] = await quietly(async () => {
	const found: Result[] = [];
	for (const suite of SUITES) {
		for (const name of samplesOf(suite)) {
			// A render that awaits can wait forever: a sample handing it `new Promise(() => {})` is
			// one the server never finishes, which upstream's own async render does not finish either.
			// Reported as the oracle's own failure rather than hanging the run.
			let timer: ReturnType<typeof setTimeout> | undefined;
			const held = await Promise.race([
				attempt(suite, name),
				new Promise<Result>((settle) => {
					timer = setTimeout(
						() => settle({ suite, name, outcome: 'oracle', why: 'the render never settled' }),
						5000,
					);
				}),
			]);
			if (timer !== undefined) clearTimeout(timer);
			found.push(held);
		}
	}
	return found;
});

// The lists first and the table last: a terminal shows the end of what a command wrote, and the
// table is what the run is for. `--table` is the same run with the lists left out.
if (!process.argv.includes('--table')) {
	list(results, 'differs', "compiled and wrote bytes that are not Svelte's");
	list(results, 'oracle', 'neither side answered: the oracle could not be built or run');
	list(results, 'gap', 'refused, and nobody has said this one is not work');
	decided(results);
}
table(results);

const differs = count(results, 'differs');
const gaps = count(results, 'gap');
console.log(
	`\n${String(differs)} sample(s) wrote the wrong bytes and ${String(gaps)} were refused as a gap. ` +
		'A refusal names a file and stops a build; a difference ships. See spec/suite.md.',
);
rmSync(STAGE, { recursive: true, force: true });
// **Both, because the condition changed when the second reached zero.** While any sample wrote the
// wrong bytes this failed on that alone, and the refusals were a list it printed: a check that
// cannot pass stops being read. Now that neither has anything in it the question is no longer how
// far the subset reaches but whether it stops reaching as far, so a sample that starts differing
// and a sample that starts being refused are the same failure and both are the gate's. What this
// does not catch is a sample sliding from `identical` into `decided`, which wants a baseline of
// names rather than a count. See spec/suite.md.
process.exit(differs === 0 && gaps === 0 ? 0 : 1);
