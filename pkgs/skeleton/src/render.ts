import { basename, dirname, resolve as resolvePath } from 'node:path';
import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_STATE, resolveBare, RUNES_MODULE, runesModule } from 'ast';
import type { Rendered } from './shape.ts';
import { HEAD_CLOSE, HEAD_OPEN, ID_PREFIX, MARK, MARK_HEAD, sentinel } from './sentinel.ts';
import { timed, timedSync } from './timing.ts';
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

/**
 * What loads the staged modules and what resolves their imports.
 *
 * Node, by default: the copies are staged inside this package, `svelte` is named by its server
 * entry so the render and the components share one copy of it, and every bare specifier is
 * rewritten to the file it names, since Node knows no aliases and no plugin. Inside a Vite build
 * the plugin gives a bundler instead: the copies are staged inside the project, loaded through
 * Vite's own SSR loader, and what Node could not resolve -- `svelte` by condition, `$app/*`, a
 * virtual module of the project's own plugins -- is left as written for Vite to resolve, the way
 * the project's own build resolves it. Svelte itself comes from the host in both cases, so that
 * the renderer and the components are one module.
 */
export interface Host {
	/** Loads a module by its `file:` URL, and anything it imports. */
	import: (url: string) => Promise<unknown>;
	/** Resolves a bare specifier the way the components' own build would; `svelte/server` is one. */
	module: (specifier: string) => Promise<unknown>;
	/** Where the staged copies are written, under a directory per process. */
	staging: string;
	/** Whether the host resolves what Node cannot, so that nothing is rewritten for it. */
	bundler: boolean;
}

const NODE: Host = {
	import: (url) => import(url),
	module: (specifier) => import(specifier),
	staging: resolvePath(dirname(fileURLToPath(import.meta.url)), '../.build'),
	bundler: false,
};

let host: Host = NODE;

/** Renders through the given host from now on, or through Node again when given null. */
export function configureRender(given: Host | null): void {
	host = given ?? NODE;
	checked = false;
}

/**
 * The staged copies removed, for a caller that is done rendering.
 *
 * They outlive a render on purpose -- see `onDisk` -- so somebody has to say when the last one has
 * happened. The host is not told: a module it has loaded from one of these stays loaded, which is
 * the whole arrangement, and the files are what is being tidied rather than the memory.
 */
export function forgetStaging(): void {
	rmSync(resolvePath(host.staging, String(process.pid)), { recursive: true, force: true });
	onDisk.clear();
}

/** How many staged copies this process holds, which is what the sharing is measured by. */
export function rememberedStaging(): number {
	return onDisk.size;
}

