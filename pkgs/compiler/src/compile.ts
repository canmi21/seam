/**
 * The six passes, joined, and the artifact they produce.
 *
 * Every pass existed before this file and nothing joined them. Four places each wired a different
 * subset and each wired it differently, and one of those subsets had a hole in it: nothing ever
 * wrote a carried bundle to a file, so the server could not obtain one and a component calling an
 * imported function failed at request time with a `ReferenceError`. It never showed because the
 * only consumer that ran such a component was a check that produced a bundle for itself.
 *
 * Two entry points, one sequence. `prepare` runs the per-component half and returns what it made;
 * `compile` runs it over a project and writes the layout. They exist separately because the
 * fixtures and the artifacts want different files written, and the thing worth having once is the
 * order of the passes rather than the writing.
 *
 * See spec/build.md for the layout, and for why none of it is bundled.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import {
	bundle,
	type Carried,
	configureAliases,
	configureProjectOptions,
	remembered,
	rememberedSources,
	type Bundle,
	configureComponentExtensions,
} from '@seam-js/ast';
import { carriedBy, carriedNames, carry, rememberedBundles } from '@seam-js/carry';
import { script } from '@seam-js/program';
import { lower } from '@seam-js/lowering';
import { aliases, compilerOptions, configured } from '@seam-js/routes';
import {
	combinations,
	type Decided,
	decidedAs,
	type Fixed,
	joined,
	MANY,
	type Run,
	type Structure,
} from './variants.ts';
import {
	expressionsOf,
	helpers,
	skeleton,
	type Skeleton,
	timed,
	timedSync,
	timings,
	rememberedCodegen,
	rememberedStaging,
	Undecided,
	configureLoadedComponents,
	configureUnnamedComponents,
	unavailable,
} from '@seam-js/skeleton';

/**
 * One route: the URL it answers at, and the component the document is rendered from.
 *
 * The URL is given rather than derived. It was briefly the component's id, by way of a development
 * server that served each artifact at `/<id>`, which is a routing convention invented by an
 * implementation detail rather than decided. See spec/build.md.
 */
export interface Entry {
	path: string;
	component: string;
	/**
	 * Payload paths whose values this route is compiled once for each of, and their domains.
	 *
	 * A field the author's own markup does not branch on while something downstream does -- a
	 * locale a translation package reads, a role that picks a layout. The compiler can read neither
	 * the branch nor the domain, so the domain is declared here and every structure it induces is
	 * produced at compile time. Enumerating the structures rather than the values is the rule this
	 * serves; see spec/pipeline.md, and spec/build.md for why the domain is a build input.
	 */
	enumerate?: Readonly<Record<string, readonly unknown[]>>;
	/**
	 * The components the route's universal `load` functions import, relative to `root`: what a
	 * `load` may hand a page to render with `<svelte:component this={data.X}>`. See
	 * spec/framework.md, "A component a `load` returns".
	 */
	loaded?: readonly string[];
}

