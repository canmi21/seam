/**
 * The compile, as the plugin runs it: every route into `<outDir>/seam/server`, rendering and
 * bundling through the project's own Vite.
 *
 * Apart from the plugin because it is run apart from it. A compile grows a heap it never gets to
 * give back -- measured on press, 945MB still referenced after a full collection and 2.4GB that
 * V8 had grown and would not return to the operating system -- and the build it is part of then
 * bundles from that floor rather than from nothing. Nothing in this file's result crosses back
 * into the build in memory: what it produces are files, which `buildStart` reads off the disk. So
 * it runs in a process of its own that exits, and the memory goes with it. See `apart.ts`, and
 * spec/build.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { type Bundler, configureCarry } from 'carry';
import { compile } from 'compiler';
import { aliases, configured, entries } from 'routes';
import { configureRender } from 'skeleton';

/** The plugin's name, and the prefix of its helpers'. */
export const NAME = 'compile-time-rendering';

/** Where the compiled artifacts sit inside the server output, and so beside the built program. */
export const ARTIFACTS = 'seam';

/** What the compile has to be told, which is everything that crosses into the process it runs in. */
export interface Compiling {
	root: string;
	/** The project's Vite config file, or null to let Vite find it the way it would. */
	configFile: string | null;
	/** Kit's `outDir`, under which the artifacts are written. */
	outDir: string;
	/** See `Options.enumerate`. */
	enumerate?: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>;
}

export async function compileRoutes({
	root,
	configFile,
	outDir,
	enumerate: declared,
}: Compiling): Promise<void> {
	const found = await entries(root);
	const out = resolve(outDir, ARTIFACTS);
	// The render loads its staged copies through a Vite server made from the project's own
	// config, so that what a component imports resolves as the project's build resolves it:
	// `$lib`, `$app/*`, a virtual module of the project's plugins, `svelte` by condition.
	// Production mode and no HMR, since Svelte's `hmr` compile option changes the bytes. It
	// is a loader and not a development server, so no plugin gets to set one up: what a
	// project does in `configureServer` -- watchers, middleware, a content pipeline -- is for
	// serving, and Kit's own is what answers requests, which nothing here sends. The config
	// file is evaluated as the build it is part of, since a project's config may branch on
	// the command and do its serving work under `serve`.
	const vite = await projectVite(root);
	const loaded = await vite.loadConfigFromFile(
		{ command: 'build', mode: 'production', isSsrBuild: true },
		configFile ?? undefined,
		root,
	);
	// This plugin is in the project's config too, and a build it started must not start it
	// again: the carried bundles are built by Vite as well, and each would compile the routes.
	const plugins: Plugin[] = [];
	for (const one of await flattened(loaded?.config.plugins ?? [])) {
		if (one.name.startsWith(NAME)) continue;
		plugins.push({ ...one, configureServer: undefined, configurePreviewServer: undefined });
	}
	const loader = await vite.createServer({
		...loaded?.config,
		root,
		configFile: false,
		mode: 'production',
		appType: 'custom',
		logLevel: 'silent',
		plugins,
		server: { middlewareMode: true, hmr: false, watch: null },
		optimizeDeps: { noDiscovery: true },
	});
	configureRender({
		import: (url) => loader.ssrLoadModule(fileURLToPath(url)),
		module: (specifier) => loader.ssrLoadModule(specifier),
		staging: resolve(out, 'staged'),
		bundler: true,
		// Vite can drop a module and Node cannot, which is the whole difference between the
		// two hosts here: the copies a render stages are named for that render alone and are
		// dead the moment it ends, so the graphs are told about exactly those and about
		// nothing the project itself imports. Without it they hold every copy of every render
		// for the life of the build. See spec/build.md.
		//
		// **Two graphs, and only one of them holds the memory.** The server's
		// `moduleGraph` holds what a module was transformed into; the runner's
		// `evaluatedModules` holds what it evaluated to -- its code and its exports, which
		// is the component's whole closure graph. `ssrLoadModule` evaluates through a
		// runner of the server's own, so that is the one to tell, and telling only the
		// first is what left the compile holding two thirds of its heap in modules no
		// render would ask for again.
		forget: (files) => {
			const graph = loader.environments.ssr.moduleGraph;
			for (const file of files) {
				for (const held of graph.getModulesByFile(file) ?? []) graph.invalidateModule(held);
			}
			for (const evaluated of evaluatedGraphs(loader)) {
				for (const file of files) {
					for (const node of evaluated.getModulesByFile(file) ?? []) {
						evaluated.invalidateModule(node);
						evaluated.idToModuleMap.delete(node.id);
						evaluated.urlToIdModuleMap.delete(node.url);
					}
					evaluated.fileToModulesMap.delete(file);
				}
			}
		},
	});
	// What a derivation calls is bundled by the project's Vite as well, one build per route,
	// with everything inlined: the evaluator has no module system. Kit's plugins stay out of
	// it -- they would turn the build into Kit's server build -- and what they provide under
	// `$app/*` is given as what a derivation reads of it at request time. See `./app`.
	const { kit } = await configured(root);
	const found_aliases = Object.entries(await aliases(root));
	let n = 0;
	const carrier: Bundler = async (entry, source) => {
		n += 1;
		const file = resolve(out, 'carried', `${basename(entry, '.svelte')}-${String(n)}.js`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, source);
		const result = await vite.build({
			...loaded?.config,
			root,
			configFile: false,
			mode: 'production',
			logLevel: 'silent',
			plugins: [
				appModules(kit),
				...plugins.filter((one) => !one.name.startsWith('vite-plugin-sveltekit')),
			],
			resolve: {
				...loaded?.config.resolve,
				alias: found_aliases.map(([find, replacement]) => ({ find, replacement })),
			},
			build: {
				ssr: true,
				write: false,
				minify: false,
				emptyOutDir: false,
				copyPublicDir: false,
				lib: { entry: file, formats: ['es'], fileName: () => 'carried.js' },
				rollupOptions: { output: { inlineDynamicImports: true } },
			},
			ssr: { noExternal: true },
		});
		const outputs = Array.isArray(result) ? result : [result];
		const [first] = outputs;
		if (first === undefined || !('output' in first)) {
			throw new Error(`bundling what ${entry} carries produced nothing`);
		}
		const [chunk] = first.output;
		return chunk.code;
	};
	configureCarry(carrier);
	try {
		await compile({
			root,
			entries: found.map((one) => {
				const each = declared?.[one.path];
				return each === undefined
					? { path: one.path, component: one.component }
					: { path: one.path, component: one.component, enumerate: each };
			}),
			out,
		});
	} finally {
		configureRender(null);
		configureCarry(null);
		await loader.close();
	}
}