export async function shippable(): Promise<void> {
	if (checked) return;
	const { html } = (await host.module(
		'svelte/internal/server',
	)) as typeof import('svelte/internal/server');
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
/**
 * The staged copies already written, by path, for the life of the process.
 *
 * A staged file is named for what is in it, so a name is a promise about content: the same copy of
 * the same component, staged again by another render, is the same file and the host already has it
 * loaded. Which is the point -- a route renders hundreds of times and stages a hundred copies each
 * time, and nearly every one of them is byte for byte what the render before it staged.
 *
 * This is what a name per render was avoiding, and it avoided it by giving up the sharing as well:
 * `import()` caches by URL, so two renders of one component under one name would have been the
 * same module and the second's configuration would silently have returned the first's. Under a
 * content name there is no second configuration -- two renders share a module exactly when they
 * would have written the same program. See spec/build.md.
 */
const onDisk = new Set<string>();

/** Names handed to files in a cycle, which cannot be named for their content. See `emit`. */
let cycles = 0;

/**
 * What Svelte's compiler has already produced in this process, by everything it was given.
 *
 * A render forces one block onto one branch and leaves every other block where it was, so the
 * source the walk rewrote is identical between the baseline and nearly every alternate, for
 * nearly every component in the route's graph. Compiling all of them again per render was one
 * Svelte compile per component per render -- a route with ninety blocks and a hundred components
 * compiled nine thousand times what it could compile once. `compile` is a pure function of these
 * arguments, so the code is keyed by them. See spec/pipeline.md.
 *
 * The key holds the source rather than the file, so a copy the walk rewrote differently is a
 * different entry and nothing is served a stale compile. What bounds the map is the number of
 * distinct rewrites, which is the number of components times the branches that reach them, and
 * not the number of renders.
 */
const compiled = new Map<string, string>();

/** How many compiles the memo above holds. */
export function rememberedCodegen(): number {
	return compiled.size;
}

/**
 * Svelte's server codegen, run once per distinct set of arguments rather than once per render.
 *
 * The compiler is handed in rather than imported: it is the host's, so that the renderer and the
 * components are one copy of Svelte.
 */
function codegen(
	svelte: typeof import('svelte/compiler'),
	source: string,
	name: string,
	filename: string,
	root: string,
): string {
	const key = JSON.stringify([source, name, filename, root]);
	const held = compiled.get(key);
	if (held !== undefined) return held;
	const code = timedSync('    codegen (svelte compile)', () => {
		try {
			const { js } = svelte.compile(source, { generate: 'server', name, filename, rootDir: root });
			return js.code;
		} catch (error) {
			// Async Svelte, found by Svelte's own analysis rather than by ours. The walk checks every
			// component it enters, and the render compiles some it never entered -- a child under a
			// `<svelte:boundary>` with a `pending` snippet is never walked, because the server writes
			// the pending body and none of the children, and it is still compiled. Reported in this
			// compiler's words so it is one refusal by decision rather than upstream's error in the
			// gap list. See spec/conformance.md.
			if (
				typeof error === 'object' &&
				error !== null &&
				(error as { code?: unknown }).code === 'experimental_async'
			) {
				throw new Error(
					`${basename(filename)} awaits in its markup or at the top of its script, which is ` +
						'async Svelte: a value loaded per request while the bytes are written, which is ' +
						"the load stage and not this compiler's to render",
				);
			}
			throw error;
		}
	});
	compiled.set(key, code);
	return code;
}

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
	const { mkdirSync, readFileSync: read, writeFileSync } = await import('node:fs');
	// The host's Svelte, which is the components' too.
	const { render } = (await host.module('svelte/server')) as typeof import('svelte/server');
	const svelte = (await host.module('svelte/compiler')) as typeof import('svelte/compiler');

	const here = dirname(fileURLToPath(import.meta.url));
	// A directory per process rather than per render: what a render stages outlives it, being
	// named for its content and reused by the renders that would have written it again. The pid
	// keeps two processes apart, which the checks need -- they drive this from several files at
	// once and a shared directory made each delete the other's modules.
	const staging = resolvePath(host.staging, String(process.pid));
	mkdirSync(staging, { recursive: true });

	// One staged file per source, however many times it is imported, which is also what ends the
	// walk of a component that imports itself.
	const emitted = new Map<string, string>();
	/**
	 * The files this render is part way through writing, and the name each was forced to take.
	 *
	 * A name is a hash of the finished file, which is only known once its imports have been
	 * rewritten to the names of the files they point at -- so a file is named after its children,
	 * and after everything they reach. A cycle has no such order: re-entering a file still being
	 * written means its name is about to appear inside itself. That one is given a name of its own
	 * instead, shared with no render, and so is everything that imports it, since the name goes
	 * into their bytes. Empty string means in progress and not yet forced.
	 */
	const opened = new Map<string, string>();
	function emit(from: string, code: string, origin: string): string {
		const held = emitted.get(from);
		if (held !== undefined) return held;
		const forced = opened.get(from);
		if (forced !== undefined) {
			if (forced !== '') return forced;
			const own = resolvePath(staging, `${basename(from, '.svelte')}-${String(cycles++)}.js`);
			opened.set(from, own);
			return own;
		}
		opened.set(from, '');
		if ([HEAD_OPEN, HEAD_CLOSE, MARK, MARK_HEAD].some((call) => code.includes(`${call}(`))) {
			code = handed(code);
		}
		// An import for its effect alone, `import './app.css'`, which a component has for its
		// stylesheet. Relative to the source and not to the staged copy, so it is pointed at the
		// file; under Node, which cannot load a stylesheet, it goes, as a bundler's build would
		// have taken it out of the server half anyway.
		code = code.replace(
			/^[ \t]*import\s+(['"])(\.[^'"]+)\1;?[ \t]*\r?\n/gm,
			(whole: string, _quote: string, specifier: string) => {
				const target = resolveBare(specifier, origin);
				if (target === null) return whole;
				if (!host.bundler && /\.(?:css|scss|sass|less|styl|pcss)$/.test(target)) return '';
				return `import ${JSON.stringify(pathToFileURL(real(target)).href)};\n`;
			},
		);
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
				if (host.bundler) continue;
				code = code.replaceAll(
					`${quote}svelte${quote}`,
					JSON.stringify(pathToFileURL(svelteServer()).href),
				);
				continue;
			}
			// Kit's `$app/state`, which its plugin provides and Node has not: the module beside this
			// file reads `page` out of the component context as Kit's server module does. The walk
			// bound every read of it already, so a render reaches this only through an import
			// something else kept alive. See `stateImports()` in `ast`.
			if (specifier === APP_STATE) {
				if (host.bundler) continue;
				code = code.replaceAll(
					`${quote}${specifier}${quote}`,
					JSON.stringify(pathToFileURL(resolvePath(here, 'app-state.ts')).href),
				);
				continue;
			}
			if (specifier.startsWith('svelte/')) continue;
			// A relative path is completed too: a bundler resolves `./index` and `./x.svelte` as
			// `./index.ts` and `./x.svelte.ts`, and so does `resolveBare`.
			const target = resolveBare(specifier, origin);
			if (target === null) continue;
			// A copy resolves its own relative imports from where its original sits, not from the
			// name it was staged under. A module reached by a bare name is left where it really is,
			// by its real path, so that it stays the one module the host loads: staging a copy of a
			// package's JavaScript made two of every module, and a context keyed by an object one
			// copy made was not found by the other. What Node cannot load on its own -- a `.svelte`
			// a package re-exports, a runes module -- is the host's loader's or bundler's to compile,
			// as it is for the project's own; only the `.svelte` this pass rewrote is compiled here.
			// A runes module is the exception to leaving a module where it is: `$state` and the rest
			// are compiled away by Svelte and exist nowhere at run time, so Node loading one as
			// written answers `$state is not defined`. It is compiled and emitted once, keyed by its
			// real path, so the render still holds one instance of it. See `runesModule` in `ast`.
			const replacement = target.endsWith('.svelte')
				? emit(target, compileFile(target), staged.get(target)?.file ?? target)
				: RUNES_MODULE.test(target)
					? emit(target, runesModule(target, read(target, 'utf8')), target)
					: real(target);
			code = code.replaceAll(
				`${quote}${specifier}${quote}`,
				JSON.stringify(pathToFileURL(replacement).href),
			);
		}
		// Named now that it is finished, and for what is in it: two renders that would have written
		// the same file write one, and the host has it loaded already. The name covers everything
		// this file reaches, because what it reaches is in its imports and its imports are in these
		// bytes. See `onDisk`.
		const own = opened.get(from) ?? '';
		opened.delete(from);
		const out =
			own === ''
				? resolvePath(
						staging,
						`${basename(from, '.svelte')}-${createHash('sha256').update(code).digest('hex').slice(0, 16)}.js`,
					)
				: own;
		emitted.set(from, out);
		if (!onDisk.has(out)) {
			onDisk.add(out);
			writeFileSync(out, code);
		}
		return out;
	}

	// A copy is compiled from what the walk rewrote, under the name of the file it copies: the
	// scoped class and the head anchor are hashes of that filename, so telling Svelte the staged
	// name would move both.
	const staged = new Map(copies.map((one) => [one.at, one]));

	function compileFile(target: string): string {
		const copy = staged.get(target);
		const from = copy?.file ?? target;
		const code = codegen(
			svelte,
			copy?.source ?? read(target, 'utf8'),
			basename(from, '.svelte'),
			from,
			root,
		);
		return copy?.fresh === undefined ? code : anchoring(code, copy.fresh);
	}

	try {
		const code = codegen(svelte, source, 'Entry', file, root);
		const entry = emit(file, fresh === undefined ? code : anchoring(code, fresh), file);
		const mod = (await timed('    load (host import)', () =>
			host.import(pathToFileURL(entry).href),
		)) as { default: unknown };
		// The prefix is what makes a `$props.id()` anchor readable after the render. See `fresh.ts`.
		const { body, head } = timedSync('    render call (svelte/server)', () =>
			render(mod.default as never, { props: props as never, idPrefix: ID_PREFIX }),
		);
		return { body, head };
	} finally {
		// The staged files stay: the next render is nearly all the same copies, and deleting them
		// would only make it write and transform and evaluate them again. `forgetStaging()` is what
		// takes them away, once nothing is going to render again.
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
