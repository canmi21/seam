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
/** What every sample has to come out as, kept here and not under `vendor/`. See spec/suite.md. */
const BASELINE = resolve(here, '../baseline.json');
/** Taken off a reason, so a path in one reads the same on every machine. */
const ROOT = `${resolve(here, '../../..')}/`;

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

type State = 'pass' | 'skip' | 'fail';

/**
 * What an outcome is once it is read against the list: pass, skip or fail.
 *
 * Empty is a pass, since both sides wrote the same bytes. A skip carries whose it is -- `upstream`
 * where the sample's own config says so, `scope` where the scope line refuses it, `harness` where
 * this runner could not ask the oracle -- because a skip nobody can attribute is a number made to
 * look better. See spec/suite.md.
 */
function stateOf(one: Result): { state: State; reason?: string } {
	switch (one.outcome) {
		case 'identical':
		case 'empty':
			return { state: 'pass' };
		case 'skipped':
			return { state: 'skip', reason: `upstream: ${one.why ?? ''}` };
		case 'decided':
			return { state: 'skip', reason: `scope: ${one.kind ?? ''}` };
		case 'oracle':
			return { state: 'skip', reason: `harness: ${(one.why ?? '').replaceAll(ROOT, '')}` };
		case 'differs':
		case 'gap':
			return { state: 'fail', reason: one.why ?? '' };
	}
}

/** The list every run is held to. See spec/suite.md. */
interface Baseline {
	version: 1;
	/** The Svelte the oracle is, since the same corpus renders differently under another one. */
	svelte: string;
	pass: string[];
	/** Each skipped sample and why, in the words `stateOf` writes. */
	skip: Record<string, string>;
}

const need = createRequire(import.meta.url);

/** A name a `const` may be written against, which is every name an import clause can bind. */
const BINDS = /^[A-Za-z_$][\w$]*$/;

/**
 * The names one import clause binds, or a throw where this does not understand the clause.
 *
 * `* as name`, `{ a, b as c }`, a default on its own, and a default beside either of the other two.
 * **Every name is checked against `BINDS` before it is written into a `const`**, which is what
 * makes the substitution above a rewrite rather than a concatenation: the clause is upstream's
 * text, the result is code this process then runs, and a piece of text that is not an identifier
 * has no business becoming one. Nothing in the corpus is anything else at the pinned tag, and the
 * point of the check is the tag after it.
 *
 * **A clause this does not understand throws rather than being left alone**, because leaving it
 * alone leaves an import nothing can resolve, and the config then fails for a reason that says
 * nothing about which shape it was. See `attempt`, where that outcome goes.
 */
function binds(clause: string): string[] {
	const found: string[] = [];
	const brace = clause.indexOf('{');
	const head = (brace < 0 ? clause : clause.slice(0, brace)).replace(/,\s*$/, '').trim();
	const braced = brace < 0 ? '' : clause.slice(brace).trim();
	const named = (text: string): string => {
		// `a as b` binds `b`, and the stub is written against the name the config reads.
		const name =
			text
				.split(/\s+as\s+/)
				.pop()
				?.trim() ?? '';
		if (!BINDS.test(name)) throw new Error(`an import clause this harness cannot read: ${clause}`);
		return name;
	};
	if (head !== '') found.push(named(head.startsWith('*') ? head.slice(1) : head));
	if (braced !== '') {
		if (!braced.endsWith('}'))
			throw new Error(`an import clause this harness cannot read: ${clause}`);
		for (const each of braced.slice(1, -1).split(',')) {
			if (each.trim() !== '') found.push(named(each));
		}
	}
	return found;
}

/**
 * The sample's configuration, with the harness imports it opens with stood in for.
 *
 * Upstream's runner is not vendored -- it is its runner rather than its fixtures -- so the imports
 * that reach for it are replaced and the object is read straight off the default export.
 *
 * **Every import that leaves the sample's own directory, not the first one that says `test`.** The
 * rule was a single replacement of `import { test } from '...'`, and 276 of upstream's configs
 * write `import { ok, test }` or `import { test, ok }` instead, with more reaching for `helpers`,
 * `../../../suite` and `#client/constants`. None of those matched, so the config threw on an
 * import nothing resolves and the sample was filed under `skipped` -- 342 of them, in the one
 * column spec/suite.md requires to be upstream's own judgement and nobody else's. They were not
 * skipped by anybody: they were never measured, and four of them are work. A specifier that stays
 * inside the sample is left alone, because `./data.js` beside a component is the sample's own
 * fixture and its props may be read out of it.
 *
 * **What stands in for a name throws when it is called.** `test` is the identity, since the object
 * is what is wanted. Everything else is upstream's assertion and timing helpers, which a server
 * render never reaches -- they are called from the `test` function, and this harness does not run
 * it. A stub that throws keeps the two cases apart: a config that only mentions them evaluates,
 * and a config whose `props` are *built* by one says so where the props are read, instead of
 * handing the render a value neither side should be held to.
 */
