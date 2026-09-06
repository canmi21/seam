import { basename, dirname, resolve as resolvePath } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { APP_STATE, resolveBare } from 'ast';
import type { Rendered } from './shape.ts';
import { HEAD_CLOSE, HEAD_OPEN, ID_PREFIX, MARK, MARK_HEAD, sentinel } from './sentinel.ts';
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
	const { fileURLToPath } = await import('node:url');
	const { render } = await import('svelte/server');

	const here = dirname(fileURLToPath(import.meta.url));
	// A directory of its own per render, and only that one is removed. It used to be one shared
	// directory emptied in a `finally`, which is fine for one caller and a race for two: the
	// checks drive this from several files at once and each was deleting the other's modules.
	generation += 1;
	const staging = resolvePath(here, `../.build/${process.pid}-${generation}`);
	mkdirSync(staging, { recursive: true });
	let written = 0;

	// One staged file per source, however many times it is imported, which is also what ends the
	// walk of a component that imports itself.
	const emitted = new Map<string, string>();
	function emit(from: string, code: string, origin: string): string {
		const held = emitted.get(from);
		if (held !== undefined) return held;
		const out = resolvePath(staging, `${basename(from, '.svelte')}-${generation}-${written++}.js`);
		emitted.set(from, out);
		if ([HEAD_OPEN, HEAD_CLOSE, MARK, MARK_HEAD].some((call) => code.includes(`${call}(`))) {
			code = handed(code);
		}
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
			// The one exception is `svelte` itself, which is named by its server entry: its root
			// export has a `browser` variant, and a host that resolves the staged file under that
			// condition -- vitest does, for the hydration check -- would hand a component's
			// `setContext` the client's, which then finds no component to run in.
			if (specifier === 'svelte') {
				code = code.replaceAll(
					`${quote}svelte${quote}`,
					JSON.stringify(pathToFileURL(svelteServer()).href),
				);
				continue;
			}
			// Kit's `$app/state`, which its plugin provides and nothing here has: the module beside
			// this file reads `page` out of the component context as Kit's server module does. The
			// walk bound every read of it already, so a render reaches this only through an import
			// something else kept alive. See `stateImports()` in `ast`.
			if (specifier === APP_STATE) {
				code = code.replaceAll(
					`${quote}${specifier}${quote}`,
					JSON.stringify(pathToFileURL(resolvePath(here, 'app-state.ts')).href),
				);
				continue;
			}
			if (specifier.startsWith('svelte/')) continue;
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

/**
 * The file Svelte's root export resolves to on a server: the `default` condition of `.` in its
 * `package.json`, read rather than spelled, so a release that moves the file moves this with it.
 */
export function svelteServer(): string {
	const at = createRequire(import.meta.url).resolve('svelte/package.json');
	const { exports } = JSON.parse(readFileSync(at, 'utf8')) as {
		exports: Record<string, string | Record<string, string>>;
	};
	const root = exports['.'];
	const entry = typeof root === 'string' ? root : root?.['default'];
	if (entry === undefined) throw new Error("svelte's package.json has no default export for `.`");
	return resolvePath(dirname(at), entry);
}

/** The path with every link followed, or the path itself where there is nothing to follow. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * The compiled component with the calls the walk wrote into its markup given the renderer.
 *
 * Three of them. `__seam_open(n)` in a `{@const}` at the start of each branch of a block -- or
 * around the block's own expression, `__seam_open(n, value)`, where a branch cannot hold a const --
 * and `__seam_close(n)` in an expression tag beside its stamp stand the block in the head stream,
 * so that the head carries anchors for it where the body carries Svelte's own; see `mirrored()`
 * in walk.ts. `__seam_mark(marker)` in a stand-in's script or init writes a call's marker into the
 * body where the stand-in renders, and `__seam_mark_head(marker)` writes one into the head for a
 * fragment that writes a head; see `marks()` and `marksHead()` in sentinel.ts. All need the renderer the
 * component was handed, which is a local of the compiled function and not something markup can
 * name, so they are given it here. The open remembers itself so that the close can write an empty
 * pair for a branch that ran no open: an if without an `{:else}` has no branch to hold one, and
 * the render made with it not taken still has to hold the block. It opens once per block however
 * often it is called, so a fragment opened from its script -- ahead of the head Svelte hoists --
 * and again from the `{@const}` in its body writes one anchor.
 */
function handed(code: string): string {
	const helpers =
		'const __seam_opened = new Set();\n' +
		`function ${HEAD_OPEN}($$renderer, block, value) { if (__seam_opened.has(block)) return value; ` +
		"__seam_opened.add(block); $$renderer.head((head) => head.push('<!--[-->')); return value; }\n" +
		`function ${HEAD_CLOSE}($$renderer, block) { const opened = __seam_opened.delete(block); ` +
		"$$renderer.head((head) => head.push((opened ? '' : '<!--[-->') + '<!--]-->%%b' + String(block) + '%%')); " +
		"return ''; }\n" +
		`function ${MARK}($$renderer, marker) { $$renderer.push(marker); }\n` +
		`function ${MARK_HEAD}($$renderer, marker) { $$renderer.head((head) => head.push(marker)); }\n`;
	// Functions rather than strings, since `$$` in a replacement string is one `$`.
	let given = code;
	for (const call of [HEAD_OPEN, HEAD_CLOSE, MARK, MARK_HEAD]) {
		given = given.replaceAll(`${call}(`, () => `${call}($$renderer, `);
	}
	return helpers + given;
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