export interface Options {
	/**
	 * What component ids and artifact names are relative to. Given rather than derived: two
	 * entries in different directories would otherwise name a shared component differently.
	 */
	root: string;
	/**
	 * The routes to compile. Routing does not exist, so they are named rather than found, and
	 * naming them is what the plugin's configuration will do. See spec/build.md.
	 */
	entries: readonly Entry[];
	/** Where the artifacts go. The layout below is written under it. */
	out: string;
	/**
	 * The document shell, copied beside the artifacts because a backend that is not Node has to
	 * read it too. SvelteKit compiles its own into a JavaScript function, which is available to it
	 * because its server artifact is code. See spec/build.md.
	 */
	shell?: string;
	/**
	 * What each route's document has to load, by URL, as the finished string a server concatenates.
	 * It comes from whoever ran the client build, since that is what gives the assets their names.
	 *
	 * A string rather than a list of files, so that two backends never have to spell a script tag
	 * identically -- which is a byte-level agreement of exactly the kind this protocol avoids.
	 */
	assets?: Readonly<Record<string, string>>;
	/**
	 * Refuse at the build a `<svelte:component>` handed a component the request decides that the
	 * source names none of. Off, it renders nothing for a value that is nothing and throws per
	 * request for anything else, where Svelte would render whatever it was handed. See
	 * spec/payload.md.
	 */
	refuseUnnamedComponents?: boolean;
	/**
	 * Refuse instead of degrade: a route the compile refuses fails the build rather than being
	 * rendered by SSR. `SEAM_STRICT=1`, for a CI that holds an application to CTR whole. See
	 * spec/together.md, "Coverage".
	 */
	strict?: boolean;
	/**
	 * Asked of each route before its artifact is written: null where its program agrees with
	 * Svelte's render over every payload kept for it in development, or why it does not, which
	 * renders the route by SSR -- or fails the build, under `strict`. See spec/together.md, "The props
	 * a page was rendered with, kept and replayed".
	 */
	verify?: (route: Route) => Promise<string | null>;
	/**
	 * Asked for a route a module of which could not be evaluated on the server: the same route
	 * with each component that cannot be stood in for by one that throws what it threw as it
	 * renders, which is where Kit's render of it throws, or null where none was found. See
	 * spec/framework.md, "A module that cannot be evaluated on the server".
	 */
	unevaluable?: (entry: Entry) => Promise<Entry | null>;
}

/**
 * Every structure's carried names as one map, which is what a route's single bundle is built from.
 *
 * A name is kept once per file: two structures of one route read the same import from the same
 * file, and a bundler asked for it twice writes it twice.
 */
export function merged(all: readonly Map<string, Carried[]>[]): Map<string, Carried[]> {
	const found = new Map<string, Map<string, Carried>>();
	for (const one of all) {
		for (const [file, names] of one) {
			const held = found.get(file) ?? new Map<string, Carried>();
			for (const name of names) {
				held.set(`${name.local}\u0000${name.from}\u0000${name.kind}`, name);
			}
			found.set(file, held);
		}
	}
	return new Map([...found].map(([file, names]) => [file, [...names.values()]]));
}

/** What one component produced before anything was written down. */
export interface Prepared {
	/** The component's id, which is its path relative to the root without the extension. */
	id: string;
	file: string;
	source: string;
	/** Every component the entry reaches, with names resolved. Not an artifact; a check. */
	markup: Bundle;
	skeleton: Skeleton;
	/**
	 * What this structure's expressions call, by the file that wrote each name.
	 *
	 * The names rather than the bundle, because **a route has one bundle and several structures**.
	 * Bundling per structure and shipping the first one's is a bundle that answers for a page the
	 * server may never be asked for: press's article calls `contentLanguageHref` in the structure
	 * where a translation exists and in no other, and the shipped bundle was the structure where
	 * one does not -- `ReferenceError` at request time, on a page that compiled.
	 */
	names: Map<string, Carried[]>;
}

/** One line per artifact written, so a caller can say what it did without guessing. */
export interface Report {
	id: string;
	path: string;
	files: string[];
	/** How many expressions this component has to have evaluated per request. */
	derivations: number;
}

/** The id of a file, which is also where its artifacts sit under the output directory. */
function idOf(root: string, file: string): string {
	const withoutExtension = file.slice(0, -extname(file).length);
	// Posix separators, because the id is written into an artifact two backends read and a
	// backslash there would make the artifact say which machine built it.
	return relative(root, withoutExtension).split(sep).join('/');
}

/**
 * The per-component half of the build: everything up to lowering, which is batched by the caller.
 *
 * Lowering is left out on purpose. Its unit is the project rather than the component -- one call
 * with everything in it, because crossing into WebAssembly costs a `memcpy` and doing it per
 * component is the only part of it that was ever expensive. See pkgs/lowering.
 */
