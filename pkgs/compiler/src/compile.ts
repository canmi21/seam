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
import { bundle, type Bundle, type Carried } from 'ast';
import { carriedBy, carry } from 'carry';
import { lower } from 'lowering';
import {
	combinations,
	type Decided,
	type Fixed,
	joined,
	MANY,
	type Run,
	type Structure,
} from './variants.ts';
import { skeleton, type Skeleton, Undecided } from 'skeleton';

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
	/** The code the component's expressions call, bundled. Empty when it carries nothing. */
	carried: string;
}

/** One line per artifact written, so a caller can say what it did without guessing. */
export interface Report {
	id: string;
	path: string;
	files: string[];
	/** How many expressions this component has to have evaluated per request. */
	derivations: number;
}

/**
 * Svelte's own functions a component's expressions call, which the author did not import.
 *
 * `attributes` writes the whole of an element's attributes from an object, which is what a `{...}`
 * needs and what cannot be enumerated at compile time. It goes in the carried bundle beside the
 * author's own imports, so both backends run **Svelte's implementation** rather than agreeing
 * about a rule: nothing here reproduces the merging, the escaping, the boolean names, the
 * `defaultValue` mapping on an input or the case rules for a namespaced element. Measured at 17 kB
 * bundled, with its only host references optionally chained off `globalThis`, so an evaluator with
 * no host reads them as undefined rather than failing. See spec/refusals.md.
 */
function helpers(skeleton: Skeleton): Carried[] {
	if (!skeleton.holes.some((one) => one.spread === true)) return [];
	return [{ local: 'attributes', from: 'svelte/internal/server', kind: 'named' }];
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
	const rendered = await skeleton(entry, root, fixed, decided);
	// Run for its refusals as much as for its result: it is the pass that says every name resolves,
	// over the whole tree the entry reaches rather than over the entry alone.
	const markup = bundle(entry, root);
	return {
		id: idOf(resolve(root), entry),
		file: entry,
		source,
		markup,
		skeleton: rendered,
		carried: await carry(entry, [...carriedBy([entry, ...rendered.entered]), ...helpers(rendered)]),
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
	const queue: Run[] = combinations(entry.enumerate ?? {}).map((fixed) => ({
		fixed,
		decided: new Map(),
	}));
	const found: (Prepared & Run)[] = [];
	for (let at = 0; at < queue.length; at++) {
		const run = queue[at] as Run;
		try {
			found.push({ ...(await prepare(entry.component, root, run.fixed, run.decided)), ...run });
		} catch (error) {
			if (!(error instanceof Undecided)) throw error;
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
 * Compiles a project and writes its server artifacts.
 *
 * ```
 * <out>/server/<id>.json   the IR and its derivations
 * <out>/server/<id>.js     the carried bundle, where the component carries anything
 * <out>/server/manifest.json
 * ```
 *
 * The client half is not written here. What shape it takes, and who owns the document shell it is
 * referenced from, are settled at the plugin step; until then the manifest says so rather than
 * guessing. See spec/build.md.
 */
export async function compile(options: Options): Promise<Report[]> {
	const root = resolve(options.root);
	const server = resolve(options.out, 'server');

	// Every entry, then every refusal, rather than the first one. An author fixing a build wants
	// the list, and stopping at the first turns one build into as many as they have mistakes.
	//
	// A route with a declared domain is prepared once per combination of its values, and the runs
	// stay side by side until lowering has finished with them. They are one route throughout: one
	// URL, one id, one carried bundle, and one artifact at the end.
	const prepared: (Prepared & Run & { path: string; of: number })[] = [];
	const refusals: string[] = [];
	const warnings: string[] = [];
	for (const entry of options.entries) {
		try {
			const runs = await structures(entry, root);
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
			refusals.push(
				`${relative(root, resolve(root, entry.component))}: ${(error as Error).message}`,
			);
		}
	}

	const lowered = lower(prepared.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
	for (const [at, one] of lowered.entries()) {
		if (one !== undefined && 'error' in one) refusals.push(`${one.name}: ${one.error}`);
		else if (one === undefined) refusals.push(`${prepared[at]?.id ?? '?'}: nothing came back`);
	}

	if (refusals.length > 0) {
		throw new Error(
			`${refusals.length} component(s) could not be compiled:\n  ${refusals.join('\n  ')}`,
		);
	}

	// Written only once every component has compiled, so a refused build leaves the previous
	// artifacts alone rather than half of a new one beside half of an old one.
	rmSync(server, { recursive: true, force: true });

	for (const one of warnings) console.warn(`warning: ${one}`);

	const reports: Report[] = [];
	// Keyed by URL, because that is what a server has in its hand when a request arrives. The id
	// stays inside: it names the artifacts and it is what Svelte hashes for a scoped class, and
	// those are questions about the file rather than about the address. See spec/build.md.
	const routes: Record<string, { id: string; ir: string; carried: string | null; head: string }> =
		{};

	// Back to one entry per route: the runs made for one route are joined into the artifact that
	// carries all of its structures, under an if over the paths their values were fixed at.
	for (let at = 0; at < prepared.length;) {
		const one = prepared[at] as (typeof prepared)[number];
		const runs = prepared.slice(at, at + one.of).map((each, index) => ({
			fixed: each.fixed,
			decided: each.decided,
			compiled: lowered[at + index] as unknown as Structure,
		}));
		at += one.of;
		const compiled = joined(one.id, runs);
		const files: string[] = [];

		const irFile = `${one.id}.json`;
		write(resolve(server, irFile), `${JSON.stringify(compiled, null, '\t')}\n`);
		files.push(irFile);

		// Nothing rather than an empty file, so a page that carries nothing ships nothing. It is
		// JavaScript and it is still an artifact: a backend that is not Node reads this file too
		// and hands it to its own evaluator, so bundling it into one backend's program would make
		// the two read code that arrived by different routes. See spec/build.md.
		let carriedFile: string | null = null;
		if (one.carried !== '') {
			carriedFile = `${one.id}.js`;
			write(resolve(server, carriedFile), one.carried);
			files.push(carriedFile);
		}

		routes[one.path] = {
			id: one.id,
			ir: irFile,
			carried: carriedFile,
			head: options.assets?.[one.path] ?? '',
		};
		reports.push({
			id: one.id,
			path: one.path,
			files,
			derivations: compiled.derivations.length,
		});
	}

	if (options.shell !== undefined) {
		mkdirSync(server, { recursive: true });
		copyFileSync(resolve(options.shell), resolve(server, 'app.html'));
	}

	// Whether anything in this artifact has to be evaluated rather than walked.
	//
	// Walking the IR needs a dotted path, an escape and a truthiness test, and none of those is
	// JavaScript; a derivation is the only thing that is. So a backend embeds an engine exactly when
	// this is true, which for a compiled binary is a decision about the whole artifact rather than
	// about one route -- one component with a derivation is enough. Stated here so that deciding it
	// is reading one field rather than scanning every route. See spec/ir.md.
	const expressions = reports.some((one) => one.derivations > 0);

	write(
		resolve(server, 'manifest.json'),
		`${JSON.stringify({ expressions, routes }, null, '\t')}\n`,
	);
	return reports;
}

function write(file: string, contents: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, contents);
}
