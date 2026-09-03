/**
 * The compiler, as a Vite plugin.
 *
 * The bundler is not a thing worth maintaining a copy of, and the client half of what is produced
 * here is an ordinary bundle of ordinary JavaScript. Two of the three frameworks surveyed are
 * plugins and the third's CLI buys nothing that is needed here. See spec/build.md.
 *
 * The build has two halves and they meet twice. Vite builds the client, which is what gives the
 * assets their hashed names; then this runs the compiler, which writes the server artifacts and
 * the manifest that names those assets. They also meet in `rootDir`: Svelte hashes a component's
 * filename into a head anchor and into a scoped class, and a client rooted differently from the
 * server would look for a head block that is not there.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile as compileSvelte } from 'svelte/compiler';
import type { Plugin, UserConfig } from 'vite';
import { compile, type Entry } from 'compiler';
import { announce } from './enforced.ts';
import { componentOf, idFor, isEntry, source } from './entry.ts';

export interface Options {
	/**
	 * The routes. Routing does not exist, so they are named rather than found: a URL and the
	 * component the document is rendered from. See spec/build.md.
	 */
	entries: readonly Entry[];
	/** Where the build lands. Relative to Vite's root. */
	out?: string;
	/** The document shell, with its two placeholders. Relative to Vite's root. */
	shell?: string;
}

/** A component's stylesheet, kept between compiling it and being asked for it. */
const STYLE = '?style.css';

export function seam(options: Options): Plugin {
	let root = '';
	let out = '';
	let base = '/';
	const styles = new Map<string, string>();

	return {
		name: 'compile-time-rendering',

		config(given: UserConfig) {
			const at = resolve(given.root ?? process.cwd(), options.out ?? 'dist');
			return {
				build: {
					outDir: resolve(at, 'client'),
					manifest: true,
					rollupOptions: {
						// Named, so the chunk each route produces can be found in the manifest without
						// guessing at how the bundler spelled it. One per route, all virtual: a route's
						// component travels in the id, so nothing is looked up twice.
						input: Object.fromEntries(
							options.entries.map((one) => [
								nameOf(one.component),
								idFor(resolve(given.root ?? process.cwd(), one.component)),
							]),
						),
					},
				},
			};
		},

		configResolved(config) {
			root = config.root;
			base = config.base;
			out = resolve(root, options.out ?? 'dist');
			announce(config.inlineConfig, config as unknown as UserConfig);
		},

		resolveId(id) {
			if (isEntry(id)) return `\0${id}`;
			if (componentOf(id) !== null) return id;
			return id.endsWith(STYLE) ? id : null;
		},

		load(id) {
			const component = componentOf(id);
			if (component !== null) return source(component);
			return styles.get(id) ?? null;
		},

		transform(code, id) {
			// A virtual id is not a file, and one of them ends in `.svelte` because the component it
			// hydrates is named in it. Compiling the generated entry as a component is what that
			// oversight did, and the build emitted nothing with no error to say why.
			if (id.startsWith('\0') || !id.endsWith('.svelte')) return null;
			// `rootDir` rather than a rewritten filename: it is what Svelte relativises against
			// before hashing, and the server half passes the same thing. See spec/build.md.
			const compiled = compileSvelte(code, {
				generate: 'client',
				filename: id,
				rootDir: root,
				dev: false,
			});
			if (compiled.css === null) return { code: compiled.js.code, map: compiled.js.map };

			// Handed back to Vite as a module the component imports, which is how it reaches the
			// bundle's stylesheet rather than being injected by the component at runtime.
			const style = `${id}${STYLE}`;
			styles.set(style, compiled.css.code);
			return {
				code: `${compiled.js.code}\nimport ${JSON.stringify(style)};`,
				map: compiled.js.map,
			};
		},

		// After the client half is on disk, because that is what gives the assets their names.
		async closeBundle() {
			const client = resolve(out, 'client');
			const manifest = JSON.parse(
				readFileSync(resolve(client, '.vite/manifest.json'), 'utf8'),
			) as Record<string, Chunk>;

			// Looked up by the name the entry was given rather than by its id. Vite writes the
			// manifest's keys relative to the root, which turns a virtual id into a path with `../`
			// in front of it, and matching on that would be matching on how a directory happened to
			// be nested.
			const named = new Map<string, Chunk>();
			for (const chunk of Object.values(manifest)) {
				if (chunk.isEntry === true && chunk.name !== undefined) named.set(chunk.name, chunk);
			}

			// The tags are written here rather than composed by a server, and they are handed to the
			// compiler rather than written over its manifest afterwards: one thing writes the file.
			const assets: Record<string, string> = {};
			for (const one of options.entries) {
				const chunk = named.get(nameOf(one.component));
				if (chunk !== undefined) assets[one.path] = tags(base, chunk);
			}

			await compile({
				root,
				entries: options.entries,
				out,
				shell: resolve(root, options.shell ?? 'app.html'),
				assets,
			});
		},
	};
}

/** A chunk name for a route, which is what the bundler puts in the output filename. */
function nameOf(component: string): string {
	return component
		.replace(/\.svelte$/, '')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** The part of Vite's manifest entry this reads. */
interface Chunk {
	file: string;
	name?: string;
	isEntry?: boolean;
	css?: string[];
	imports?: string[];
}

/** What one route's document has to load, as the string a server concatenates. */
function tags(base: string, chunk: Chunk): string {
	const href = (file: string): string => `${base.endsWith('/') ? base : `${base}/`}${file}`;
	const parts = [
		...(chunk.imports ?? []).map((one) => `<link rel="modulepreload" href="${href(one)}">`),
		...(chunk.css ?? []).map((one) => `<link rel="stylesheet" href="${href(one)}">`),
		`<script type="module" src="${href(chunk.file)}"></script>`,
	];
	return parts.join('');
}
