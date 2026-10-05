/**
 * The compile, as the dev server runs it: a route compiled when a request first asks for it, and
 * again once a file it was compiled from changes, held in memory rather than written as the
 * build's artifacts. See spec/build.md, "How the dev server compiles a route".
 *
 * What a build does once for every route this does per route, in this process, through a Vite
 * loader made from the project's config the way the build's is (`loaderOf`), and what it produces
 * differs from the build's in two places only. The carried names are not bundled: they are one
 * module that imports each where it lives, which the dev server's own runner loads, so a change to
 * one of them reaches the next request the way it reaches Kit's. And the program is evaluated here
 * and handed to the dispatcher through the framework's global, since the dispatcher is evaluated
 * by that runner and a program is not a module of it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, ViteDevServer } from 'vite';
import type { ModuleRunner } from 'vite/module-runner';
import { configureDevelopment } from '@seam-js/ast';
import { carriedNames, carriedSource, forgetModuleScripts } from '@seam-js/carry';
import { built, type Entry } from '@seam-js/compiler';
import { script } from '@seam-js/program';
import { configured, entries, errorEntries, type Found, parsed, RESPONDING } from '@seam-js/routes';
import { evaluated, type Render } from '@seam-js/runtime';
import { configureRender, forgetSources, forgetTimings, timings } from '@seam-js/skeleton';
import { ARTIFACTS, LOADED_KEY, loaderOf, projectVite, standingIn } from './compile.ts';
import { type Answer, Keeping } from './keep.ts';

/** Where the dispatcher finds what this compiled, on the framework's global. */
export const DEV = Symbol.for('seam.dev');

/** What the dispatcher reads of this module, set on the global under `DEV`. */
export interface Programs {
	/** The render for a route id or an error tree's id, or undefined where none was compiled. */
	render: (key: string) => Render | undefined;
	/** Why a route was left to the framework, by its id, or undefined where it was not. */
	left: (key: string) => string | undefined;
	/**
	 * Told of a route rendered without a program, which a request the middleware did not see -- a
	 * page Kit's own `fetch` renders inside another request -- is: compiled now, for the next one.
	 */
	missed: (key: string) => void;
	/** Which error tree a failed request renders. See `Routes.failing` in `@seam-js/routes`. */
	failing: Readonly<Record<string, string>>;
	/** Whether a render is held to Kit's root, which `SEAM_DEV_CHECK=off` turns off. */
	checking: boolean;
	/** The route whose program is made to write the wrong bytes, for the check of the ladder. */
	fault: string | undefined;
	/** Told a route's program wrote what Kit's root did. */
	agreed: (key: string) => void;
	/** Told a route's program wrote something else, with both answers. */
	disagreed: (key: string, answers: { ours: Answer; kit: Answer }) => void;
}

/**
 * A file, and not a directory: a page's path is often a directory of the project's too -- Kit's
 * `basics` serves `/static` and keeps a `static/static` -- and Vite answers neither.
 */
function isFile(at: string): boolean {
	return statSync(at, { throwIfNoEntry: false })?.isFile() === true;
}

/** One route or error tree, and what was last compiled of it. */
interface Held {
	found: Found;
	stale: boolean;
	/** Whether a request has asked for it, which is what a recompile ahead of the next one is for. */
	asked: boolean;
	compiling?: Promise<void>;
	program?: string;
	/** The module of carried names, or null where the route carries nothing. */
	carried?: string | null;
	/** The carried module the render was last evaluated over, which the runner hands out again until it changes. */
	module?: unknown;
	render?: Render;
	left?: string;
	error?: Error;
	/** The files it was compiled from, which a change to makes it stale. */
	depends: Set<string>;
	/** Whether it has been compiled again for a disagreement since a file of it last changed. */
	recompiled?: boolean;
}

interface Options {
	enumerate?: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>;
	refuseUnnamedComponents?: boolean;
}

/**
 * Takes the dev server: compiles what a request is about to render before Kit renders it, and
 * marks stale what a changed file was compiled from. Called from `configureServer`, so that the
 * middleware runs ahead of Kit's.
 */
