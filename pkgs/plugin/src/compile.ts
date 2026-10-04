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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';
import { type Bundler, configureCarry, running } from '@seam-js/carry';
import { compile } from '@seam-js/compiler';
import { aliases, configured, entries, kitSource } from '@seam-js/routes';
import { configureRender, forgetStaging } from '@seam-js/skeleton';

/** This module's own extension, which its siblings share. See spec/publish.md. */
const OWN = extname(import.meta.url);

/** The plugin's name, and the prefix of its helpers'. */
export const NAME = 'compile-time-rendering';

/** Where the compiled artifacts sit inside the server output, and so beside the built program. */
export const ARTIFACTS = 'seam';

/**
 * The imported assets whose URL the carried bundles read, beside the artifacts rather than among
 * them: it is read by the dispatcher's generation, not by the program. See `assetURLs`.
 */
export const ASSETS = 'assets.json';

/** The key an asset's URL is handed under, by its import relative to the project's root. */
export const assetKey = (imported: string): string => `asset:${imported}`;

/** What the compile has to be told, which is everything that crosses into the process it runs in. */
export interface Compiling {
	root: string;
	/** The project's Vite config file, or null to let Vite find it the way it would. */
	configFile: string | null;
	/** Kit's `outDir`, under which the artifacts are written. */
	outDir: string;
	/** See `Options.enumerate`. */
	enumerate?: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>;
	/** See `Options.refuseUnnamedComponents`. */
	refuseUnnamedComponents?: boolean;
}

export async function compileRoutes({
	root,
	configFile,
	outDir,
	enumerate: declared,
	refuseUnnamedComponents,
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
		// A server made to load modules, standing where the production build stands: Kit's plugin
		// defines `__SVELTEKIT_DEV__` from the command it sees, and this one is `serve`, so
		// `$app/environment`'s `dev` came out true and a component branching on it baked the
		// development branch. Said after Kit's own config hook, which is what `post` is for.
		plugins: [
			...plugins,
			{
				name: `${NAME}:built`,
				enforce: 'post',
				config: () => ({ define: { __SVELTEKIT_DEV__: 'false' } }),
				// Kit aliases `<sveltekit:generated>` to `generated/dev` under `serve`, which only its
				// dev server writes; the build this loader stands in has written `generated/build`,
				// and Vite's alias plugin has already rewritten the import by the time a plugin sees
				// it, so the rewritten path is what is redirected.
				resolveId(source) {
					const dev = `${resolve(outDir, 'generated/dev')}/`;
					return source.startsWith(dev)
						? `${resolve(outDir, 'generated/build')}/${source.slice(dev.length)}`
						: null;
				},
			},
		],
		server: { middlewareMode: true, hmr: false, watch: null },
		optimizeDeps: { noDiscovery: true },
		// A cache of its own. The project's holds what `vite dev` optimized, Svelte under the
		// development condition among it, and a loader that reused it rendered with Svelte's
		// development runtime. See spec/publish.md, "Where a compile writes".
		cacheDir: resolve(out, 'vite'),
	});
	configureRender({
		import: (url) => loader.ssrLoadModule(fileURLToPath(url)),
		module: (specifier) => loader.ssrLoadModule(specifier),
		staging: resolve(out, 'staged'),
		bundler: true,
		// The staged copies are named for what is in them and shared between renders, so nothing is
		// invalidated here: two renders that stage the same copy want the same module, and telling
		// the host to drop it would only have it transformed and evaluated again. See `onDisk` in
		// render.ts, and spec/build.md.
	});
	// What a derivation calls is bundled by the project's Vite as well, one build per route,
	// with everything inlined: the evaluator has no module system. Kit's plugins stay out of
	// it -- they would turn the build into Kit's server build -- and what they provide under
	// `$app/*` is given as what a derivation reads of it at request time. See `./app`.
	const kit = await configured(root);
	const found_aliases = Object.entries(await aliases(root));
	const assets = new Set<string>();
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
				assetURLs(root, assets),
				appModules(kit, root, outDir),
				// A component's script run as Svelte compiled it, which a derivation calls where
				// substitution could not follow. See `running()` in the carry package.
				{ ...running(), enforce: 'pre' } as Plugin,
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
			...(refuseUnnamedComponents === undefined ? {} : { refuseUnnamedComponents }),
		});
		writeFileSync(resolve(out, ASSETS), `${JSON.stringify([...assets].toSorted())}\n`);
	} finally {
		forgetStaging();
		configureRender(null);
		configureCarry(null);
		await loader.close();
	}
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
 * An imported asset's URL as the carried bundle gets it: a read of what Kit's server build gave the
 * same import. Kit's build decides the URL -- the hashed name under `_app/immutable/assets`, the
 * `assets` base, whether the file is inlined at all -- and this build, a library build, inlines
 * every asset as a `data:` URL whatever the project says. So the import becomes a read off the
 * global the dispatcher fills, and the import is recorded for the dispatcher to make in Kit's
 * build, where it is answered by Kit's own rules. What an import reads of the file's content
 * rather than its URL, `?raw` and `?inline`, is the compile's to decide and stays bundled. See
 * spec/framework.md.
 */
