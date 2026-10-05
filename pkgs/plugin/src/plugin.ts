/**
 * The compiler, as a Vite plugin beside SvelteKit's.
 *
 * Kit's `vite build` runs the server build first and starts the client build from inside it, and
 * this plugin changes one thing in the first and nothing in the second: the root component Kit's
 * server renders a page with. Kit's `runtime/components/root.svelte`, where `render.js` imports
 * it, is resolved to a component of this plugin's that renders from the compiled artifacts instead
 * -- the route's program, called with the props, pushed into the renderer Kit's `render(Root, ...)` made -- and
 * everything around that call is Kit's own: routing, the `load` functions, the data script, the
 * head, the client that hydrates against the bytes. See spec/framework.md.
 *
 * The artifacts are compiled when the server build starts and written into its output beside the
 * program, as files the program reads rather than code bundled into it, because a backend that is
 * not Node reads the same files. See spec/build.md.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { builtWith, compilerOptions, configured, READING } from '@seam-js/routes';
import { moduleScripts, running } from '@seam-js/carry';
import { develop } from './dev.ts';
import {
	ARTIFACTS,
	ASSETS,
	assetKey,
	type Compiling,
	FAILING,
	NAME,
	LOADED,
	LOADED_KEY,
	REMOTES,
	remoteKey,
} from './compile.ts';

/** This module's own extension, which its siblings share. See spec/publish.md. */
const OWN = extname(import.meta.url);

/** The id Kit's root resolves to in the server build, marked as a module no file backs. */
const ROOT = '\0seam:root';

/** Kit's own root, as `render.js` imports it, and the one importer whose import is taken over. */
const KIT_ROOT = '/runtime/components/root.svelte';
const RENDER = '/runtime/server/page/render.js';

/**
 * The environment variable that makes a build refuse Kit's root: with `throw`, the dispatcher
 * throws, and says so on stderr, wherever it would have handed a render to Kit's own root. The check
 * milestone A holds a production build to -- no request runs SSR -- is the stage-two comparison and
 * Kit's specs passing under it. See spec/roadmap.md, "A: Kit's place, by an alias, with CTR where
 * SSR was".
 */
export const KIT_ROOT_CHECK = 'SEAM_KIT_ROOT';

/**
 * What this build has already compiled, written beside the artifacts. See `compileRoutes`.
 *
 * A file, because nothing in memory is shared between the resolutions that ask. Vite loads a
 * config file by bundling it and evaluating it **in a realm of its own**, and neither a
 * module-level value, nor one hung off `globalThis`, nor one hung off `process` -- which carries
 * the same pid into that realm and is a copy all the same -- is seen from both. The filesystem is
 * how the compile already talks to the build around it, so this goes there too.
 */
const STAMP = 'compiled.json';

/**
 * This build run, as two realms of one process would both name it.
 *
 * `pid` alone is reused between builds and would let a later one read an earlier one's stamp and
 * skip a compile its sources had changed under, so the process's start goes in beside it, to the
 * second -- `uptime()` is read at different moments in the two realms and agrees only that far.
 */
function run(): string {
	const started = Math.round((Date.now() - process.uptime() * 1000) / 1000);
	return `${String(process.pid)}:${String(started)}`;
}

/** A list the compile wrote beside the artifacts: the assets or the remote modules it handed. */
function listed(outDir: string, name: string): readonly string[] {
	return JSON.parse(readFileSync(resolve(outDir, ARTIFACTS, name), 'utf8')) as readonly string[];
}

export interface Options {
	/**
	 * A field whose domain the build declares, by route id: the payload paths whose values pick a
	 * structure something downstream of the markup branches on, and every value each can take. The
	 * compiler renders the route once per combination. See spec/build.md.
	 */
	enumerate?: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>;
	/**
	 * Refuse at the build a component the request hands in that the source names none of. Off by
	 * default: it renders nothing for a value that is nothing and throws per request for anything
	 * else, as Svelte throws for what is not a component. See spec/payload.md.
	 */
	refuseUnnamedComponents?: boolean;
}