export function develop(server: ViteDevServer, options: Options): void {
	const root = server.config.root;
	const runner = (server.environments['ssr'] as unknown as { runner: ModuleRunner }).runner;
	const held = new Map<string, Held>();
	let failing: Record<string, string> = {};
	let pages: { id: string; pattern: RegExp }[] = [];
	let listed: Promise<void> | null = null;
	let loader: Promise<Awaited<ReturnType<typeof loaderOf>> & { modules: ModuleRunner }> | null =
		null;
	/** One compile at a time: what a compile configures is module state, shared by every route. */
	let queue: Promise<unknown> = Promise.resolve();
	let kit: Awaited<ReturnType<typeof configured>> | undefined;
	const keeping = new Keeping(server, () =>
		resolve(root, kit?.outDir ?? '.svelte-kit', ARTIFACTS, 'dev.log'),
	);

	const programs: Programs = {
		render: (key) => held.get(key)?.render,
		left: (key) => held.get(key)?.left,
		missed: (key) => {
			const one = held.get(key);
			if (one === undefined) return;
			one.asked = true;
			void behind(one);
		},
		get failing() {
			return failing;
		},
		checking: process.env['SEAM_DEV_CHECK'] !== 'off',
		fault: process.env['SEAM_DEV_FAULT'],
		agreed: (key) => {
			keeping.counts.refereed += 1;
			const one = held.get(key);
			if (one !== undefined) one.recompiled = false;
		},
		disagreed: (key, { ours, kit: theirs }) => {
			keeping.counts.refereed += 1;
			const n = keeping.disagreed(key, ours, theirs);
			const one = held.get(key);
			if (one === undefined) return;
			if (one.recompiled === true) {
				void keeping.fault(
					`the program for ${key} still disagrees with Kit's render after it was compiled again (${String(n)})`,
					startOver,
				);
				return;
			}
			server.config.logger.warn(
				`seam: the program for ${key} disagreed with Kit's render (${String(n)}): answered with Kit's, and compiling it again`,
				{ timestamp: true },
			);
			one.recompiled = true;
			one.stale = true;
			void behind(one);
		},
	};
	(globalThis as Record<symbol, unknown>)[DEV] = programs;

	/** The routes and error trees, found again where a file under the routes was added or removed. */
	function list(): Promise<void> {
		listed ??= (async () => {
			kit = await configured(root);
			const trees = await errorEntries(root);
			const found = [...(await entries(root)), ...trees.found];
			failing = trees.failing;
			const before = new Map(held);
			held.clear();
			for (const one of found) {
				const was = before.get(one.path);
				held.set(one.path, {
					found: one,
					stale: true,
					asked: was?.asked ?? false,
					depends: new Set(),
				});
			}
			pages = found
				.filter((one) => !one.path.startsWith('#'))
				.map((one) => ({ id: one.path, pattern: parsed(one.path).pattern }));
		})();
		return listed;
	}

	/** The loader a compile renders through, made once and kept for the server's life. */
	function loaderNow(): NonNullable<typeof loader> {
		loader ??= (async () => {
			const vite = await projectVite(root);
			const made = await loaderOf(vite, {
				root,
				configFile: server.config.configFile ?? null,
				outDir: resolve(root, (await configured(root)).outDir),
				mode: server.config.mode,
				command: 'serve',
			});
			const modules = vite.createServerModuleRunner(made.loader.environments['ssr'] as never, {
				hmr: false,
			});
			return { ...made, modules };
		})();
		return loader;
	}

	/** How `vite-plugin-svelte` compiles under this server, which is what the bytes are. */
	function development(): { hmr: boolean; emitCss: boolean } {
		const svelte = server.config.plugins.find((one) => one.name === 'vite-plugin-svelte:config') as
			| { api?: { options?: { emitCss?: boolean; compilerOptions?: { hmr?: boolean } } } }
			| undefined;
		const given = svelte?.api?.options;
		return {
			hmr: given?.compilerOptions?.hmr === true,
			emitCss: given?.emitCss !== false,
		};
	}

	async function compile(one: Held): Promise<void> {
		const { modules } = await loaderNow();
		const outDir = resolve(root, (await configured(root)).outDir);
		const out = resolve(outDir, ARTIFACTS, 'dev');
		const depends = new Set<string>();
		const entered = new Set<string>();
		const started = performance.now();
		configureDevelopment(development());
		configureRender({
			import: (url) => {
				entered.add(fileURLToPath(url));
				return modules.import(fileURLToPath(url));
			},
			module: (specifier) => modules.import(specifier),
			staging: resolve(out, 'staged'),
			bundler: true,
			staged: (file) => depends.add(resolve(file)),
		});
		const entry: Entry = {
			path: one.found.path,
			component: one.found.component,
			...(one.found.page.loaded.length === 0 ? {} : { loaded: one.found.page.loaded }),
			...(options.enumerate?.[one.found.path] === undefined
				? {}
				: { enumerate: options.enumerate[one.found.path] }),
		};
		try {
			const result = await built({
				root,
				entries: [entry],
				out,
				...(options.refuseUnnamedComponents === undefined
					? {}
					: { refuseUnnamedComponents: options.refuseUnnamedComponents }),
				unevaluable: async (given) => {
					const component = await standingIn(one.found, root, (file) => modules.import(file));
					return component === null ? null : { ...given, component };
				},
			});
			for (const warning of result.warnings) server.config.logger.warn(`seam: ${warning}`);
			const left = result.left[one.found.path];
			const [route] = result.routes;
			one.left = left;
			one.error = undefined;
			if (route === undefined) {
				one.program = undefined;
				one.carried = null;
			} else {
				for (const file of route.components) depends.add(resolve(root, file));
				one.program = script(route.structure, '', carriedNames(route.names, route.file, true));
				const source = carriedSource(route.file, route.names);
				if (source === '') one.carried = null;
				else {
					const name = createHash('sha256').update(`${route.file}\n${source}`).digest('hex');
					const file = resolve(out, 'carried', `${name.slice(0, 16)}.js`);
					mkdirSync(dirname(file), { recursive: true });
					writeFileSync(file, `${source}\n`);
					one.carried = file;
				}
			}
			one.module = undefined;
			one.render = undefined;
		} catch (error) {
			one.error = error as Error;
			one.program = undefined;
			one.render = undefined;
		} finally {
			configureRender(null);
			configureDevelopment(null);
		}
		// What the renders loaded through the loader, followed down its imports: a module a component
		// imports is a file the route was compiled from as much as the component is.
		const seen = new Set<string>();
		const walk = (id: string): void => {
			if (seen.has(id)) return;
			seen.add(id);
			const node = modules.evaluatedModules.getModuleById(id);
			if (node === undefined) return;
			if (node.file !== '' && !node.file.includes('/node_modules/')) depends.add(node.file);
			for (const next of node.imports) walk(next);
		};
		for (const file of entered) {
			for (const node of modules.evaluatedModules.getModulesByFile(file) ?? []) walk(node.id);
		}
		for (const file of one.found.page.loaded) depends.add(resolve(root, file));
		one.depends = depends;
		one.stale = false;
		keeping.counts.compiles += 1;
		keeping.write(
			`compiled ${one.found.path} in ${String(Math.round(performance.now() - started))}ms${one.error === undefined ? '' : `, refused: ${one.error.message.split('\n')[0] ?? ''}`}`,
		);
		if (one.error === undefined) {
			const took = Math.round(performance.now() - started);
			server.config.logger.info(`seam: compiled ${one.found.path} in ${String(took)}ms`, {
				timestamp: true,
			});
		}
		// Where the time went, when asked for, as the build's compile says it. See spec/build.md.
		if (process.env['SEAM_TIME'] !== undefined) {
			const report = timings();
			if (report !== '') console.error(`[seam] ${one.found.path}:\n${report}`);
			forgetTimings();
		}
	}

	/** Compiled where it is stale, in the queue, and once however many requests ask at once. */
	function fresh(one: Held): Promise<void> {
		if (!one.stale) return Promise.resolve();
		one.compiling ??= (queue = queue.then(
			() => compile(one),
			() => compile(one),
		)).finally(() => {
			one.compiling = undefined;
		}) as Promise<void>;
		return one.compiling;
	}

	/**
	 * The program evaluated over the carried module as the runner has it now: a module it imports
	 * that changed is evaluated again by the runner, and the program is evaluated again over it.
	 */
	async function ready(one: Held): Promise<void> {
		if (one.error !== undefined) throw one.error;
		if (one.program === undefined) return;
		let module: unknown = null;
		if (one.carried !== null && one.carried !== undefined) {
			try {
				module = await runner.import(one.carried);
			} catch (error) {
				// A module the page imports that throws as it is evaluated, which Kit meets as it loads the
				// page and answers with its error page: the request is Kit's to answer, as it is in a
				// build, and nothing renders from this. Said, in case Kit's load of the page succeeds.
				server.config.logger.warn(
					`seam: what ${one.found.path} carries did not load, so Kit answers it: ${(error as Error).message}`,
					{ timestamp: true },
				);
				one.render = undefined;
				one.module = undefined;
				return;
			}
		}
		if (one.render !== undefined && module === one.module) return;
		const files = (module as { files?: Record<string, Record<string, unknown>> } | null)?.files;
		try {
			one.render = evaluated(one.program, files ?? {});
		} catch (error) {
			// A program this compiler wrote that does not evaluate is its fault, never the author's.
			one.render = undefined;
			await keeping.fault(
				`the program for ${one.found.path} does not evaluate: ${(error as Error).message}`,
				startOver,
			);
			throw error;
		}
		one.module = module;
	}

	/** The components a universal `load` imports, as the runner has them, handed to `$$loaded`. */
	async function handLoaded(keys: readonly Held[]): Promise<void> {
		const handed = ((globalThis as Record<symbol, Record<string, unknown> | undefined>)[
			Symbol.for('seam.kit')
		] ??= {});
		const map = handed[LOADED_KEY] instanceof Map ? handed[LOADED_KEY] : new Map();
		for (const one of keys) {
			for (const file of one.found.page.loaded) {
				let module: { default?: unknown };
				try {
					module = (await runner.import(resolve(root, file))) as { default?: unknown };
				} catch {
					// Kit's to answer, as above.
					continue;
				}
				for (const [component, key] of map) if (key === file) map.delete(component);
				map.set(module.default, file);
			}
		}
		handed[LOADED_KEY] = map;
	}

	/**
	 * Whether Vite answers the path before Kit is asked: its own modules, a file of the project's, a
	 * dependency, a static asset. This middleware runs ahead of all of them, and a route matching
	 * every path would otherwise hold each module the page loads until the route compiled.
	 */
	function servedByVite(pathname: string): boolean {
		if (/^\/(?:@|node_modules\/|__)/.test(pathname)) return true;
		let path: string;
		try {
			path = decodeURIComponent(pathname);
		} catch {
			return false;
		}
		if (path === '/' || path.endsWith('/')) return false;
		const assets = kit?.files.assets;
		return (
			isFile(resolve(root, `.${path}`)) ||
			(assets !== undefined && isFile(resolve(root, assets, `.${path}`)))
		);
	}

	/**
	 * What a request for `pathname` may render: the routes it matches, or the tree an unmatched one
	 * renders, which it renders; and the error trees a failure under those routes renders, which it
	 * may.
	 */
	function asked(pathname: string, html: boolean): { routes: Held[]; trees: Held[] } {
		const none = { routes: [], trees: [] };
		if (servedByVite(pathname)) return none;
		const base = kit?.paths.base ?? '';
		let path = pathname;
		if (base !== '') {
			if (path !== base && !path.startsWith(`${base}/`)) return none;
			path = path.slice(base.length) || '/';
		}
		const appDir = kit?.appDir ?? '_app';
		if (path.startsWith(`/${appDir}/`) || path.endsWith('/__data.json')) return none;
		// Decoded as Kit's `decode_pathname` decodes it, which leaves `%25` as it is: a route whose id
		// escapes a `%` matches it encoded.
		try {
			path = path.split('%25').map(decodeURI).join('%25');
		} catch {
			// Kit answers a malformed path with an error page, which is the tree below.
		}
		const matched = pages.filter((one) => one.pattern.test(path)).map((one) => one.id);
		if (matched.length === 0 && !html) return none;
		const trees = new Set<string>();
		const responding = failing[RESPONDING];
		if (responding !== undefined) trees.add(responding);
		for (const id of matched) {
			for (const [key, tree] of Object.entries(failing)) {
				if (key.startsWith(`${id}\n`)) trees.add(tree);
			}
		}
		return matched.length === 0
			? { routes: heldOf(trees), trees: [] }
			: { routes: heldOf(matched), trees: heldOf(trees) };
	}

	function heldOf(keys: Iterable<string>): Held[] {
		return [...keys].flatMap((key) => {
			const one = held.get(key);
			return one === undefined ? [] : [one];
		});
	}

	/**
	 * The path Kit renders for `url` where the project's universal `reroute` hook changes it: Kit
	 * matches the route against what the hook returns, so that is the route a request renders. Asked
	 * as Kit asks it, with a `fetch` of the server's own; a hook that throws is Kit's to answer.
	 */
	async function rerouted(url: URL): Promise<string | null> {
		const universal = kit?.files.hooks.universal;
		if (universal === undefined) return null;
		const file = [...(kit?.moduleExtensions ?? ['.js', '.ts'])]
			.map((extension) => `${universal}${extension}`)
			.find((one) => existsSync(one));
		if (file === undefined) return null;
		try {
			const hooks = (await runner.import(file)) as {
				reroute?: (event: { url: URL; fetch: typeof fetch }) => unknown;
			};
			if (typeof hooks.reroute !== 'function') return null;
			const path = await hooks.reroute({
				url: new URL(url),
				fetch: (input, init) =>
					fetch(typeof input === 'string' ? new URL(input, url) : input, init),
			});
			return typeof path === 'string' ? path : null;
		} catch {
			return null;
		}
	}

	/** Whether Kit's root is refused, under which nothing is left to compile behind a request. */
	const strict = process.env['SEAM_KIT_ROOT'] === 'throw';

	/** Compiled and evaluated behind the request that asked, a refusal said where the page is open. */
	async function behind(one: Held): Promise<void> {
		await fresh(one);
		if (one.error !== undefined) {
			told(one.error);
			return;
		}
		await ready(one).catch(() => {});
	}

	/**
	 * The second rung: this compiler starts over and Vite does not. The loader is closed and made
	 * again, every program is dropped, and what the compile remembers of files is forgotten.
	 */
	async function startOver(): Promise<void> {
		const was = loader;
		loader = null;
		await was?.then(({ loader: vite }) => vite.close()).catch(() => {});
		forgetSources();
		forgetModuleScripts();
		for (const one of held.values()) {
			one.stale = true;
			one.recompiled = false;
			one.program = undefined;
			one.render = undefined;
			one.module = undefined;
			one.depends = new Set();
		}
		listed = null;
	}

	/** A refusal met behind a request, said on the terminal and on the page open in the browser. */
	function told(error: Error): void {
		server.config.logger.error(`seam: ${error.message}`);
		server.environments['client']?.hot.send({
			type: 'error',
			err: { message: error.message, stack: error.stack ?? '' },
		});
	}

	const middleware: Connect.NextHandleFunction = (req, _res, next) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			next();
			return;
		}
		void (async () => {
			try {
				await list();
				const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
				const html = (req.headers.accept ?? '').includes('text/html');
				const instead = await rerouted(url);
				const direct = asked(url.pathname, html);
				const rerouting = instead === null ? { routes: [], trees: [] } : asked(instead, true);
				const routes = [...new Set([...direct.routes, ...rerouting.routes])];
				const trees = [...new Set([...direct.trees, ...rerouting.trees])].filter(
					(one) => !routes.includes(one),
				);
				if (routes.length > 0) keeping.counts.requests += 1;
				for (const one of routes) {
					one.asked = true;
					await fresh(one);
					await ready(one);
				}
				// An error tree is compiled behind the request rather than ahead of it: most requests
				// render none, and a failure before it is ready is rendered by Kit's root, once. Under
				// the check that refuses Kit's root, ahead of it.
				for (const one of trees) {
					one.asked = true;
					if (strict) {
						await fresh(one);
						await ready(one);
					} else {
						void behind(one);
					}
				}
				await handLoaded(routes);
				next();
			} catch (error) {
				next(error);
			}
		})();
	};
	server.middlewares.use(middleware);

	/** A change: forgotten wherever it was remembered, and what was compiled from it is stale. */
	let soon: ReturnType<typeof setTimeout> | undefined;
	const changed = (file: string, structural: boolean): void => {
		forgetSources();
		forgetModuleScripts();
		void loader?.then(({ loader: vite, modules }) => {
			vite.environments['ssr']?.moduleGraph.onFileChange(file);
			const gone = new Set<string>();
			const drop = (id: string): void => {
				if (gone.has(id)) return;
				gone.add(id);
				const node = modules.evaluatedModules.getModuleById(id);
				if (node === undefined) return;
				modules.evaluatedModules.invalidateModule(node);
				for (const importer of node.importers) drop(importer);
			};
			for (const node of modules.evaluatedModules.getModulesByFile(file) ?? []) drop(node.id);
		});
		const routesDir = kit?.files.routes;
		if (structural && routesDir !== undefined && file.startsWith(`${resolve(root, routesDir)}/`)) {
			listed = null;
			return;
		}
		let any = false;
		for (const one of held.values()) {
			if (one.stale) continue;
			if (one.error !== undefined || one.depends.has(file)) {
				one.stale = true;
				one.recompiled = false;
				any ||= one.asked;
			}
		}
		if (!any) return;
		// Compiled again ahead of the request that will ask, once the edits stop for a moment; a
		// refusal is sent to the page open in the browser, which has already taken the change.
		clearTimeout(soon);
		soon = setTimeout(() => {
			for (const one of held.values()) {
				if (one.stale && one.asked) void behind(one);
			}
		}, 100);
	};
	server.watcher.on('change', (file) => changed(resolve(file), false));
	server.watcher.on('add', (file) => changed(resolve(file), true));
	server.watcher.on('unlink', (file) => changed(resolve(file), true));
	server.httpServer?.once('close', () => {
		void loader?.then(({ loader: vite }) => vite.close());
	});
}
