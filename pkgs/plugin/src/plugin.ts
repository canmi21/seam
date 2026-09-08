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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { configured } from 'routes';
import { ARTIFACTS, type Compiling, NAME } from './compile.ts';

/** The id Kit's generated root resolves to in the server build, marked as a module no file backs. */
const ROOT = '\0seam:root';

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
		};
		// One compile per set of inputs. `vite build` resolves the config more than once with
		// `build.ssr` set -- twice for Kit alone, three times with an adapter that builds again --
		// and each resolution is a plugin of its own asking for the same artifacts from the same
		// sources. They came out identical every time, so the second and third were the whole
		// compile run for nothing. Keyed by what the compile is told, so a build that genuinely
		// asks for something else still gets it, and held for the process because a build is
		// one-shot: `active` is false under `serve`, and `--watch` resolves the config once.
		const child = fileURLToPath(new URL('./apart.ts', import.meta.url));
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