export async function prepare(
	file: string,
	root: string,
	fixed: Fixed = new Map(),
	decided: Decided = new Map(),
): Promise<Prepared> {
	// Against the root, not the working directory. A route names its component the way the author
	// wrote it in the configuration, which is relative to the project rather than to wherever the
	// build happened to be started from.
	const entry = resolve(root, file);
	const source = readFileSync(entry, 'utf8');
	// The order is deliberate and is not the order the fields are declared in. The render pass
	// refuses markup nobody taught the compiler; `bundle` refuses a name nothing binds. An
	// unsupported construct usually binds names of its own, so resolving names first reports the
	// name and hides the construct that bound it.
	const rendered = await timed('skeleton (walk + renders)', () =>
		skeleton(entry, root, fixed, decided),
	);
	// Run for its refusals as much as for its result: it is the pass that says every name resolves,
	// over the whole tree the entry reaches rather than over the entry alone.
	const markup = timedSync('bundle (name resolution)', () =>
		bundle(entry, root, new Set([relative(resolve(root), entry)])),
	);
	return {
		id: idOf(resolve(root), entry),
		file: entry,
		source,
		markup,
		skeleton: rendered,
		names: new Map([...carriedBy(root, expressionsOf(rendered)), ['*', helpers(rendered)]]),
	};
}

/**
 * Every structure one route has, each prepared with what it was fixed at.
 *
 * The declared domains give the first runs, one per combination. The rest are found: a run whose
 * walk meets a `?:` handed to a component it cannot enter stops with `Undecided`, and is replaced
 * by two runs that decide it each way. A ternary inside one of those may stop again, one render
 * deeper, so what comes out is a tree of runs rather than a product -- a ternary in a branch that
 * is not taken costs nothing. See spec/refusals.md.
 *
 * Breadth first, the taken branch first, so the structures come out in an order a reader can
 * follow and the same order every build.
 */
export async function structures(entry: Entry, root: string): Promise<(Prepared & Run)[]> {
	// What `$lib` and the project's own aliases stand for, as Kit's plugin would have told Vite.
	configureAliases(await aliases(root));
	// Which files are components, which Kit's config can widen past `.svelte`.
	configureComponentExtensions((await configured(root)).extensions);
	// And the compile options it sets that change the bytes, which every compile below is handed.
	configureProjectOptions(await compilerOptions(root));
	const queue: Run[] = combinations(entry.enumerate ?? {}).map((fixed) => ({
		fixed,
		decided: new Map(),
	}));
	const found: (Prepared & Run)[] = [];
	for (let at = 0; at < queue.length; at++) {
		const run = queue[at] as Run;
		if (process.env['SEAM_TRACE'] !== undefined) {
			console.error(`[seam] structure ${String(at + 1)} of ${String(queue.length)} queued so far`);
		}
		try {
			found.push({ ...(await prepare(entry.component, root, run.fixed, run.decided)), ...run });
		} catch (error) {
			if (!(error instanceof Undecided)) throw error;
			if (process.env['SEAM_TRACE'] !== undefined) {
				console.error(`[seam] undecided: ${error.test.replace(/\s+/g, ' ').slice(0, 160)}`);
			}
			// Settled, and asked again: the walk would not have stopped on it, so this is the compiler.
			if (run.decided.has(error.test)) {
				throw new Error(`\`${error.test}\` was decided and the walk asked about it again`, {
					cause: error,
				});
			}
			for (const taken of [true, false]) {
				queue.push({ fixed: run.fixed, decided: new Map([...run.decided, [error.test, taken]]) });
			}
		}
	}
	return found;
}

/**
 * One route compiled, before anything is written: its structures joined into the one the program
 * is written from, and what each structure's expressions call, by the file that wrote each name.
 */
export interface Route {
	id: string;
	path: string;
	/** The entry component, resolved. */
	file: string;
	structure: Structure;
	names: Map<string, Carried[]>;
	/** Every component the entry reaches, relative to the root: what a change to the route is. */
	components: string[];
	/** The components rendered by SSR in place, once each, with why. See spec/together.md. */
	ssr: { file: string; why: string }[];
}

