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
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { compile } from 'compiler';
import { configured, entries } from 'routes';
import { configureRender } from 'skeleton';

/** The id Kit's generated root resolves to in the server build, marked as a module no file backs. */
const ROOT = '\0seam:root';

/** Where the compiled artifacts sit inside the server output, and so beside the built program. */
const ARTIFACTS = 'seam';

export function seam(): Plugin {
	let root = '';
	let active = false;
	let config: ResolvedConfig | undefined;
	/** Kit's `outDir`, where its generated root sits and where the artifacts are written. */
	let outDir = '';
	/** Each artifact's reference in the bundle, by its name under the artifacts directory. */
	const emitted = new Map<string, string>();

	return {
		name: 'compile-time-rendering',
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
		},

		async buildStart() {
			if (!active || config === undefined) return;
			const found = await entries(root);
			const out = resolve(outDir, ARTIFACTS);
			// The render loads its staged copies through a Vite server made from the project's own
			// config, so that what a component imports resolves as the project's build resolves it:
			// `$lib`, `$app/*`, a virtual module of the project's plugins, `svelte` by condition.
			// Production mode and no HMR, since Svelte's `hmr` compile option changes the bytes.
			const vite = await projectVite(root);
			const loader = await vite.createServer({
				root,
				configFile: config.configFile,
				mode: 'production',
				appType: 'custom',
				logLevel: 'silent',
				server: { middlewareMode: true, hmr: false, watch: null },
				optimizeDeps: { noDiscovery: true },
			});
			configureRender({
				import: (url) => loader.ssrLoadModule(fileURLToPath(url)),
				module: (specifier) => loader.ssrLoadModule(specifier),
				staging: resolve(out, 'staged'),
				bundler: true,
			});
			try {
				await compile({
					root,
					entries: found.map((one) => ({ path: one.path, component: one.component })),
					out,
				});
			} finally {
				configureRender(null);
				await loader.close();
			}
			// Into the server output as assets, so that whatever an adapter copies the program with,
			// it copies these too; the program reaches each by the URL the bundler gives it, which is
			// right wherever the chunk that reads it lands. An artifact is named by its route's id,
			// which has directories in it.
			const server = resolve(out, 'server');
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
}

/**
 * The module that stands where Kit's generated root stood: `render(props, options)` with the
 * shape `asClassComponent(Root).render` has, since that is what Kit's `render_response` calls.
 *
 * A page route renders from its artifact, read beside the program. What has no artifact is
 * rendered by Kit's root as before: today that is the error page, which is not compiled yet -- an
 * `+error.svelte` is not a route -- and nothing else, since a route that does not compile fails the
 * build rather than reaching here. See spec/framework.md.
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
		const entry = props.error === undefined ? manifest.routes[props.page?.route?.id] : undefined;
		if (entry === undefined) return kit.render(props, options);
		const { ir, derive } = artifact(entry);
		const { body, head } = inject(ir, derive(props));
		return { head, html: body, css: { code: '', map: null } };
	},
};
`;
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