function assetURLs(root: string, found: Set<string>): Plugin {
	const HANDED = '\0seam:asset:';
	const handedModule = fileURLToPath(new URL(`./app/handed${OWN}`, import.meta.url));
	let isAsset: ((file: string) => boolean) | undefined;
	return {
		name: `${NAME}:assets`,
		enforce: 'pre',
		configResolved(config) {
			isAsset = config.assetsInclude;
		},
		async resolveId(source, importer, options) {
			if (source.startsWith('\0') || importer === undefined) return null;
			const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
			if (resolved === null || resolved.external || resolved.id.startsWith('\0')) return null;
			const [file = '', query = ''] = resolved.id.split('?', 2);
			const flags = new URLSearchParams(query);
			if (['raw', 'inline'].some((one) => flags.has(one))) return null;
			// A worker is a constructor unless `url` asks for where Kit's build put it, which is
			// `_app/immutable/workers/` and not the library build's `assets/`.
			const worker = flags.has('worker') || flags.has('sharedworker');
			if (worker && !flags.has('url')) return null;
			if (isAsset?.(file) !== true && !flags.has('url') && !flags.has('no-inline')) return null;
			const imported = `${relative(root, file).split('\\').join('/')}${query === '' ? '' : `?${query}`}`;
			found.add(imported);
			return `${HANDED}${imported}`;
		},
		load(id) {
			if (!id.startsWith(HANDED)) return null;
			const key = assetKey(id.slice(HANDED.length));
			return [
				`import { handed } from ${JSON.stringify(handedModule)};`,
				`export default handed(${JSON.stringify(key)});`,
				'',
			].join('\n');
		},
	};
}

/**
 * Kit's `$app/*` modules as the carried bundle gets them: what a derivation reads of each at
 * request time, with the project's own values written in. `$app/state` never reaches here -- the
 * walk binds `page` to the payload -- and anything else under `$app` is left to fail by name.
 */
function appModules(
	kit: Awaited<ReturnType<typeof configured>>,
	root: string,
	outDir: string,
): Plugin {
	const here = fileURLToPath(new URL('./app/', import.meta.url));
	const modules: Record<string, string> = {
		// `$app/env` is Kit 3's name for it, and `$app/environment` the one it deprecates.
		'$app/env': resolve(here, `environment${OWN}`),
		'$app/environment': resolve(here, `environment${OWN}`),
		'$app/manifest': resolve(here, `manifest${OWN}`),
		'$app/paths': resolve(here, `paths${OWN}`),
		'$app/navigation': resolve(here, `navigation${OWN}`),
		// Kit's own: `page` read out of the render's context, which a script run puts there. The
		// walk binds a component's read of `page` to the payload, so only a captured script's
		// import reaches this.
		'$app/state': resolve(
			kitSource(resolve(root, 'package.json')),
			'runtime/app/state/server.js',
		),
	};
	// The environment variables, whose module Kit generates per project: a static one is a literal
	// written into the module, a dynamic one a read of an object Kit's server fills at its start,
	// and both are named exports the project decides. The module the loader's server generated
	// says which is which, so the stub carries the literals as they are and reads the dynamic
	// ones off the object Kit's server hands in (see `./handed.ts`), at the carried bundle's own
	// evaluation, which is a route's first request. Kit's generated module reads them at its own
	// evaluation instead, which is why the object is handed rather than the module: imported from
	// the dispatcher it would be evaluated before the server set anything, and Kit's own analysis
	// of the nodes, which imports the server first, found `PUBLIC_DYNAMIC` undefined that way.
	// `$env/*` are Kit's names for the same, the dynamic ones as one `env` object.
	const envStub = (which: 'public' | 'private', asEnv: boolean): string => {
		const generated = resolve(outDir, 'generated/dev/env', which, 'server.js');
		const exports = existsSync(generated)
			? [...readFileSync(generated, 'utf8').matchAll(/^export const (\w+) = (.*);$/gm)].map(
					(one) => [one[1] as string, one[2] as string] as const,
				)
			: [];
		const object = which === 'public' ? 'rendered_env' : 'dynamic_private_env';
		return [
			`import { handed } from ${JSON.stringify(resolve(here, `handed${OWN}`))};`,
			`const held = handed(${JSON.stringify(object)});`,
			...(asEnv
				? [
						'export const env = {',
						...exports.map(([name, text]) =>
							text.startsWith('env.')
								? `\tget ${name}() { return held.${name}; },`
								: `\t${name}: ${text},`,
						),
						'};',
					]
				: exports.map(
						([name, text]) =>
							`export const ${name} = ${text.startsWith('env.') ? `held.${name}` : text};`,
					)),
			'',
		].join('\n');
	};
	const stubs: Record<string, string> = {
		'$app/env/public': envStub('public', false),
		'$app/env/private': envStub('private', false),
		'$env/static/public': envStub('public', false),
		'$env/static/private': envStub('private', false),
		'$env/dynamic/public': envStub('public', true),
		'$env/dynamic/private': envStub('private', true),
	};
	const STUB = '\0seam:app:';
	const values: Record<string, string> = {
		__SEAM_VERSION__: kit.version.name,
	};
	return {
		name: `${NAME}:app`,
		enforce: 'pre',
		resolveId(id) {
			if (id in stubs) return `${STUB}${id}`;
			return modules[id] ?? null;
		},
		load(id) {
			return id.startsWith(STUB) ? (stubs[id.slice(STUB.length)] ?? null) : null;
		},
		transform(code, id) {
			if (!id.startsWith(here)) return null;
			let out = code;
			for (const [name, value] of Object.entries(values)) out = out.replaceAll(name, value);
			return { code: out, map: null };
		},
	};
}
