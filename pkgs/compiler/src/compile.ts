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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { bindings, bundle, type Bundle } from 'ast';
import { carry } from 'carry';
import { lower, type Lowered } from 'lowering';
import { skeleton, type Skeleton } from 'skeleton';

export interface Options {
	/**
	 * What component ids and artifact names are relative to. Given rather than derived: two
	 * entries in different directories would otherwise name a shared component differently.
	 */
	root: string;
	/**
	 * The components to compile. Routing does not exist, so the entries are named rather than
	 * found, and naming them is what the plugin's configuration will do. See spec/build.md.
	 */
	entries: readonly string[];
	/** Where the artifacts go. The layout below is written under it. */
	out: string;
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
	files: string[];
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
export async function prepare(file: string, root: string): Promise<Prepared> {
	const entry = resolve(file);
	const source = readFileSync(entry, 'utf8');
	// The order is deliberate and is not the order the fields are declared in. The render pass
	// refuses markup nobody taught the compiler; `bundle` refuses a name nothing binds. An
	// unsupported construct usually binds names of its own, so resolving names first reports the
	// name and hides the construct that bound it.
	const rendered = await skeleton(entry);
	// Run for its refusals as much as for its result: it is the pass that says every name resolves,
	// over the whole tree the entry reaches rather than over the entry alone.
	const markup = bundle(entry, root);
	return {
		id: idOf(resolve(root), entry),
		file: entry,
		source,
		markup,
		skeleton: rendered,
		carried: await carry(entry, bindings(source).carried),
	};
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
	const prepared: Prepared[] = [];
	const refusals: string[] = [];
	for (const entry of options.entries) {
		try {
			prepared.push(await prepare(entry, root));
		} catch (error) {
			refusals.push(`${relative(root, resolve(entry))}: ${(error as Error).message}`);
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

	const reports: Report[] = [];
	const routes: Record<string, { ir: string; carried: string | null }> = {};

	for (const [at, one] of prepared.entries()) {
		const compiled = lowered[at] as Exclude<Lowered, { error: string }>;
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

		routes[one.id] = { ir: irFile, carried: carriedFile };
		reports.push({ id: one.id, files });
	}

	write(
		resolve(server, 'manifest.json'),
		`${JSON.stringify({ routes, client: null }, null, '\t')}\n`,
	);
	return reports;
}

function write(file: string, contents: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, contents);
}
