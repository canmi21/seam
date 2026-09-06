/**
 * The compiler, as a Vite plugin beside SvelteKit's.
 *
 * Kit's `vite build` runs the server build first and starts the client build from inside it, and
 * this plugin changes one thing in the first and nothing in the second: the root component Kit's
 * server renders a page with. Kit's generated `root.js` is resolved to a module of this plugin's
 * that renders from the compiled artifacts instead -- `inject(ir, derive(props))` where Kit would
 * have called `root.render(props)` -- and everything around that call is Kit's own: routing, the
 * `load` functions, the data script, the head, the client that hydrates against the bytes. See
 * spec/framework.md.
 *
 * The artifacts are compiled when the server build starts and written into its output beside the
 * program, as files the program reads rather than code bundled into it, because a backend that is
 * not Node reads the same files. See spec/build.md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { type Bundler, configureCarry } from 'carry';
import { compile } from 'compiler';
import { aliases, configured, entries } from 'routes';
import { configureRender } from 'skeleton';

/** The plugin's name, and the prefix of its helpers'. */
const NAME = 'compile-time-rendering';

/** The id Kit's generated root resolves to in the server build, marked as a module no file backs. */
const ROOT = '\0seam:root';

/** Where the compiled artifacts sit inside the server output, and so beside the built program. */
const ARTIFACTS = 'seam';

export interface Options {
	/**
	 * A field whose domain the build declares, by route id: the payload paths whose values pick a
	 * structure something downstream of the markup branches on, and every value each can take. The
	 * compiler renders the route once per combination. See spec/build.md.
	 */
	enumerate?: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>;
}

export function seam(options: Options = {}): Plugin {
	let root = '';
	let active = false;
	let config: ResolvedConfig | undefined;
	/** Kit's `outDir`, where its generated root sits and where the artifacts are written. */
	let outDir = '';
	/** Each artifact's reference in the bundle, by its name under the artifacts directory. */
	const emitted = new Map<string, string>();

	return {
		name: NAME,
		// The generated root has to be caught before Vite resolves the relative import to a file.
		enforce: 'pre',

		async configResolved(resolved) {
			config = resolved;
			root = resolved.root;
			// Kit's server build, and only that: the client build Kit starts afterwards loads the
			// config file again with `build.ssr` unset, and `vite dev` renders with Kit's own root.
			active = resolved.command === 'build' && resolved.build.ssr === true;
			if (!active) return;
			outDir = resolve(root, (await configured(root)).kit.outDir);
			// Compiled here, with the config resolved and the bundle not yet started: the compile
			// runs Vite builds of its own for what the derivations carry, and a build started from
			// inside another's hook waits on the same native runtime and never returns.
			await compileRoutes();
		},

		buildStart() {
			if (!active) return;
			// Into the server output as assets, so that whatever an adapter copies the program with,
			// it copies these too; the program reaches each by the URL the bundler gives it, which is
			// right wherever the chunk that reads it lands. An artifact is named by its route's id,
			// which has directories in it.
			const server = resolve(outDir, ARTIFACTS, 'server');
			for (const file of readdirSync(server, { recursive: true, withFileTypes: true })) {
				if (!file.isFile()) continue;
				const at = resolve(file.parentPath, file.name);
				const name = relative(server, at).split('\\').join('/');
				emitted.set(
					name,
					this.emitFile({
						type: 'asset',
						fileName: `${ARTIFACTS}/${name}`,
						source: readFileSync(at),
					}),
				);
			}
		},

		resolveId(source, importer) {
			if (!active || importer === undefined || !source.endsWith('/root.js')) return null;
			const at = resolve(dirname(importer), source);
			return at === resolve(outDir, 'generated/root.js') ? ROOT : null;
		},

		load(id) {
			if (id !== ROOT) return null;
			return dispatcher(resolve(outDir, 'generated/root.svelte'), emitted);
		},
	};

	/** Every route compiled into `<outDir>/seam/server`, rendering and bundling through the project's Vite. */
	async function compileRoutes(): Promise<void> {
		if (config === undefined) return;
		{
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
				config.configFile,
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
						const enumerate = options.enumerate?.[one.path];
						return enumerate === undefined
							? { path: one.path, component: one.component }
							: { path: one.path, component: one.component, enumerate };
					}),
					out,
				});
			} finally {
				configureRender(null);
				configureCarry(null);
				await loader.close();
			}
		}
	}
}

/**
 * The module that stands where Kit's generated root stood: `render(props, options)` with the
 * shape `asClassComponent(Root).render` has, since that is what Kit's `render_response` calls.
 *
 * A page route renders from its artifact, read beside the program. What has no artifact is
 * rendered by Kit's root as before: today that is the error page, which is not compiled yet -- an
 * `+error.svelte` is not a route, and a load that throws renders it under the route's own id --
 * and nothing else, since a route that does not compile fails the build rather than reaching
 * here. See spec/framework.md.
 */
function dispatcher(rootComponent: string, emitted: ReadonlyMap<string, string>): string {
	const here = createRequire(import.meta.url);
	// By path rather than by name: the module is compiled inside the project's build, where this
	// repository's package names mean nothing.
	const injector = here.resolve('injector');
	const derive = here.resolve('derive');
	// The bundler writes each reference as the asset's URL relative to the chunk it ends up in.
	const files = [...emitted]
		.map(([name, ref]) => `${JSON.stringify(name)}: import.meta.ROLLUP_FILE_URL_${ref}`)
		.join(', ');
	return `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asClassComponent } from 'svelte/legacy';
import Root from ${JSON.stringify(rootComponent)};
import { inject } from ${JSON.stringify(injector)};
import { compile as derivations } from ${JSON.stringify(derive)};

const kit = asClassComponent(Root);
const files = { ${files} };
const read = (name) => readFileSync(fileURLToPath(files[name]), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

// Parsed once per route, on its first request rather than at startup.
const compiled = new Map();
function artifact(entry) {
	let held = compiled.get(entry.id);
	if (held === undefined) {
		const { ir, derivations: list } = JSON.parse(read(entry.ir));
		held = { ir, derive: derivations(list, entry.carried === null ? '' : read(entry.carried)) };
		compiled.set(entry.id, held);
	}
	return held;
}

export default {
	render(props, options) {
		// A page's artifact stands for the page rendered with its data. An error response renders
		// the error page in its place -- a load that threw, a route nothing matched -- and that is
		// Kit's root's, under the same route id or none.
		const failed = props.error !== undefined || props.page?.error != null;
		const entry = failed ? undefined : manifest.routes[props.page?.route?.id];
		if (entry === undefined) return kit.render(props, options);
		const { ir, derive } = artifact(entry);
		const { body, head } = inject(ir, derive(props));
		return { head, html: body, css: { code: '', map: null } };
	},
};
`;
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