/**
 * A module runner's graph of what it has evaluated: the node holds the module's code and exports.
 *
 * Typed here rather than imported, because it is reached off the server rather than handed over.
 * The fields are `EvaluatedModules`' own, and a Vite that renames one drops out of `evaluatedGraphs`
 * below as a runner with nothing to forget, which costs memory rather than correctness.
 */
interface Evaluated {
	getModulesByFile: (file: string) => Set<{ id: string; url: string }> | undefined;
	invalidateModule: (node: unknown) => void;
	idToModuleMap: Map<string, unknown>;
	urlToIdModuleMap: Map<string, unknown>;
	fileToModulesMap: Map<string, unknown>;
}

/** Whether the object has the shape above, asked of what a Vite hands back rather than assumed. */
function isEvaluated(given: unknown): given is Evaluated {
	if (typeof given !== 'object' || given === null) return false;
	const one = given as Record<string, unknown>;
	return (
		typeof one['getModulesByFile'] === 'function' &&
		typeof one['invalidateModule'] === 'function' &&
		one['idToModuleMap'] instanceof Map &&
		one['urlToIdModuleMap'] instanceof Map &&
		one['fileToModulesMap'] instanceof Map
	);
}

/**
 * Every runner graph a staged module may have been evaluated into, which is more than one.
 *
 * `ssrLoadModule` evaluates through a runner the server makes for itself and keeps under
 * `_ssrCompatModuleRunner`; a runnable environment carries one of its own as `runner`. Both are
 * asked, because which of them holds a module is Vite's decision and not this plugin's, and a
 * runner that is not there is one fewer graph rather than an error.
 */
function evaluatedGraphs(loader: ViteDevServer): Evaluated[] {
	const runners = [
		(loader as unknown as Record<string, unknown>)['_ssrCompatModuleRunner'],
		(loader.environments['ssr'] as unknown as Record<string, unknown> | undefined)?.['runner'],
	];
	const found: Evaluated[] = [];
	for (const runner of runners) {
		if (typeof runner !== 'object' || runner === null) continue;
		const graph = (runner as Record<string, unknown>)['evaluatedModules'];
		if (isEvaluated(graph) && !found.includes(graph)) found.push(graph);
	}
	return found;
}

/** A config's plugins as one flat list: an entry may be a plugin, a list, a promise, or nothing. */
async function flattened(given: unknown): Promise<Plugin[]> {
	const one = await given;
	if (one === null || one === undefined || one === false) return [];
	if (Array.isArray(one)) {
		const parts = await Promise.all(one.map((each: unknown) => flattened(each)));
		return parts.flat();
	}
	return [one as Plugin];
}

/** The project's own Vite, which is the one its config and plugins were written against. */
async function projectVite(root: string): Promise<typeof import('vite')> {
	const manifest = createRequire(resolve(root, 'package.json')).resolve('vite/package.json');
	const { exports } = JSON.parse(readFileSync(manifest, 'utf8')) as {
		exports: Record<string, { import?: string | { default?: string } } | string>;
	};
	const entry = exports['.'];
	const target =
		typeof entry === 'string'
			? entry
			: typeof entry?.import === 'string'
				? entry.import
				: entry?.import?.default;
	if (target === undefined) throw new Error(`${manifest} has no import entry for '.'`);
	return (await import(
		pathToFileURL(resolve(dirname(manifest), target)).href
	)) as typeof import('vite');
}

/**
 * Kit's `$app/*` modules as the carried bundle gets them: what a derivation reads of each at
 * request time, with the project's own values written in. `$app/state` never reaches here -- the
 * walk binds `page` to the payload -- and anything else under `$app` is left to fail by name.
 */
function appModules(kit: Awaited<ReturnType<typeof configured>>['kit']): Plugin {
	const here = fileURLToPath(new URL('./app/', import.meta.url));
	const modules: Record<string, string> = {
		'$app/environment': resolve(here, 'environment.ts'),
		'$app/paths': resolve(here, 'paths.ts'),
		'$app/navigation': resolve(here, 'navigation.ts'),
	};
	const values: Record<string, string> = {
		__SEAM_VERSION__: kit.version.name,
		__SEAM_BASE__: kit.paths.base,
		__SEAM_ASSETS__: kit.paths.assets,
	};
	return {
		name: `${NAME}:app`,
		enforce: 'pre',
		resolveId(id) {
			return modules[id] ?? null;
		},
		transform(code, id) {
			if (!id.startsWith(here)) return null;
			let out = code;
			for (const [name, value] of Object.entries(values)) out = out.replaceAll(name, value);
			return { code: out, map: null };
		},
	};
}
