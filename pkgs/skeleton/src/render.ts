import { basename, dirname, resolve as resolvePath } from 'node:path';
import { realpathSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { resolveBare } from 'ast';
import type { Rendered } from './shape.ts';
import { ID_PREFIX, sentinel } from './sentinel.ts';
import type { Copy } from './walk.ts';

/**
 * Running the rewritten source, which is the one step that is a render rather than an analysis.
 *
 * Svelte's server output imports `svelte/internal/server`, so the modules are staged inside this
 * package where that resolves, and every relative specifier in them is rewritten to an absolute
 * URL on the way out. A component the walk copied is compiled from what the walk rewrote but under
 * the name of the file it copies, because two of the bytes Svelte writes are hashes of that name.
 */

/**
 * Svelte's runtime, checked to be the one a server ships.
 *
 * `{@html}` opens its block with `<!---->` in production and with a hash of the value in
 * development, so which build of Svelte was imported changes the bytes this pass renders -- and
 * those bytes go into the IR. A hash of a sentinel is a hash of a value nobody will ever hold, so
 * the artifact would be wrong for every payload rather than for an unusual one.
 *
 * Which build is loaded comes from `NODE_ENV`, two dependencies down: Svelte reads `DEV` from
 * `esm-env`, whose fallback is true for any `NODE_ENV` that is set and does not begin with
 * `prod`. Unset, as it is under a mise task, gives production. A test runner sets it to `test` and
 * `vite dev` sets it to `development`, and the compiler is going to run inside a Vite plugin.
 *
 * Measured rather than reasoned about. The rule lives in a dependency of a dependency and could
 * change without anybody here noticing; the one call below is the behaviour itself.
 */
let checked = false;

export async function shippable(): Promise<void> {
	if (checked) return;
	const { html } = await import('svelte/internal/server');
	const open = html('x');
	if (open !== '<!---->x<!---->') {
		throw new Error(
			`Svelte's development runtime is loaded: it writes \`${open}\` where a server writes ` +
				'`<!---->x<!---->`, and the compiler would write that into the IR. The build is chosen ' +
				'by NODE_ENV, which has to be `production` for a compile. See spec/pipeline.md',
		);
	}
	checked = true;
}

// Staged inside this package, because Svelte's output imports 'svelte/internal/server' and that
// only resolves from a directory where svelte is a dependency. Specifiers are rewritten to
// absolute URLs, so the modules can live anywhere once they are written.
// Bumped per render, because import() caches by URL and two renders of the same component
// would otherwise be the same module: the second configuration would silently return the first.
let generation = 0;

export async function renderRewritten(
	file: string,
	source: string,
	root: string,
	copies: readonly Copy[] = [],
	/**
	 * The payload the render is given, which holds the paths it is fixed at and nothing else.
	 *
	 * Every other field is absent on purpose: a marker is the only way to read one, and a render
	 * that could read them would let an expression through that has to be a hole.
	 */
	props: Record<string, unknown> = {},
	/** The hole standing for the entry's own `$props.id()` anchor, where it declares one. */
	fresh?: number,
): Promise<Rendered> {
	const { mkdirSync, readFileSync: read, rmSync, writeFileSync } = await import('node:fs');
	const { fileURLToPath, pathToFileURL } = await import('node:url');
	const { render } = await import('svelte/server');

	const here = dirname(fileURLToPath(import.meta.url));
	// A directory of its own per render, and only that one is removed. It used to be one shared
	// directory emptied in a `finally`, which is fine for one caller and a race for two: the
	// checks drive this from several files at once and each was deleting the other's modules.
	generation += 1;
	const staging = resolvePath(here, `../.build/${process.pid}-${generation}`);
	mkdirSync(staging, { recursive: true });
	let written = 0;

	function emit(from: string, code: string, origin: string): string {
		// Either quote. Svelte keeps the one the author wrote, so a component whose imports are
		// double-quoted -- which is most of what a package ships -- had its relative specifiers
		// left alone here and its neighbours looked for beside the staged file rather than beside
		// the source. What the author saw was Node reporting a missing module inside `.build`.
		for (const match of code.matchAll(/from\s+(['"])([^'"]+)\1/g)) {
			const quote = match[1] ?? "'";
			const specifier = match[2];
			if (specifier === undefined) continue;
			// Svelte's own modules stay as written: the staged file resolves them from this package,
			// which is the one copy of Svelte the render runs, and a second copy resolved from a
			// component's own tree would be a second set of module state. Everything else a
			// component imports by a bare name is resolved from where the component sits, because
			// the staged file sits nowhere near its `node_modules`.
			if (specifier === 'svelte' || specifier.startsWith('svelte/')) continue;
			const target = specifier.startsWith('.')
				? resolvePath(dirname(origin), specifier)
				: resolveBare(specifier, origin);
			if (target === null) continue;
			// A copy resolves its own relative imports from where its original sits, not from the
			// name it was staged under. A module reached by a bare name is left where it really is,
			// by its real path, so that it stays the one module the host loads: staging a copy of a
			// package's JavaScript made two of every module, and a context keyed by an object one
			// copy made was not found by the other. What Node cannot load on its own -- a `.svelte`
			// a package re-exports, a runes module -- is the host's loader's or bundler's to compile,
			// as it is for the project's own; only the `.svelte` this pass rewrote is compiled here.
			const replacement = target.endsWith('.svelte')
				? emit(target, compileFile(target), staged.get(target)?.file ?? target)
				: real(target);
			code = code.replaceAll(
				`${quote}${specifier}${quote}`,
				JSON.stringify(pathToFileURL(replacement).href),
			);
		}
		const out = resolvePath(staging, `${basename(from, '.svelte')}-${generation}-${written++}.js`);
		writeFileSync(out, code);
		return out;
	}

	// A copy is compiled from what the walk rewrote, under the name of the file it copies: the
	// scoped class and the head anchor are hashes of that filename, so telling Svelte the staged
	// name would move both.
	const staged = new Map(copies.map((one) => [one.at, one]));

	function compileFile(target: string): string {
		const copy = staged.get(target);
		const from = copy?.file ?? target;
		const code = compile(copy?.source ?? read(target, 'utf8'), {
			generate: 'server',
			name: basename(from, '.svelte'),
			filename: from,
			rootDir: root,
		}).js.code;
		return copy?.fresh === undefined ? code : anchoring(code, copy.fresh);
	}

	try {
		const compiled = compile(source, {
			generate: 'server',
			name: 'Entry',
			filename: file,
			rootDir: root,
		}).js.code;
		const entry = emit(file, fresh === undefined ? compiled : anchoring(compiled, fresh), file);
		const mod = (await import(pathToFileURL(entry).href)) as { default: unknown };
		// The prefix is what makes a `$props.id()` anchor readable after the render. See `fresh.ts`.
		const { body, head } = render(mod.default as never, {
			props: props as never,
			idPrefix: ID_PREFIX,
		});
		return { body, head };
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}

/** The path with every link followed, or the path itself where there is nothing to follow. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** The call Svelte's server transform writes for `$props.id()`, first in the component's body. */
const PROPS_ID = '$.props_id($$renderer)';

/**
 * The compiled component with the anchor of its `$props.id()` written as the marker of its hole.
 *
 * Svelte's helper pushes `<!--$` and an id from the renderer's counter and `-->`, and returns the
 * id. The id is a value the runtime counts out, so what is wanted in the compile-time bytes is the
 * hole's marker in its place -- and only there: every read of the id in the markup is already a
 * hole of its own, so what the declaration holds during the render is never written. Replacing
 * the one call rather than the helper keeps where the anchor goes Svelte's own. See `fresh.ts`
 * for the components whose output this cannot reach.
 */
function anchoring(code: string, hole: number): string {
	const at = code.indexOf(PROPS_ID);
	if (at < 0 || code.indexOf(PROPS_ID, at + 1) >= 0) {
		throw new Error(
			'a component declaring `$props.id()` compiled to something other than one call of ' +
				"Svelte's helper, so the anchor cannot be planted; Svelte's server transform has moved",
		);
	}
	const marker = JSON.stringify(sentinel(hole));
	const helper = `function __seam_id(renderer) { renderer.push('<!--$' + ${marker} + '-->'); return ${marker}; }\n`;
	// A function rather than a string, since `$$` in a replacement string is one `$`.
	return helper + code.replace(PROPS_ID, () => '__seam_id($$renderer)');
}
