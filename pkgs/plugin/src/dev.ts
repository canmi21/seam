/**
 * The check the dev server makes behind Kit's render: each route Kit's root renders is compiled, its
 * program run over the props the root was handed, and held to the bytes Kit wrote, none of which
 * reaches the response. See spec/build.md, "The dev server answers with Kit's render, and CTR is
 * checked behind it".
 *
 * What a build does once for every route this does per route, in this process, through a Vite
 * loader made from the project's config the way the build's is (`loaderOf`), and what it produces
 * differs from the build's in two places only. The carried names are not bundled: they are one
 * module that imports each where it lives, which the dev server's own runner loads, so a change to
 * one of them reaches the next check the way it reaches Kit's render. And the program is held here,
 * in memory, rather than written as an artifact. See spec/build.md, "How the dev server compiles a
 * route".
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import type { ModuleRunner } from 'vite/module-runner';
import { configureDevelopment } from '@seam-js/ast';
import { carriedNames, carriedSource, forgetModuleScripts } from '@seam-js/carry';
import { built, type Entry } from '@seam-js/compiler';
import { script } from '@seam-js/program';
import { configured, entries, errorEntries, type Found } from '@seam-js/routes';
import { evaluated, type Render } from '@seam-js/runtime';
import { configureRender, forgetSources, forgetTimings, timings } from '@seam-js/skeleton';
import { ARTIFACTS, LOADED_KEY, loaderOf, projectVite, standingIn } from './compile.ts';
import { type Answer, Keeping } from './keep.ts';
import { Payloads } from './payloads.ts';

/** Where the dispatcher finds what this compiled, on the framework's global. */
export const DEV = Symbol.for('seam.dev');

/** What the dispatcher reads of this module, set on the global under `DEV`. */
export interface Programs {
	/** Which error tree a failed request renders. See `Routes.failing` in `@seam-js/routes`. */
	failing: Readonly<Record<string, string>>;
	/** Whether a render is checked, which `SEAM_DEV_CHECK=off` turns off. */
	checking: boolean;
	/**
	 * The program for a route or error tree where one is compiled and current, to check this render
	 * with; otherwise undefined, and it is compiled behind the response for the next.
	 */
	ready: (key: string) => Render | undefined;
	/**
	 * The props Kit's root was handed, as the program takes them, kept for the build to hold the
	 * route's program to. See spec/together.md.
	 */
	keep: (key: string, payload: Record<string, unknown>) => void;
	/** What the program wrote beside what Kit's root wrote, over the same props. */
	compared: (key: string, ours: Answer, kit: Answer, payload: Record<string, unknown>) => void;
}

/** A route's bytes with what makes them wrong, for the check of the check. */
function wrong(done: Awaited<ReturnType<Render>>): Awaited<ReturnType<Render>> {
	return { ...done, body: `${done.body}<!--seam-fault-->` };
}

/** The program a check runs: the route's, or, for the check of the check, one writing wrong bytes. */
function checked(key: string, render: Render): Render {
	if (process.env['SEAM_DEV_FAULT'] !== key) return render;
	return (...args) => {
		const done = render(...args);
		return 'then' in done ? done.then(wrong) : wrong(done);
	};
}