/** Every route compiled, the ones left to the framework, and what the compile has to say. */
export interface Built {
	routes: Route[];
	left: Record<string, string>;
	/**
	 * Routes rendered by SSR whole because the compile refused them, by route, with why: what Kit's
	 * root renders, as it renders a route left to the framework. See spec/together.md.
	 */
	ssr: Record<string, string>;
	warnings: string[];
}

/**
 * A refusal the author has to answer whatever renders the component, which is still the build's
 * error rather than a route rendered by SSR: async Svelte outside its async mode, which Svelte's own
 * compiler refuses as well. See spec/together.md, "What is not a degradation".
 */
function theAuthors(reason: string): boolean {
	return reason.includes('which is async Svelte');
}

/**
 * The routes compiled and nothing written: what `compile` writes as the artifact layout, and what
 * the dev server holds in memory, a route at a time. A route the compile refuses is rendered by SSR,
 * and said with why; under `strict` it throws instead, listing every one, as a refusal the author has
 * to answer always does. See spec/together.md and spec/build.md, "How the dev server compiles a
 * route".
 */
export async function built(options: Options): Promise<Built> {
	const root = resolve(options.root);
	configureUnnamedComponents(options.refuseUnnamedComponents === true);
	configureLoadedComponents(
		new Map(
			options.entries.map((entry) => [
				resolve(root, entry.component),
				(entry.loaded ?? []).map((key) => ({ key, file: resolve(root, key) })),
			]),
		),
	);
	// Every entry, then every refusal, rather than the first one. An author fixing a build wants
	// the list, and stopping at the first turns one build into as many as they have mistakes.
	//
	// A route with a declared domain is prepared once per combination of its values, and the runs
	// stay side by side until lowering has finished with them. They are one route throughout: one
	// URL, one id, one carried bundle, and one artifact at the end.
	const prepared: (Prepared & Run & { path: string; of: number })[] = [];
	/** What the compile refused, by route: each reason, named by the file it was raised about. */
	const refused = new Map<string, string[]>();
	const refuse = (path: string, reason: string): void => {
		refused.set(path, [...(refused.get(path) ?? []), reason]);
	};
	const warnings: string[] = [];
	/**
	 * Routes left to the framework: a module that cannot be evaluated on the server, with no
	 * component found to stand in for, so that nothing this compiler could write would be served.
	 * No artifact, and not a refusal. See spec/framework.md.
	 */
	const left: Record<string, string> = {};
	for (const given of options.entries) {
		let entry = given;
		try {
			let runs: (Prepared & Run)[];
			try {
				runs = await structures(entry, root);
			} catch (error) {
				const instead = unavailable(error) ? await options.unevaluable?.(entry) : undefined;
				if (instead === undefined || instead === null) throw error;
				entry = instead;
				runs = await structures(entry, root);
			}
			if (runs.length > MANY) {
				const fields = Object.keys(entry.enumerate ?? {}).map((one) => `\`${one}\``);
				const chosen = new Set(runs.flatMap((one) => [...one.decided.keys()]));
				const from = [
					fields.length > 0 ? fields.join(', ') : '',
					chosen.size > 0
						? `${String(chosen.size)} choice(s) in values handed to components the compiler could not read`
						: '',
				]
					.filter((one) => one !== '')
					.join(' and ');
				warnings.push(
					`${entry.path} has ${String(runs.length)} structures, from ${from}. A page really can, so this is compiled; a domain declared against a field that is not one is the likelier reading. See spec/pipeline.md`,
				);
			}
			for (const one of runs) prepared.push({ ...one, path: entry.path, of: runs.length });
		} catch (error) {
			if (unavailable(error)) {
				left[entry.path] = (error as Error).message;
				warnings.push(
					`${entry.path} is left to the framework's error response: ${(error as Error).message}`,
				);
				continue;
			}
			refuse(
				entry.path,
				`${relative(root, resolve(root, entry.component))}: ${(error as Error).message}`,
			);
		}
	}

	const lowered = timedSync('lower (wasm)', () =>
		lower(prepared.map((one) => [one.id, JSON.stringify(one.skeleton)] as const)),
	);
	for (const [at, one] of lowered.entries()) {
		const path = prepared[at]?.path ?? '?';
		if (one !== undefined && 'error' in one) refuse(path, `${one.name}: ${one.error}`);
		else if (one === undefined) refuse(path, `${prepared[at]?.id ?? '?'}: nothing came back`);
	}

	// What has to fail the build: a refusal the author has to answer, and under `strict` every one.
	const failing = [...refused.values()]
		.flat()
		.filter((reason) => options.strict === true || theAuthors(reason));
	if (failing.length > 0) {
		throw new Error(
			`${failing.length} component(s) could not be compiled:\n  ${failing.join('\n  ')}`,
		);
	}
	const ssr: Record<string, string> = {};
	for (const [path, reasons] of refused) ssr[path] = reasons.join('\n');

	// Back to one entry per route: the runs made for one route are joined into the structure that
	// carries all of its structures, under an if over the paths their values were fixed at.
	const routes: Route[] = [];
	for (let at = 0; at < prepared.length;) {
		const one = prepared[at] as (typeof prepared)[number];
		// A route the compile refused in any of its runs is rendered by SSR whole.
		if (refused.has(one.path)) {
			at += one.of;
			continue;
		}
		const runs = prepared.slice(at, at + one.of).map((each, index) => ({
			fixed: each.fixed,
			decided: decidedAs(each),
			held: each.skeleton.held,
			compiled: lowered[at + index] as unknown as Structure,
		}));
		const together = merged(prepared.slice(at, at + one.of).map((each) => each.names));
		const components = new Set(
			prepared.slice(at, at + one.of).flatMap((each) => Object.keys(each.markup.components)),
		);
		const ssrParts = new Map<string, string>();
		for (const each of prepared.slice(at, at + one.of)) {
			for (const part of each.skeleton.ssr ?? [])
				if (!ssrParts.has(part.file)) ssrParts.set(part.file, part.why);
		}
		at += one.of;
		routes.push({
			id: one.id,
			path: one.path,
			file: one.file,
			// The entry declares the same props in every run, so the defaults are the entry's.
			structure: joined(one.id, runs, one.skeleton.defaults, one.skeleton.eager),
			names: together,
			components: [...components],
			ssr: [...ssrParts].map(([file, why]) => ({ file, why })),
		});
	}
	return { routes, left, ssr, warnings };
}