export function seam(options: Options = {}): Plugin {
	let root = '';
	let active = false;
	/** Whether this is Vite's dev server, which compiles a route when it is asked for. See `develop`. */
	let serving = false;
	const scriptRun = running({ bare: true });
	const scripts = moduleScripts();
	let config: ResolvedConfig | undefined;
	/** Kit's `outDir`, where the artifacts are written. */
	let outDir = '';
	/** Kit's own root component, by the path `render.js` imports it from, once that import is met. */
	let kitRoot = '';
	/** Each artifact's reference in the bundle, by its name under the artifacts directory. */
	const emitted = new Map<string, string>();

	return {
		name: NAME,
		// Kit's root has to be caught before Vite resolves the relative import to a file.
		enforce: 'pre',

		async configResolved(resolved) {
			// A resolution `configured()` asked for, to read the project's options, and not a build:
			// this plugin is in the config it reads, and asking `configured()` back would wait on the
			// promise being waited on. See `READING`.
			if (resolved.plugins.some((one) => one.name === READING)) return;
			config = resolved;
			root = resolved.root;
			// The config this build was given, which may not be one Vite would find by itself.
			if (resolved.configFile !== undefined) builtWith(root, resolved.configFile);
			// Kit's build, and only that: `vite dev` renders with Kit's own root. Kit 3 builds through
			// Vite's builder, one config shared by its `ssr` and `client` environments and this plugin
			// shared with it, so the config resolves once and each hook below asks which environment
			// it is in: the server's, and only that, is where the root is rendered.
			active = resolved.command === 'build' && resolved.environments['ssr'] !== undefined;
			serving = resolved.command === 'serve' && resolved.environments['ssr'] !== undefined;
		},

		// Ahead of Kit's own middleware, which `configureServer` returning nothing is. See `develop`.
		configureServer(server) {
			if (serving) develop(server, options);
		},

		// Compiled when the build starts and not when the config resolves: Kit resolves it for `build`
		// to read its own options -- `svelte-kit sync` does, which a project's `prepare` runs at
		// install -- and builds nothing, so a compile there ran for nothing, under the development
		// NODE_ENV Vite defaults to, and failed. Before Kit's own `buildApp`, so the bundle has not
		// started: the compile runs Vite builds of its own for what the derivations carry, and a
		// build started from inside another's hook waits on the same native runtime and never
		// returns. See spec/build.md, "The compile starts when the build does".
		buildApp: {
			order: 'pre',
			async handler() {
				if (!active) return;
				outDir = resolve(root, (await configured(root)).outDir);
				await compileRoutes();
			},
		},

		buildStart() {
			if (!active || this.environment.name !== 'ssr') return;
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

		// The reference is written relative to the chunk here rather than left to the bundler's
		// default: Vite's own asset hook answers every emitted file too, and in a server build it
		// writes `base` joined with the file name -- a path from the site's root, which names no file
		// on disk. Running before it, as this plugin does, the first answer is this one.
		resolveFileUrl({ fileName, relativePath }) {
			if (!active || this.environment.name !== 'ssr') return null;
			if (!fileName.startsWith(`${ARTIFACTS}/`)) return null;
			return `new URL(${JSON.stringify(relativePath)}, import.meta.url).href`;
		},

		// Only the import `render.js` makes: the dispatcher imports the same file for the renders it
		// hands back to Kit, and that import is left to Svelte's plugin.
		async resolveId(source, importer, resolveOptions) {
			if (!(active || serving) || this.environment.name !== 'ssr') return null;
			// What the carried module imports under the dev server, which no bundle answers there: a
			// component's script run, and its module script. See `carriedSource` in the carry package.
			if (serving) {
				for (const one of [scriptRun, scripts]) {
					const hook = one.resolveId as
						| ((this: unknown, ...args: unknown[]) => Promise<string | null> | string | null)
						| undefined;
					const found = await hook?.call(this, source, importer, resolveOptions);
					if (found !== null && found !== undefined) return found;
				}
			}
			if (importer === undefined) return null;
			const at = resolve(dirname(importer), source).split('\\').join('/');
			if (!at.endsWith(KIT_ROOT) || !importer.split('\\').join('/').endsWith(RENDER)) return null;
			kitRoot = at;
			return ROOT;
		},

		async load(id) {
			if (this.environment.name !== 'ssr') return null;
			if (serving && id !== ROOT) {
				for (const one of [scriptRun, scripts]) {
					const hook = one.load as
						| ((this: unknown, id: string) => Promise<string | null> | string | null)
						| undefined;
					const found = await hook?.call(this, id);
					if (found !== null && found !== undefined) return found;
				}
				return null;
			}
			if (id !== ROOT) return null;
			if (serving) {
				const async = (await compilerOptions(root)).experimental?.async === true;
				return devDispatcher(kitRoot, process.env[KIT_ROOT_CHECK] === 'throw', async);
			}
			return dispatcher(
				kitRoot,
				emitted,
				listed(outDir, ASSETS).map((one) => [assetKey(one), resolve(root, one)]),
				listed(outDir, REMOTES).map((one) => [remoteKey(one), resolve(root, one)]),
				listed(outDir, LOADED).map((one) => [one, resolve(root, one)]),
				JSON.parse(readFileSync(resolve(outDir, ARTIFACTS, FAILING), 'utf8')) as Record<
					string,
					string
				>,
				process.env[KIT_ROOT_CHECK] === 'throw',
			);
		},
	};

	/**
	 * Every route compiled, in a process of its own.
	 *
	 * A compile grows a heap it never gives back -- on press, a gigabyte still referenced when it
	 * ends and two and a half more that V8 will not return -- and the bundling that follows it
	 * would otherwise start from that floor rather than from nothing. It can be a process because
	 * it already is one in every way but the last: what it produces are files under `<outDir>/seam`,
	 * which `buildStart` reads back off the disk, and nothing of it crosses into the build in
	 * memory. So the argument is one JSON string and the answer is an exit code. See `apart.ts`.
	 */
	async function compileRoutes(): Promise<void> {
		if (config === undefined) return;
		const given: Compiling = {
			root,
			configFile: config.configFile ?? null,
			outDir,
			mode: config.mode,
			...(options.enumerate === undefined ? {} : { enumerate: options.enumerate }),
			...(options.refuseUnnamedComponents === undefined
				? {}
				: { refuseUnnamedComponents: options.refuseUnnamedComponents }),
		};
		// One compile per set of inputs. `vite build` resolves the config more than once with
		// `build.ssr` set -- twice for Kit alone, three times with an adapter that builds again --
		// and each resolution is a plugin of its own asking for the same artifacts from the same
		// sources. They came out identical every time, so the second and third were the whole
		// compile run for nothing. Keyed by what the compile is told, so a build that genuinely
		// asks for something else still gets it, and held for the process because a build is
		// one-shot: `active` is false under `serve`, and `--watch` resolves the config once.
		const key = JSON.stringify(given);
		const stamp = resolve(outDir, ARTIFACTS, STAMP);
		try {
			const held = JSON.parse(readFileSync(stamp, 'utf8')) as { run: string; key: string };
			if (held.run === run() && held.key === key) return;
		} catch {
			// No stamp, or one this build did not write. Either way there is a compile to run.
		}
		const child = fileURLToPath(new URL(`./apart${OWN}`, import.meta.url));
		// Its streams are this process's: what the compile prints -- a refusal, a warning about a
		// route with a hundred structures, the timings -- is for whoever is watching the build, and
		// carrying it back through a pipe to print it again would only change where it appeared.
		const ran = spawnSync(process.execPath, [child, JSON.stringify(given)], {
			stdio: ['ignore', 'inherit', 'inherit'],
			env: process.env,
		});
		if (ran.error !== undefined) throw ran.error;
		if (ran.status !== 0) {
			// Short, because the compile has already said what went wrong on the stream above.
			throw new Error(
				ran.signal === null
					? `the compile exited ${String(ran.status)}`
					: `the compile was killed by ${ran.signal}`,
			);
		}
		// After it succeeded, so a failed compile is not remembered as a compile that happened.
		writeFileSync(stamp, `${JSON.stringify({ run: run(), key })}\n`);
	}
}

/**
 * The component that stands where Kit's root stood: a Svelte server component, `($$renderer,
 * props) => void`, since that is what Kit 3's `render.js` hands `render()` -- and what it hands it
 * are Kit's `Props`, the page, the form, the error and the `tree` of `RenderNode`s, one per level.
 *
 * A page route renders from its artifact, read beside the program: the tree's levels become the
 * generated root's `data_0..n`, and the bytes come back through the renderer Kit made -- the body
 * inside the pair `render()` itself writes around a root, the head through a head renderer, a
 * hydratable script's hash onto the policy's list -- so what Kit reads off `render()` is what it
 * would have read. An error page renders the same way, from the artifact of the tree Kit handed:
 * a `load` that threw, which Kit renders as the layouts above it and the error page nearest above,
 * or an error response, the root layout and the root error page. What has no artifact is rendered
 * by Kit's own root as before -- a route the compile left to the framework, whose modules cannot
 * be evaluated on the server and stood in for -- and a route that does not compile otherwise fails
 * the build rather than reaching here. See spec/framework.md, "What is still Kit's render".
 */
function dispatcher(
	kitRootComponent: string,
	emitted: ReadonlyMap<string, string>,
	assets: ReadonlyArray<readonly [key: string, path: string]>,
	remotes: ReadonlyArray<readonly [key: string, path: string]>,
	loaded: ReadonlyArray<readonly [key: string, path: string]>,
	failing: Readonly<Record<string, string>>,
	refuseKitRoot: boolean,
): string {
	const here = createRequire(import.meta.url);
	// By path rather than by name: the module is compiled inside the project's build, where this
	// repository's package names mean nothing.
	const runtime = here.resolve('@seam-js/runtime');
	// The bundler writes each reference as the asset's URL relative to the chunk it ends up in.
	const files = [...emitted]
		.map(([name, ref]) => `${JSON.stringify(name)}: import.meta.ROLLUP_FILE_URL_${ref}`)
		.join(', ');
	// Each asset a carried bundle reads the URL of, imported here so that Kit's server build answers
	// it as it answers the same import in a component. See `assetURLs` in compile.ts.
	const imports = assets
		.map(([, path], i) => `import asset_${String(i)} from ${JSON.stringify(path)};\n`)
		.join('');
	// Each module of remote functions a carried bundle calls, imported here so that it is the one
	// Kit's build gave its ids and registered, and runs in the request's context. See
	// `remoteModules` in compile.ts.
	const remoteImports = remotes
		.map(([, path], i) => `import * as remote_${String(i)} from ${JSON.stringify(path)};\n`)
		.join('');
	// Each component a universal `load` imports, imported here so that it is the module the `load`
	// returns -- one module of Kit's build -- and handed as a map from it to its path, which is how a
	// derivation names the one a request was handed. See spec/framework.md, "A component a `load`
	// returns".
	const loadedImports = loaded
		.map(([, path], i) => `import loaded_${String(i)} from ${JSON.stringify(path)};\n`)
		.join('');
	const loadedMap = `new Map([${loaded.map(([key], i) => `[loaded_${String(i)}, ${JSON.stringify(key)}]`).join(', ')}])`;
	const toKit = toKitSource(refuseKitRoot);
	const handedAssets = [
		...assets.map(([key], i) => `, ${JSON.stringify(key)}: asset_${String(i)}`),
		...remotes.map(([key], i) => `, ${JSON.stringify(key)}: remote_${String(i)}`),
		`, ${JSON.stringify(LOADED_KEY)}: ${loadedMap}`,
	].join('');
	return `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import KitRoot from ${JSON.stringify(kitRootComponent)};
import * as appManifest from '$app/manifest';
import * as appPaths from '$app/paths';
import * as kitExports from '@sveltejs/kit';
import { rendered_env, dynamic_private_env } from '<sveltekit:generated>/env/config.js';
import { evaluated } from ${JSON.stringify(runtime)};
${imports}${remoteImports}${loadedImports}
// What Kit's build and server decide, handed to the derivations: the manifest, \`$app/paths\`,
// whose \`resolve\` reads the request Kit is answering, the two objects
// Kit's server fills with the dynamic environment as it starts, which the carried bundle's own
// env modules read off this global, and the URL of each asset a carried bundle imports. The objects
// rather than Kit's env modules, since those read the objects as they are evaluated, and this
// module is evaluated before the server starts. See pkgs/plugin/src/app/handed.ts.
globalThis[Symbol.for('seam.kit')] = { 'import.meta.env': import.meta.env, '$app/manifest': appManifest, '$app/paths': appPaths, '@sveltejs/kit': kitExports, rendered_env, dynamic_private_env${handedAssets} };

const files = { ${files} };
// The error tree a failed render is, by its route and how many levels Kit handed. See
// \`Routes.failing\` in @seam-js/routes.
const failing = ${JSON.stringify(failing)};
const failingNow = () => failing;
const read = (name) => readFileSync(fileURLToPath(files[name]), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

// Evaluated once per route, on its first request rather than at startup.
const programs = new Map();
function programOf(entry) {
	let held = programs.get(entry.id);
	if (held === undefined) {
		held = evaluated(read(entry.script));
		programs.set(entry.id, held);
	}
	return held;
}

${rootSource(`const entry = manifest.routes[key];
	if (entry === undefined) ${toKit}
	const render = programOf(entry);`)}`;
}

/** Kit's own root, or under the check, a throw naming what would have reached it. */
function toKitSource(refuseKitRoot: boolean): string {
	return refuseKitRoot
		? `{
		const message = \`seam: Kit's root rendered under ${KIT_ROOT_CHECK}=throw: route \${props.page?.route?.id ?? '(none)'}, status \${String(props.page?.status)}, \${failed ? 'an error page' : 'no artifact'}\`;
		console.error(message);
		throw new Error(message);
	}`
		: `{
		KitRoot($$renderer, props);
		return;
	}`;
}

/**
 * The dispatcher under the dev server: the same root, reading the programs the dev server compiled
 * off the framework's global, where `develop` keeps them, rather than artifacts beside it. What a
 * build hands the carried bundle is not handed here, since the carried module is loaded by the
 * server's own runner and imports Kit's modules as Kit's code does; `import.meta.env` still is,
 * which a derivation reads as `$$env()`. A route the request asked for that has no program -- one
 * rendered without the request reaching the dev server's middleware, which Kit's own `fetch` of a
 * page does -- is rendered by Kit's root, and said once. See spec/build.md, "The dev server
 * compiles a route when it is asked for".
 */
function devDispatcher(kitRootComponent: string, refuseKitRoot: boolean, async: boolean): string {
	const toKit = toKitSource(refuseKitRoot);
	return `
import KitRoot from ${JSON.stringify(kitRootComponent)};
import { render as renderAlone } from 'svelte/server';
import { getAllContexts } from 'svelte';

// What Svelte's development runtime writes into the head about a misplaced element, once a process,
// which the program does not write: a declared difference. See spec/build.md.
const MISPLACED = new RegExp(${JSON.stringify(MISPLACED.source)}, 'g');

(globalThis[Symbol.for('seam.kit')] ??= {})['import.meta.env'] = import.meta.env;
const programs = () => globalThis[Symbol.for('seam.dev')];
const failingNow = () => programs().failing;
const said = new Set();

${rootSource(
	`const render = key === undefined ? undefined : programs().render(key);
	if (render === undefined) {
		if (key !== undefined && programs().left(key) === undefined) programs().missed(key);
		if (key !== undefined && programs().left(key) === undefined && !said.has(key)) {
			said.add(key);
			console.warn(\`seam: no program was compiled for \${key} before Kit rendered it, so Kit's root renders it, and it is compiled for the next request\`);
		}
		${toKit}
	}`,
	refereed(async),
)}`;
}

/** What Svelte's development runtime writes into the head about a misplaced element, once. */
const MISPLACED =
	/<script>console\.error\("node_invalid_placement_ssr: (?:[^"\\]|\\.)*"\)<\/script>/;

/** What writes an answer into the renderer: the pair `render()` writes taken off a body that has it. */
const WRITE = `const write = (renderer, { body, head, hashes, bare }) => {
		if (bare !== true) {
			if (!body.startsWith(OPEN) || !body.endsWith(CLOSE)) {
				throw new Error(\`the program for \${key} did not write a root's bytes\`);
			}
			body = body.slice(OPEN.length, body.length - CLOSE.length);
		}
		renderer.push(body);
		if (head !== '') renderer.head((inner) => inner.push(head));
		for (const hash of hashes?.script ?? []) csp.script_hashes.push(hash);
	};`;

/** How a build's root answers: the program's bytes, as it wrote them. */
const ANSWERING = `let injected;
	try {
		injected = render(payload, { transformError }, {
			csp: csp.nonce === undefined ? { hash: csp.hash === true } : { nonce: csp.nonce },
			bare: true,
		});
	} catch (error) {
		throw original(error);
	}
	${WRITE}
	// A promise where a derivation awaits, which only a project in Svelte's async mode has, and
	// Kit awaits what \`render()\` returns under that mode.
	if (typeof injected.then === 'function') {
		$$renderer.child(async (inner) => {
			let done;
			try {
				done = await injected;
			} catch (error) {
				throw original(error);
			}
			write(inner, done);
		});
	} else {
		write($$renderer, injected);
	}`;

/**
 * How the dev server's root answers: the program's bytes held to Kit's root, rendered alone with the
 * same props, context, policy and \`transformError\`, and Kit's where the two disagree. In Svelte's
 * async mode both are awaited, which only that mode allows. See spec/build.md, "How it keeps itself
 * right".
 */
function refereed(async: boolean): string {
	return `const options = {
		csp: csp.nonce === undefined ? { hash: csp.hash === true } : { nonce: csp.nonce },
		bare: true,
	};
	${WRITE}
	const tried = (make) => {
		try {
			return { value: make() };
		} catch (error) {
			return { error };
		}
	};
	const settled = async (one) => {
		if (one.error !== undefined) return one;
		try {
			return { value: await one.value };
		} catch (error) {
			return { error };
		}
	};
	const ours = tried(() => render(payload, { transformError }, options));
	if (!programs().checking) {
		if (ours.error !== undefined) throw original(ours.error);
		if (typeof ours.value.then === 'function') {
			$$renderer.child(async (inner) => {
				const done = await settled(ours);
				if (done.error !== undefined) throw original(done.error);
				write(inner, done.value);
			});
		} else {
			write($$renderer, ours.value);
		}
		return;
	}
	const theirs = tried(() =>
		renderAlone(KitRoot, { props, context: new Map(getAllContexts()), csp: options.csp, transformError }),
	);
	// What a policy has to allow, as a list: Svelte's render gives an empty string where there is none.
	const scripts = (hashes) => (Array.isArray(hashes?.script) ? hashes.script : []);
	const judge = (renderer, o, t) => {
		if (o.error === undefined && programs().fault === key) {
			o = { value: { ...o.value, body: \`\${o.value.body}<!--seam-fault-->\` } };
		}
		if (o.error !== undefined && t.error !== undefined) throw original(o.error);
		const mine = o.error === undefined
			? {
					body: o.value.bare === true ? OPEN + o.value.body + CLOSE : o.value.body,
					head: o.value.head,
					hashes: scripts(o.value.hashes),
				}
			: { threw: String(original(o.error)?.stack ?? o.error) };
		const kits = t.error === undefined
			? {
					body: t.value.body,
					head: t.value.head.replace(MISPLACED, ''),
					hashes: scripts(t.value.hashes),
				}
			: { threw: String(t.error?.stack ?? t.error) };
		if (
			mine.threw === undefined &&
			kits.threw === undefined &&
			mine.body === kits.body &&
			mine.head === kits.head &&
			JSON.stringify(mine.hashes) === JSON.stringify(kits.hashes)
		) {
			programs().agreed(key);
			write(renderer, o.value);
			return;
		}
		programs().disagreed(key, { ours: mine, kit: kits });
		if (t.error !== undefined) throw t.error;
		write(renderer, t.value);
	};
	${
		async
			? `$$renderer.child(async (inner) => {
		// Both at once: Svelte's render starts its async work when it is awaited, and one after the
		// other a page took twice as long, long enough for a query it left loading to settle first.
		const [o, t] = await Promise.all([settled(ours), settled(theirs)]);
		judge(inner, o, t);
	});`
			: `judge(
		$$renderer,
		ours,
		theirs.error !== undefined
			? theirs
			: tried(() => ({ body: theirs.value.body, head: theirs.value.head, hashes: theirs.value.hashes })),
	);`
	}`;
}

/**
 * The root a dispatcher exports, which renders a request from its program: `lookup` declares
 * `render` from `key`, the route's id or its error tree's, or hands the request to Kit's root.
 */
function rootSource(lookup: string, answering: string = ANSWERING): string {
	return `function treeOf(props) {
	let levels = 0;
	for (let node = props.tree; node !== undefined && node !== null; node = node.child) levels += 1;
	// \`respond_with_error\`'s two levels guard nothing; a failed load's second always has its page.
	const responding = levels === 2 && props.tree.child.error === undefined;
	return failingNow()[responding ? '' : \`\${props.page?.route?.id}\\n\${String(levels)}\`];
}

// What a derivation threw, as the author threw it: \`derive\` wraps a throw in a \`DerivationFailed\`
// naming the source, and Kit reads what reaches it by class -- a \`Redirect\` is a redirect, an
// \`HttpError\` its status -- so a query's \`redirect(307, ...)\` came out a 500. See spec/framework.md.
function original(error) {
	while (error?.name === 'DerivationFailed' && 'cause' in error) error = error.cause;
	return error;
}

// What \`render()\` writes around a root, and what an artifact's body was measured with: the pair is
// the renderer's here, so the body goes in without it.
const OPEN = '<!--[-->';
const CLOSE = '<!--]-->';

export default function Root($$renderer, props) {
	// A page's artifact stands for the page rendered with its data. An error response renders the
	// error page in its place -- a load that threw, a route nothing matched -- which is one of the
	// error trees, compiled as a page is.
	const failed = props.error !== undefined || props.page?.error != null;
	const key = failed ? treeOf(props) : props.page?.route?.id;
	${lookup}
	// The generated root's props: Kit's tree, a level per node, its data already the merge of the
	// levels above it as \`render_response\` builds it.
	const payload = { page: props.page, form: props.form, error: props.error };
	let level = 0;
	for (let node = props.tree; node !== undefined && node !== null; node = node.child) {
		payload[\`data_\${level}\`] = node.data;
		level += 1;
	}
	// Kit's render options reach a component through the renderer: its content security policy,
	// which is the script \`hydratable\` values go into, and \`transformError\`, which a boundary's
	// failed branch is written with.
	const { csp, transformError } = $$renderer.global;
	${answering}
}
`;
}