async function configOf(from: string, into: string): Promise<Config & { broken?: string }> {
	let source: string;
	try {
		source = readFileSync(resolve(from, '_config.js'), 'utf8');
	} catch {
		// Most samples have none, and a sample with no config is one with no props.
		return {};
	}
	let shimmed: string;
	try {
		shimmed = source.replaceAll(
			// Anchored at the start of a line, because an `import` inside a comment or a string is
			// not one and rewriting it would take the config apart. Every clause is matched as one
			// piece and read by `binds()`, rather than matching the two shapes that were expected:
			// a shape nothing matched used to be left as written, which left an import nothing can
			// resolve, which is a config that will not evaluate.
			/^[ \t]*import\s+([^'"]+?)\s+from\s*['"]([^'"]+)['"];?/gm,
			(whole, clause: string, specifier: string) => {
				// A specifier that stays inside the sample is the sample's own, and a bare one is a
				// package this process has. Only what climbs out of the directory is upstream's runner.
				if (!specifier.startsWith('../') && !specifier.startsWith('#')) return whole;
				return binds(clause)
					.map((one) =>
						one === 'test'
							? 'const test = (one) => one;'
							: `const ${one} = () => { throw new Error(${JSON.stringify(
									`\`${one}\` is upstream's own test harness, which is not vendored here`,
								)}); };`,
					)
					.join(' ');
			},
		);
	} catch (error) {
		return { broken: (error as Error).message };
	}
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
	const why =
		config.skip === true
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

	// **A props getter that reaches for upstream's harness is nobody's answer, so it is the
	// oracle's column.** Fourteen configs write `get props()`, and a handful build what they return
	// out of `create_deferred()` and the rest of upstream's helpers, which are not vendored. The
	// stub above throws there rather than inventing a value, and a sample neither side was given
	// the same props for is one nobody measured -- which is what that column is for, and why
	// spec/suite.md says it has to be read rather than trusted.
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

/** One sample's verdict: what it came out as, read against what the list says it has to be. */
interface Verdict {
	key: string;
	suite: string;
	state: State;
	/** For a skip, whose it is and why; for a fail, what went wrong. */
	reason?: string;
}

/**
 * Every sample held to the list, and every name on the list held to the corpus.
 *
 * A skip is checked like a pass: the sample still runs, and a reason that changed -- or a skip that
 * passes now -- fails until the list says so. The list is only as true as the last run that read
 * it. See spec/suite.md.
 */
function judge(results: readonly Result[], listed: Baseline | null): Verdict[] {
	const passes = new Set(listed?.pass ?? []);
	const skips = new Map(Object.entries(listed?.skip ?? {}));
	const verdicts: Verdict[] = [];
	for (const one of results) {
		const key = `${one.suite}/${one.name}`;
		const { state, reason } = stateOf(one);
		const wanted = passes.has(key) ? 'pass' : skips.get(key);
		passes.delete(key);
		skips.delete(key);
		const wrong = disagreement(state, reason, wanted);
		verdicts.push(
			wrong === null
				? { key, suite: one.suite, state, ...(reason === undefined ? {} : { reason }) }
				: { key, suite: one.suite, state: 'fail', reason: wrong },
		);
	}
	for (const key of [...passes, ...skips.keys()]) {
		verdicts.push({
			key,
			suite: key.slice(0, key.indexOf('/')),
			state: 'fail',
			reason: 'in the baseline, and not in the corpus',
		});
	}
	return verdicts;
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
function svelteVersion(): string {
	const manifest = JSON.parse(readFileSync(need.resolve('svelte/package.json'), 'utf8')) as {
		version: string;
	};
	return manifest.version;
}

function read(): Baseline | null {
	let text: string;
	try {
		text = readFileSync(BASELINE, 'utf8');
	} catch {
		return null;
	}
	const held = JSON.parse(text) as Baseline;
	if (held.version !== 1)
		throw new Error(`baseline.json is version ${String(held.version)}, not 1`);
	return held;
}

/** The run, written as the list: sorted, so a sample that moves is one line in a diff. */
function write(results: readonly Result[]): void {
	const pass: string[] = [];
	const skip: Record<string, string> = {};
	for (const one of results.toSorted((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
		const { state, reason } = stateOf(one);
		if (state === 'pass') pass.push(keyOf(one));
		else skip[keyOf(one)] = reason ?? '';
	}
	const held: Baseline = { version: 1, svelte: svelteVersion(), pass, skip };
	writeFileSync(BASELINE, `${JSON.stringify(held, null, '\t')}\n`);
}

function keyOf(one: Result): string {
	return `${one.suite}/${one.name}`;
}

/** The three counts per suite, which is what a run is read for, so it is written last. */
function table(verdicts: readonly Verdict[]): void {
	const width = Math.max(...SUITES.map((one) => one.length));
	const states: readonly State[] = ['pass', 'skip', 'fail'];
	const row = (name: string, mine: readonly Verdict[]): string =>
		`${name.padEnd(width)}  ${String(mine.length).padStart(8)}` +
		states
			.map((state) => String(mine.filter((one) => one.state === state).length).padStart(7))
			.join('');
	console.log(
		`\n${'suite'.padEnd(width)}  ${'samples'.padStart(8)}${states.map((one) => one.padStart(7)).join('')}`,
	);
	for (const suite of SUITES) {
		console.log(
			row(
				suite,
				verdicts.filter((one) => one.suite === suite),
			),
		);
	}
	console.log(row('total', verdicts));
}

/** The failures one at a time with what went wrong, and the skips by reason with how many. */
function lists(verdicts: readonly Verdict[]): void {
	const failed = verdicts.filter((one) => one.state === 'fail');
	if (failed.length > 0) {
		console.log(`\nfail (${String(failed.length)})`);
		for (const one of failed) console.log(`  ${one.key}\n      ${one.reason ?? ''}`);
	}
	const reasons = new Map<string, number>();
	for (const one of verdicts) {
		if (one.state === 'skip')
			reasons.set(one.reason ?? '', (reasons.get(one.reason ?? '') ?? 0) + 1);
	}
	if (reasons.size === 0) return;
	console.log(`\nskip, by reason; the names are in baseline.json`);
	for (const [reason, many] of [...reasons].toSorted((a, b) => b[1] - a[1])) {
		console.log(`  ${String(many).padStart(4)}  ${reason}`);
	}
}

// A sample is free to throw from a promise nobody awaits -- several are written to -- and the
// default is to end the process. The outcome of the sample that did it is already recorded by the
// time this fires, so the run continues.
process.on('unhandledRejection', () => undefined);
// And from a timer, which is the same statement one channel along: `reactive-values-text-node`
// starts a `setTimeout` in its instance script and calls a method on a prop upstream's own
// harness builds. Both renders write their bytes and agree; what throws does so five milliseconds
// later, with nothing left to record. Unguarded it ends the process, which ends the run.
process.on('uncaughtException', () => undefined);

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

// `--write` records the run as the list, and only a run with nothing failing can be recorded: a
// failure is not a state the list has. Otherwise the run is held to the list. See spec/suite.md.
const experiment = Object.keys(ASYNC).length > 0;
if (process.argv.includes('--write')) {
	const failing = results.filter((one) => stateOf(one).state === 'fail');
	if (experiment || failing.length > 0) {
		lists(failing.map((one) => ({ key: keyOf(one), suite: one.suite, ...stateOf(one) })));
		console.log(
			experiment
				? '\nThe list is the default render, and `SEAM_ASYNC` is an experiment on it.'
				: `\n${String(failing.length)} sample(s) fail, and a failure is not something the ` +
						'baseline records.',
		);
		rmSync(STAGE, { recursive: true, force: true });
		process.exit(1);
	}
	write(results);
	rmSync(STAGE, { recursive: true, force: true });
	console.log(`\nbaseline.json records ${String(results.length)} samples.`);
	process.exit(0);
}

// The experiment compiles both sides another way, so it is reported rather than held to the list.
const listed = experiment ? null : read();
const verdicts = experiment
	? results.map((one) => ({ key: keyOf(one), suite: one.suite, ...stateOf(one) }))
	: judge(results, listed);
const version = svelteVersion();
// The lists first and the table last: a terminal shows the end of what a command wrote, and the
// table is what the run is for. `--table` is the same run with the lists left out.
if (!process.argv.includes('--table')) lists(verdicts);
table(verdicts);

const failed = verdicts.filter((one) => one.state === 'fail').length;
const moved = listed !== null && listed.svelte !== version;
console.log(
	experiment
		? `\n${String(failed)} sample(s) fail under \`experimental.async\`, which no list holds.`
		: listed === null
			? '\nThere is no baseline.json; `mise run vendor-baseline -- --write` records one.'
			: `\n${String(failed)} sample(s) disagree with baseline.json.` +
				(moved ? ` It was recorded against svelte@${listed.svelte}, and this is ${version}.` : ''),
);
rmSync(STAGE, { recursive: true, force: true });
process.exit(failed === 0 && !moved && (experiment || listed !== null) ? 0 : 1);