/**
 * Compiles a project and writes its server artifacts.
 *
 * ```
 * <out>/server/<id>.js     the route's program, the carried bundle before it
 * <out>/server/manifest.json
 * ```
 *
 * The client half is not written here. What shape it takes, and who owns the document shell it is
 * referenced from, are settled at the plugin step; until then the manifest says so rather than
 * guessing. See spec/build.md.
 */
export async function compile(options: Options): Promise<Report[]> {
	const server = resolve(options.out, 'server');
	const { routes: compiled, left, ssr, warnings } = await built(options);

	// Written only once every component has compiled, so a refused build leaves the previous
	// artifacts alone rather than half of a new one beside half of an old one.
	rmSync(server, { recursive: true, force: true });

	for (const one of warnings) console.warn(`warning: ${one}`);

	const reports: Report[] = [];
	// Keyed by URL, because that is what a server has in its hand when a request arrives. The id
	// stays inside: it names the artifacts and it is what Svelte hashes for a scoped class, and
	// those are questions about the file rather than about the address. See spec/build.md.
	const routes: Record<string, { id: string; script: string; head: string }> = {};

	// One route, one bundle, over what every structure of it calls. See `Prepared.names`.
	for (const one of compiled) {
		const disagrees = (await options.verify?.(one)) ?? null;
		if (disagrees !== null) {
			if (options.strict === true) throw new Error(`${one.path}: ${disagrees}`);
			ssr[one.path] = disagrees;
			continue;
		}
		const carried = await timed('carry (derivation bundle)', () =>
			carry(one.file, one.names, resolve(options.root)),
		);
		const files: string[] = [];

		// The route's program, with the bundle it calls before it: one script, which every backend
		// evaluates once and calls once a request. It is still an artifact rather than part of a
		// backend's own program, so that two backends read code that arrived the same way. See
		// spec/build.md.
		const scriptFile = `${one.id}.js`;
		write(
			resolve(server, scriptFile),
			`${script(one.structure, carried, carriedNames(one.names, one.file))}\n`,
		);
		files.push(scriptFile);

		routes[one.path] = {
			id: one.id,
			script: scriptFile,
			head: options.assets?.[one.path] ?? '',
		};
		reports.push({
			id: one.id,
			path: one.path,
			files,
			derivations: one.structure.derivations.length,
		});
	}

	if (options.shell !== undefined) {
		mkdirSync(server, { recursive: true });
		copyFileSync(resolve(options.shell), resolve(server, 'app.html'));
	}

	// What renders each route, which the build says and the manifest keeps. See spec/together.md.
	const coverage: Record<
		string,
		{ render: 'ctr' | 'mixed' | 'ssr'; why?: string; ssr?: { file: string; why: string }[] }
	> = {};
	for (const one of compiled) {
		if (ssr[one.path] !== undefined) continue;
		coverage[one.path] =
			one.ssr.length === 0 ? { render: 'ctr' } : { render: 'mixed', ssr: one.ssr };
	}
	for (const [path, why] of Object.entries({ ...left, ...ssr }))
		coverage[path] = { render: 'ssr', why };
	const bySsr = Object.entries(coverage).filter(([, one]) => one.render === 'ssr');
	const mixed = Object.entries(coverage).filter(([, one]) => one.render === 'mixed');
	for (const [path, one] of bySsr) {
		console.warn(`seam: ${path} renders by SSR: ${(one.why ?? '').split('\n')[0] ?? ''}`);
	}
	for (const [path, one] of mixed) {
		for (const part of one.ssr ?? []) {
			console.warn(`seam: ${path} renders ${part.file} by SSR: ${part.why.split('\n')[0] ?? ''}`);
		}
	}
	// Each component once, however many routes render it. See spec/together.md, "Coverage".
	const parts = new Set(mixed.flatMap(([, one]) => (one.ssr ?? []).map((part) => part.file)));
	console.warn(
		`seam: ${String(Object.keys(coverage).length)} route(s) and error page(s): ` +
			`${String(Object.keys(coverage).length - bySsr.length - mixed.length)} by CTR whole, ` +
			`${String(mixed.length)} with ${String(parts.size)} component(s) by SSR, ${String(bySsr.length)} by SSR whole`,
	);
	write(
		resolve(server, 'manifest.json'),
		`${JSON.stringify({ routes, left, ssr, coverage }, null, '\t')}\n`,
	);
	// Where the time went, when asked for: a compile nests a walk inside a render inside a stage,
	// and which of them costs what has to be measured rather than reasoned about. See spec/build.md.
	if (process.env['SEAM_TIME'] !== undefined) {
		const report = timings();
		if (report !== '') console.error(`[seam] where the time went:\n${report}`);
		// What the memos hold, beside what the process holds: a memo is memory traded for time, and
		// the trade is only visible with both numbers. See spec/build.md.
		const memos = remembered();
		const heap = process.memoryUsage();
		console.error(
			`[seam] what it remembered: ${String(memos.expressions)} expression tree(s), ` +
				`${String(memos.components)} component tree(s), ${String(rememberedSources())} source answer(s), ` +
				`${String(rememberedCodegen())} compile(s), ` +
				`${String(rememberedStaging())} staged copy/copies, ` +
				`${String(rememberedBundles())} bundle(s); heap ${String(Math.round(heap.heapUsed / 1e6))}MB ` +
				`of ${String(Math.round(heap.rss / 1e6))}MB resident`,
		);
	}

	return reports;
}

function write(file: string, contents: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, contents);
}
