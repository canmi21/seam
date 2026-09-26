/**
 * The vendored corpus: which suites and samples there are, and what each sample's own `_config.js`
 * says about how it is rendered, read rather than judged. See spec/suite.md.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The vendored corpus, at the tag `vendor/svelte/VENDOR.md` pins. */
export const SAMPLES = resolve(here, '../../../vendor/svelte/tests');

/**
 * The suites whose assertions a server render can be held to, and what each was written for.
 *
 * Only the first is about server bytes. The two runtime suites are the client's, repurposed: both
 * sides are handed the same props and the server render is what is compared. They are in because
 * they found most of what was wrong -- 97 of the 115 samples that compiled and wrote the wrong
 * bytes the first time this ran were theirs. See spec/suite.md.
 */
export const SUITES = ['server-side-rendering', 'runtime-runes', 'runtime-legacy'] as const;

/**
 * What upstream's own `_config.js` says about a sample, read rather than judged.
 *
 * A sample is skipped here only where upstream skips it: `skip` outright, a `mode` upstream does
 * not run on the server, an `error` the sample is written to produce, or output it loads
 * precompiled. Nothing else is skipped, because a skip nobody upstream asked for is a number made
 * to look better. `props` is what both sides are handed.
 *
 * **`mode` is a list of the modes upstream runs the sample in, and `skip_mode` a list of the ones
 * it leaves out**, in each runner's own words -- see `SERVED`, which says which are the server's.
 * This read `mode` for `sync` once, which no runtime sample names, so every runtime sample carrying
 * a `mode` was skipped -- twenty of them server tests upstream runs, `head-payload-validation`
 * saying `mode: ['server']` in as many words. Then it read `server` alone, and 37 samples written
 * for an async server render were upstream's skips. A condition that cannot be false does not fail;
 * it makes the denominator smaller and says nothing.
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
export interface Config {
	skip?: boolean;
	mode?: string[];
	skip_mode?: string[];
	error?: unknown;
	/** Upstream's own: the sample is written to throw while it renders, which is a skip here. */
	runtime_error?: unknown;
	/** Upstream's own: the sample is skipped in async mode (`runtime-legacy/shared.ts`). */
	skip_async?: boolean;
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
	/**
	 * What the sample hands `render()` for a content security policy: a `nonce` put on the script
	 * `hydratable` values are written into, or `hash` to have one computed. Passed to the oracle
	 * only, the way `transformError` is: it is a render option a server passes.
	 */
	csp?: { nonce?: string; hash?: boolean };
	/** Upstream's compile options for the sample, of which `runes` is read. See `RUNES`. */
	compileOptions?: { runes?: boolean };
}

/**
 * The mode upstream compiles each suite in, where the sample's own `compileOptions` do not say.
 *
 * `runtime_suite(runes)` in upstream's `runtime-legacy/shared.ts` passes `runes: true` for the one
 * suite and `false` for the other, and the SSR suite passes nothing. Read here because a file with
 * no rune in it infers legacy mode, and upstream is testing it in runes mode: the two write
 * different anchors. Both sides get it, ours through a `svelte.config.js` the way a project gives
 * it. See spec/suite.md.
 */
export const RUNES: Readonly<Record<string, boolean>> = {
	'runtime-runes': true,
	'runtime-legacy': false,
};

/**
 * The modes in which upstream renders a sample on the server, per suite, since the two runners name
 * them differently.
 *
 * The runtime suites' `mode` is `client`, `hydrate`, `server` and `async-server`; the SSR suite's is
 * `sync` and `async` (`server-side-rendering/test.ts`). The first of each pair is upstream's
 * synchronous render, the second the same render with `experimental.async` on. A sample upstream
 * renders in either is a server sample, and it is measured here in the one render this runner
 * makes: the legacy suite is never rendered async by upstream -- `async-ssr` is `no-test` there
 * without runes (`runtime-legacy/shared.ts`) -- and is measured all the same. See spec/suite.md.
 */
export const SERVED: Readonly<Record<string, readonly string[]>> = {
	'server-side-rendering': ['sync', 'async'],
	'runtime-runes': ['server', 'async-server'],
	'runtime-legacy': ['server', 'async-server'],
};

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
 * is what is wanted, and the helpers in `STANDS_IN` are upstream's own, copied. Everything else is
 * upstream's assertion and timing helpers, which a server render never reaches -- they are called
 * from the `test` function, and this harness does not run it. A stub that throws keeps the two
 * cases apart: a config that only mentions them evaluates, and a config whose `props` are *built*
 * by one says so where the props are read, instead of handing the render a value neither side
 * should be held to.
 *
 * **A specifier inside the sample is resolved the way Vite resolves it**, since upstream runs the
 * config under Vite: `./data` is `./data.js`, which Node's own resolution does not do.
 */
/**
 * Upstream's helpers that build a config's props, as `tests/helpers.js` writes them.
 *
 * A config that builds its props out of one is not a sample the oracle cannot render, so the helper
 * is copied rather than stubbed: thirteen `await` samples hand the render `create_deferred()`'s
 * promise, and with the stub the props were never built.
 */
const STANDS_IN: Readonly<Record<string, string>> = {
	create_deferred: `function create_deferred() {
	let resolve = (value) => {};
	let reject = (reason) => {};
	const promise = new Promise((f, r) => {
		resolve = f;
		reject = r;
	});
	return { promise, resolve, reject };
}`,
};

/** Vite's own order for a specifier written without one. */
const EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];

export async function configOf(from: string, into: string): Promise<Config & { broken?: string }> {
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
				if (specifier.startsWith('./')) {
					if (existsSync(resolve(from, specifier))) return whole;
					const found = EXTENSIONS.find((one) => existsSync(resolve(from, `${specifier}${one}`)));
					return found === undefined ? whole : whole.replace(specifier, `${specifier}${found}`);
				}
				if (!specifier.startsWith('../') && !specifier.startsWith('#')) return whole;
				return binds(clause)
					.map((one) =>
						one === 'test'
							? 'const test = (one) => one;'
							: (STANDS_IN[one] ??
								`const ${one} = () => { throw new Error(${JSON.stringify(
									`\`${one}\` is upstream's own test harness, which is not vendored here`,
								)}); };`),
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

export function samplesOf(suite: string): string[] {
	return readdirSync(resolve(SAMPLES, suite, 'samples'), { withFileTypes: true })
		.filter((one) => one.isDirectory())
		.map((one) => one.name)
		.toSorted();
}