/** One route or error tree, and what was last compiled of it. */
interface Held {
	found: Found;
	stale: boolean;
	/** Whether Kit's root has rendered it, which is what a recompile after an edit is for. */
	asked: boolean;
	compiling?: Promise<void>;
	program?: string;
	/** The module of carried names, or null where the route carries nothing. */
	carried?: string | null;
	/** The carried module the render was last evaluated over, which the runner hands out again until it changes. */
	module?: unknown;
	render?: Render;
	left?: string;
	/** What the compile refused, which the build renders by SSR. See spec/together.md. */
	error?: Error;
	/** The refusal last said on the terminal, so that it is said once and not once a request. */
	said?: string;
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
 * Takes the dev server's check: what the dispatcher hands over behind each response is compiled for
 * and held to Kit's bytes, and what a changed file was compiled from is marked stale and compiled
 * again.
 */
export function develop(server: ViteDevServer, options: Options): void {
	const root = server.config.root;
	const runner = (server.environments['ssr'] as unknown as { runner: ModuleRunner }).runner;
	const held = new Map<string, Held>();
	let failing: Record<string, string> = {};
	let listed: Promise<void> | null = null;
	let loader: Promise<Awaited<ReturnType<typeof loaderOf>> & { modules: ModuleRunner }> | null =
		null;
	/** One compile at a time: what a compile configures is module state, shared by every route. */
	let queue: Promise<unknown> = Promise.resolve();
	let kit: Awaited<ReturnType<typeof configured>> | undefined;
	/** Checks begun and not yet ended. */
	let inflight = 0;
	const artifacts = (): string => resolve(root, kit?.outDir ?? '.svelte-kit', ARTIFACTS);
	const keeping = new Keeping(server, () => resolve(artifacts(), 'dev.log'));
	const payloads = new Payloads(artifacts);

	const programs: Programs = {
		get failing() {
			return failing;
		},
		checking: process.env['SEAM_DEV_CHECK'] !== 'off',
		ready: (key) => {
			const one = held.get(key);
			if (
				one !== undefined &&
				!one.stale &&
				one.compiling === undefined &&
				one.render !== undefined &&
				current(one)
			) {
				return checked(key, one.render);
			}
			inflight += 1;
			void prepare(key)
				.catch((error: unknown) => {
					keeping.write(`the check of ${key} failed: ${String((error as Error)?.stack ?? error)}`);
				})
				.finally(() => {
					inflight -= 1;
					// Said when nothing is left to compile, which is what a harness waits on.
					if (inflight === 0) keeping.write('idle');
				});
			return undefined;
		},
		keep: (key, payload) => {
			// Behind the response: writing a payload is work the request need not wait on.
			setImmediate(() => {
				const what = payloads.keep(key, payload);
				if (what === 'kept') keeping.write(`kept a payload of ${key}`);
				if (what === 'unwritable') keeping.counts.unwritable += 1;
				if (what === 'kept' && inflight === 0) keeping.write('idle');
			});
		},
		compared: (key, ours, theirs, payload) => {
			inflight += 1;
			void compared(key, ours, theirs, payload)
				.catch((error: unknown) => {
					keeping.write(`the check of ${key} failed: ${String((error as Error)?.stack ?? error)}`);
				})
				.finally(() => {
					inflight -= 1;
					if (inflight === 0) keeping.write('idle');
				});
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
			const left = result.left[one.found.path] ?? result.ssr[one.found.path];
			const [route] = result.routes;
			one.left = left;
			one.error = undefined;
			if (route === undefined) {
				one.program = undefined;
				one.carried = null;
			} else {
				for (const file of route.components) depends.add(resolve(root, file));
				for (const part of route.ssr) said(one, `${part.file} renders by SSR: ${part.why}`);
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
		one.said = one.error?.message === one.said ? one.said : undefined;
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
		if (one.error !== undefined || one.program === undefined) return;
		let module: unknown = null;
		if (one.carried !== null && one.carried !== undefined) {
			try {
				module = await runner.import(one.carried);
			} catch (error) {
				// A module the page imports that throws as it is evaluated, which Kit meets as it loads the
				// page: nothing is checked, and the log says so.
				keeping.write(`what ${one.found.path} carries did not load: ${(error as Error).message}`);
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
	 * A route compiled where it has to be and evaluated over the carried module as the runner has it
	 * now, for the next render's check. A refusal is said once per route and reason, as what the build
	 * renders by SSR, and there is then nothing to check.
	 */
	async function prepare(key: string): Promise<void> {
		await list();
		const one = held.get(key);
		if (one === undefined) return;
		one.asked = true;
		await fresh(one);
		if (one.error !== undefined || one.left !== undefined) {
			said(one, one.error?.message ?? one.left ?? '');
			return;
		}
		await ready(one);
		await handLoaded([one]);
	}

	/**
	 * Whether the carried module the program was evaluated over is still the one the runner holds. An
	 * edit makes Vite drop what the server-side runner evaluated, Kit's own modules among them, and a
	 * program still bound to the modules from before reads a `$app/paths` Kit's render no longer sets.
	 */
	function current(one: Held): boolean {
		if (one.carried === null || one.carried === undefined) return true;
		for (const node of runner.evaluatedModules.getModulesByFile(one.carried) ?? []) {
			if (node.evaluated && node.exports === one.module) return true;
		}
		return false;
	}

	/** A refusal, said once per route and reason as what the build renders by SSR. */
	function said(one: Held, reason: string): void {
		if (one.said === reason) return;
		one.said = reason;
		keeping.counts.ssr += 1;
		keeping.write(`ssr ${one.found.path}: ${reason}`);
		server.config.logger.warn(
			`seam: the build renders ${one.found.path} by SSR: ${reason.split('\n').slice(0, 4).join(' ')}`,
			{ timestamp: true },
		);
	}

	/**
	 * A program's bytes beside Kit's. A disagreement is logged with both answers and the props, and the
	 * route compiled again; one that disagrees again after that is a fault.
	 */
	async function compared(
		key: string,
		ours: Answer,
		theirs: Answer,
		payload: Record<string, unknown>,
	): Promise<void> {
		const one = held.get(key);
		keeping.counts.checked += 1;
		const same =
			ours.threw !== undefined && theirs.threw !== undefined
				? true
				: ours.body === theirs.body &&
					ours.head === theirs.head &&
					JSON.stringify(ours.hashes) === JSON.stringify(theirs.hashes);
		if (same) {
			if (one !== undefined) one.recompiled = false;
			keeping.write(`held ${key}`);
			return;
		}
		const n = keeping.disagreed(key, ours, theirs, payload);
		if (one === undefined) return;
		if (one.recompiled === true) {
			await keeping.fault(
				`the program for ${key} still disagrees with Kit's render after it was compiled again (${String(n)})`,
				startOver,
			);
			return;
		}
		server.config.logger.warn(
			`seam: the program for ${key} disagreed with Kit's render (${String(n)}); compiling it again`,
			{ timestamp: true },
		);
		one.recompiled = true;
		one.stale = true;
		await fresh(one);
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
		// Compiled again once the edits stop for a moment, so the check behind the next render has a
		// program to hold, and what the edit made the build render by SSR is said as soon as it can be.
		clearTimeout(soon);
		soon = setTimeout(() => {
			for (const one of held.values()) {
				if (one.stale && one.asked) {
					void fresh(one).then(() => {
						if (one.error !== undefined) said(one, one.error.message);
					});
				}
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
