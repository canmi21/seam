/**
 * The compiler, as a Vite plugin beside SvelteKit's.
 *
 * Kit's `vite build` runs the server build first and starts the client build from inside it, and
 * this plugin changes one thing in the first and nothing in the second: the root component Kit's
 * server renders a page with. Kit's `runtime/components/root.svelte`, where `render.js` imports
 * it, is resolved to a component of this plugin's that renders from the compiled artifacts instead
 * -- `inject(ir, derive(props))` pushed into the renderer Kit's `render(Root, ...)` made -- and
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
import { configured, READING } from '@seam-js/routes';
import { ARTIFACTS, ASSETS, assetKey, type Compiling, NAME } from './compile.ts';

/** This module's own extension, which its siblings share. See spec/publish.md. */
const OWN = extname(import.meta.url);

/** The id Kit's root resolves to in the server build, marked as a module no file backs. */
const ROOT = '\0seam:root';

/** Kit's own root, as `render.js` imports it, and the one importer whose import is taken over. */
const KIT_ROOT = '/runtime/components/root.svelte';
const RENDER = '/runtime/server/page/render.js';

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
			// Kit's build, and only that: `vite dev` renders with Kit's own root. Kit 3 builds through
			// Vite's builder, one config shared by its `ssr` and `client` environments and this plugin
			// shared with it, so the config resolves once and each hook below asks which environment
			// it is in: the server's, and only that, is where the root is rendered.
			active = resolved.command === 'build' && resolved.environments['ssr'] !== undefined;
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
		resolveId(source, importer) {
			if (!active || this.environment.name !== 'ssr' || importer === undefined) return null;
			const at = resolve(dirname(importer), source).split('\\').join('/');
			if (!at.endsWith(KIT_ROOT) || !importer.split('\\').join('/').endsWith(RENDER)) return null;
			kitRoot = at;
			return ROOT;
		},

		load(id) {
			if (id !== ROOT || this.environment.name !== 'ssr') return null;
			const assets = JSON.parse(
				readFileSync(resolve(outDir, ARTIFACTS, ASSETS), 'utf8'),
			) as readonly string[];
			return dispatcher(
				kitRoot,
				emitted,
				assets.map((one) => [assetKey(one), resolve(root, one)]),
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
 * would have read. What has no artifact is rendered by Kit's own root as before: today that is the
 * error tree -- a `load` that threw, which Kit renders as the branch again with the error page as
 * its leaf, under the route's own id -- and a route the compile left to the framework, whose
 * component's module cannot be evaluated on the server and which Kit therefore answers with its
 * error response for every request. A route that does not compile otherwise fails the build
 * rather than reaching here. See spec/framework.md.
 */
function dispatcher(
	kitRootComponent: string,
	emitted: ReadonlyMap<string, string>,
	assets: ReadonlyArray<readonly [key: string, path: string]>,
): string {
	const here = createRequire(import.meta.url);
	// By path rather than by name: the module is compiled inside the project's build, where this
	// repository's package names mean nothing.
	const injector = here.resolve('@seam-js/injector');
	const derive = here.resolve('@seam-js/derive');
	// The bundler writes each reference as the asset's URL relative to the chunk it ends up in.
	const files = [...emitted]
		.map(([name, ref]) => `${JSON.stringify(name)}: import.meta.ROLLUP_FILE_URL_${ref}`)
		.join(', ');
	// Each asset a carried bundle reads the URL of, imported here so that Kit's server build answers
	// it as it answers the same import in a component. See `assetURLs` in compile.ts.
	const imports = assets
		.map(([, path], i) => `import asset_${String(i)} from ${JSON.stringify(path)};\n`)
		.join('');
	const handedAssets = assets
		.map(([key], i) => `, ${JSON.stringify(key)}: asset_${String(i)}`)
		.join('');
	return `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import KitRoot from ${JSON.stringify(kitRootComponent)};
import * as appManifest from '$app/manifest';
import * as appPaths from '$app/paths';
import { rendered_env, dynamic_private_env } from '<sveltekit:generated>/env/config.js';
import { inject } from ${JSON.stringify(injector)};
import { compile as derivations } from ${JSON.stringify(derive)};
${imports}
// What Kit's build and server decide, handed to the derivations: the manifest, \`$app/paths\`,
// whose \`resolve\` reads the request Kit is answering, the two objects
// Kit's server fills with the dynamic environment as it starts, which the carried bundle's own
// env modules read off this global, and the URL of each asset a carried bundle imports. The objects
// rather than Kit's env modules, since those read the objects as they are evaluated, and this
// module is evaluated before the server starts. See pkgs/plugin/src/app/handed.ts.
globalThis[Symbol.for('seam.kit')] = { '$app/manifest': appManifest, '$app/paths': appPaths, rendered_env, dynamic_private_env${handedAssets} };

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

// What \`render()\` writes around a root, and what an artifact's body was measured with: the pair is
// the renderer's here, so the body goes in without it.
const OPEN = '<!--[-->';
const CLOSE = '<!--]-->';

export default function Root($$renderer, props) {
	// A page's artifact stands for the page rendered with its data. An error response renders the
	// error page in its place -- a load that threw, a route nothing matched -- and that is Kit's
	// root's, under the same route id or none.
	const failed = props.error !== undefined || props.page?.error != null;
	const entry = failed ? undefined : manifest.routes[props.page?.route?.id];
	if (entry === undefined) {
		KitRoot($$renderer, props);
		return;
	}
	const { ir, derive } = artifact(entry);
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
	const injected = inject(ir, derive(payload, { transformError }), {
		csp: csp.nonce === undefined ? { hash: csp.hash === true } : { nonce: csp.nonce },
	});
	const write = (renderer, { body, head, hashes }) => {
		if (!body.startsWith(OPEN) || !body.endsWith(CLOSE)) {
			throw new Error(\`the artifact for \${entry.id} is not a root's bytes\`);
		}
		renderer.push(body.slice(OPEN.length, body.length - CLOSE.length));
		if (head !== '') renderer.head((inner) => inner.push(head));
		for (const hash of hashes?.script ?? []) csp.script_hashes.push(hash);
	};
	// A promise where a derivation awaits, which only a project in Svelte's async mode has, and
	// Kit awaits what \`render()\` returns under that mode.
	if (typeof injected.then === 'function') {
		$$renderer.child(async (inner) => write(inner, await injected));
	} else {
		write($$renderer, injected);
	}
}
`;
}
