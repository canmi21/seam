import { basename, dirname, resolve as resolvePath } from 'node:path';
import { compile } from 'svelte/compiler';
import type { Rendered } from './shape.ts';
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
		for (const match of code.matchAll(/from\s+(['"])(\.[^'"]*)\1/g)) {
			const quote = match[1] ?? "'";
			const specifier = match[2];
			if (specifier === undefined) continue;
			const target = resolvePath(dirname(origin), specifier);
			// A copy resolves its own relative imports from where its original sits, not from the
			// name it was staged under.
			const replacement = specifier.endsWith('.svelte')
				? emit(target, compileFile(target), staged.get(target)?.file ?? target)
				: target;
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
		return compile(copy?.source ?? read(target, 'utf8'), {
			generate: 'server',
			name: basename(from, '.svelte'),
			filename: from,
			rootDir: root,
		}).js.code;
	}

	try {
		const entry = emit(
			file,
			compile(source, {
				generate: 'server',
				name: 'Entry',
				filename: file,
				rootDir: root,
			}).js.code,
			file,
		);
		const mod = (await import(pathToFileURL(entry).href)) as { default: unknown };
		const { body, head } = render(mod.default as never, { props: props as never });
		return { body, head };
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
