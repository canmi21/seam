/**
 * A project's routes, read the way SvelteKit reads them.
 *
 * `src/routes` is walked by Kit's own `create_manifest_data`, under a config Kit's own validator
 * fills in from the defaults, so a route id, a layout chain, an error page and a parameter are
 * exactly what they are to Kit. What comes out here is the part a compile needs: for every route
 * that has a page, the components down its branch -- each layout, then the page -- in the order
 * Kit renders them, and how deep the deepest branch goes, which is what the generated root is
 * sized to. See spec/framework.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from 'vite';
import { kitModule } from './kit.ts';

const { extract_svelte_config, process_config, validate_config } =
	await kitModule<typeof import('@sveltejs/kit/src/core/config/index.js')>('core/config/index.js');
const { default: create_manifest_data } = await kitModule<
	typeof import('@sveltejs/kit/src/core/sync/create_manifest_data/index.js')
>('core/sync/create_manifest_data/index.js');

export interface Page {
	/** Kit's route id: `/blog/[slug]`, with groups and parameters spelled as Kit spells them. */
	id: string;
	/** The names the route's parameters bind, in order. */
	params: string[];
	/**
	 * The components down the branch, relative to the project root: every layout that applies,
	 * outermost first, then the page. `data_0` .. `data_n` go to these in this order. A level
	 * whose node has no component -- a `+page.js` with no `+page.svelte` beside it, which Kit
	 * allows and renders as nothing -- is `null`.
	 */
	branch: (string | null)[];
	/**
	 * The `+error.svelte` each level's boundary renders when what is inside it throws, one entry
	 * per entry of `branch`, and `undefined` where the level has none. Kit's `build_error_chain`:
	 * the error page declared beside the layout directly above the level, rewound past a depth
	 * with no layout, and never one for the root layout, whose failure is `error.html`.
	 */
	errors: (string | undefined)[];
	/**
	 * The components a universal `load` down the branch imports, relative to the project root: the
	 * ones a `load` can return for a page to render with `<svelte:component this={data.X}>`, which
	 * Kit's own `basics` does. Read off each level's `+page.js` or `+layout.js` as written -- an
	 * `import('./x.svelte')` or an `import X from './x.svelte'` with a relative specifier -- since
	 * the module is code a request runs and the build does not. A server `load` returns data a page
	 * receives over the wire, and no component crosses it. See spec/framework.md, "A component a
	 * `load` returns".
	 */
	loaded: string[];
}

/** A `.svelte` file a module imports by a relative specifier written out, statically or not. */
const IMPORTED = /(?:\bimport\s*\(\s*|\bfrom\s*)(['"])(\.{1,2}\/[^'"]+\.svelte)\1/g;

/**
 * The components one universal `load` module imports, relative to the project root, in the order
 * it names them.
 */
function importedComponents(cwd: string, module: string): string[] {
	const file = resolve(cwd, module);
	if (!existsSync(file)) return [];
	const found: string[] = [];
	for (const [, , specifier] of readFileSync(file, 'utf8').matchAll(IMPORTED)) {
		const target = resolve(dirname(file), specifier ?? '');
		if (existsSync(target)) found.push(relative(cwd, target).split('\\').join('/'));
	}
	return found;
}

/**
 * A tree Kit renders an error page with: the layouts above the level that failed, then the error
 * page as the leaf, each level with the error page its boundary renders. Shaped as a `Page`, since
 * it is compiled as one; its `id` names the tree, not a route, and it has no parameters of its own.
 */
export type ErrorTree = Page;

export interface Routes {
	pages: Page[];
	/** Every tree Kit can render an error page with, each once. */
	trees: ErrorTree[];
	/**
	 * Which tree a request whose `load` threw renders, by `failingKey`: the route and how many
	 * levels the tree has, which is all `render.js` hands its root to tell one from another. A
	 * response Kit renders without a route's own branch -- nothing matched, or what matched failed to
	 * render -- is under `RESPONDING`.
	 */
	failing: Record<string, string>;
}

/** The error tree `respond_with_error` renders: the root layout and the root error page. */
export const RESPONDING = '';

/** How a tree a route's failed `load` renders is found again at request time. */
export function failingKey(route: string, levels: number): string {
	return `${route}\n${String(levels)}`;
}

type Config = ReturnType<typeof validate_config>;

/**
 * The project's own `svelte.config.js`, imported as `vite-plugin-svelte` imports it, or nothing
 * where there is none. Kit 3 no longer reads one -- its options are the plugin's argument, see
 * `configured` -- but the Svelte plugin still does, and it is where a project outside Kit, or a
 * sample the suite stages, sets `compilerOptions`.
 */
async function userConfig(cwd: string): Promise<Record<string, unknown>> {
	const file = ['js', 'ts']
		.map((ext) => resolve(cwd, `svelte.config.${ext}`))
		.find((one) => existsSync(one));
	if (file === undefined) return {};
	const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
	if (typeof mod.default !== 'object' || mod.default === null) {
		throw new Error(`${file} does not export a config object`);
	}
	return mod.default as Record<string, unknown>;
}

/** What a project's Vite config resolved to, read once per project. See `configured`. */
const resolved = new Map<string, Promise<Config>>();

/**
 * The name of a plugin `configured` adds to the resolution it asks Vite for, so that a plugin in
 * the project's config can tell that resolution from the build it is part of. The compiler's own
 * plugin is in that config, and its `configResolved` asks `configured` for the same project: told
 * apart by nothing, it waited on the promise it was itself being awaited from.
 */
export const READING = 'routes:reading-config';

/** The Vite config each project is built with, where the build named one. See `builtWith`. */
const configFiles = new Map<string, string>();

/**
 * The Vite config the project at `cwd` is built with, where the build named it -- `vite build -c
 * vite.custom.config.js`, as Kit's `options` app does -- rather than leaving Vite to find
 * `vite.config.*`. Read by `configured`, which otherwise found no config there, read the routes
 * from the validator's default directory, and compiled none of the app's pages.
 */
export function builtWith(cwd: string, file: string): void {
	const at = resolve(cwd);
	if (configFiles.get(at) === file) return;
	configFiles.set(at, file);
	resolved.delete(at);
}

/**
 * Kit's validated config for a project, read the way Kit 3 reads it: off the `sveltekit(...)`
 * plugin in the project's Vite config, resolved with the project as its root so that every file
 * path comes out absolute, since a compile is not run from the project it compiles. A project with
 * no Vite config, which is what a sample the suite stages is, gets the validator's defaults under
 * the same root. Read once per project: resolving a Vite config runs every plugin's config hook,
 * and a compile asks for this per component. See spec/framework.md, "SvelteKit 3 is the target".
 */
export function configured(cwd: string): Promise<Config> {
	let held = resolved.get(cwd);
	if (held === undefined) {
		held = (async (): Promise<Config> => {
			const file =
				configFiles.get(cwd) ??
				['js', 'ts', 'mjs', 'mts']
					.map((ext) => resolve(cwd, `vite.config.${ext}`))
					.find((one) => existsSync(one));
			if (file === undefined) return process_config(validate_config({}), cwd);
			const vite = await resolveConfig(
				{ configFile: file, root: cwd, logLevel: 'silent', plugins: [{ name: READING }] },
				'build',
				'production',
			);
			return extract_svelte_config(vite);
		})();
		resolved.set(cwd, held);
	}
	return held;
}

/** A value as an object to read keys off, or an empty one where it is not an object. */
function object(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The compile options the project sets that change what a component compiles to: `runes`, a
 * boolean or Svelte's function of the file, taken as it is, and `experimental.async`. Kit 3 takes
 * them as `sveltekit({ compilerOptions })` and hands them to `vite-plugin-svelte` as its inline
 * config, which wins over the `svelte.config.js` that plugin still reads; a project without Kit's
 * plugin -- a sample the suite stages -- sets them in the file alone.
 */
export async function compilerOptions(root: string): Promise<{
	runes?: boolean | ((options: { filename: string }) => boolean | undefined);
	experimental?: { async: true };
}> {
	const file = object((await userConfig(resolve(root)))['compilerOptions']);
	const kit = object(
		((await configured(resolve(root))) as { compilerOptions?: unknown }).compilerOptions,
	);
	const held: Record<string, unknown> = {
		...file,
		...kit,
		experimental: { ...object(file['experimental']), ...object(kit['experimental']) },
	};
	const runes = held['runes'];
	const experimental = held['experimental'];
	const async =
		typeof experimental === 'object' &&
		experimental !== null &&
		(experimental as { async?: unknown }).async === true;
	return {
		...(typeof runes === 'boolean' || typeof runes === 'function'
			? { runes: runes as boolean | ((options: { filename: string }) => boolean | undefined) }
			: {}),
		...(async ? { experimental: { async: true as const } } : {}),
	};
}

/**
 * The prefix aliases Kit's plugin gives Vite, as a map: each of `alias` with a trailing `/*` taken
 * off both sides, resolved against the project. Kit's own `get_config_aliases` writes the same as
 * Vite alias entries; this is the shape a resolver takes. `$lib` is gone in Kit 3 -- `#lib` is a
 * subpath import the project's `package.json` declares, which resolution reads there -- and a
 * project keeping `$lib` declares it under `alias`, as Kit tells it to.
 */
export async function aliases(root: string): Promise<Record<string, string>> {
	const cwd = resolve(root);
	const config = await configured(cwd);
	const found: Record<string, string> = {};
	for (const [key, value] of Object.entries(config.alias)) {
		found[key.replace(/\/\*$/, '')] = resolve(cwd, value.replace(/\/\*$/, ''));
	}
	return found;
}

/** The routes under the project's routes directory, as Kit finds them. */
export async function routes(root: string): Promise<Routes> {
	const cwd = resolve(root);
	const config = await configured(cwd);
	const manifest = create_manifest_data(config, cwd);
	const pages: Page[] = [];
	const trees = new Map<string, ErrorTree>();
	const failing: Record<string, string> = {};
	// Kit's paths are relative to the working directory it was given; a fallback layout of Kit's
	// own comes out relative too, from wherever the vendored runtime sits. A node with no
	// component is null: Kit's root renders `<!--[!--><!--]-->` where its `Component` is undefined.
	const componentOf = (index: number): string | null => {
		const component = manifest.nodes[index]?.component;
		return component === undefined
			? null
			: relative(cwd, resolve(cwd, component)).split('\\').join('/');
	};
	const universalLoaded = (indexes: readonly (number | undefined)[]): string[] => {
		const loaded = new Set<string>();
		for (const index of indexes) {
			const universal = index === undefined ? undefined : manifest.nodes[index]?.universal;
			if (universal) for (const one of importedComponents(cwd, universal)) loaded.add(one);
		}
		return [...loaded];
	};
	// One tree per distinct shape, named by its place in the list: two routes whose failures render
	// the same components with the same error pages render the same tree.
	const tree = (nodes: readonly number[], chain: readonly (number | undefined)[]): string => {
		const branch = nodes.map(componentOf);
		const errors = chain.map((one) =>
			one === undefined ? undefined : (componentOf(one) ?? undefined),
		);
		const shape = JSON.stringify([branch, errors]);
		const known = trees.get(shape);
		if (known !== undefined) return known.id;
		const id = `#error-${String(trees.size)}`;
		trees.set(shape, {
			id,
			params: [],
			branch,
			errors,
			loaded: universalLoaded(nodes.slice(0, -1)),
		});
		return id;
	};
	// `respond_with_error`: the root layout and the root error page, with no error page guarding
	// either -- it hands `render_response` an empty `error_components`.
	failing[RESPONDING] = tree([0, 1], [undefined, undefined]);
	for (const route of manifest.routes) {
		if (route.page === null) continue;
		const indexes = [...route.page.layouts, route.page.leaf];
		const errorsAt = route.page.errors;
		// A `load` that throws at a level renders the error page nearest above it with the layouts
		// above that: `nearest_error_pages` (`runtime/error-chain.js`) takes the first error page
		// declared strictly above, rewound past depths with no node, and `page/index.js` renders
		// the layouts before it, compacted, then the error page. The root layout's failure is
		// `error.html` and no tree. The boundaries are `build_error_chain` over that branch.
		for (let at = 1; at < indexes.length; at += 1) {
			if (indexes[at] === undefined) continue;
			let idx = -1;
			let error: number | undefined;
			for (let above = at - 1; above >= 0; above -= 1) {
				const declared = errorsAt[above];
				if (declared === undefined || declared === null) continue;
				let j = above;
				while (j > 0 && indexes[j] === undefined) j -= 1;
				idx = j + 1;
				error = declared;
				break;
			}
			if (error === undefined) continue;
			const nodes = [
				...indexes.slice(0, idx).filter((one): one is number => one !== undefined),
				error,
			];
			const chain: (number | undefined)[] = [undefined];
			let last = -1;
			for (let k = 1; k < nodes.length; k += 1) {
				let j = k - 1;
				while (j > last + 1 && errorsAt[j] == null) j -= 1;
				last = j;
				chain.push(errorsAt[j] ?? undefined);
			}
			// Told apart from the tree `respond_with_error` renders, which has two levels and no
			// error page guarding the second, by the one this always has there.
			if (nodes.length === 2 && chain[1] === undefined) {
				throw new Error(
					`${route.id}: a failed load's tree reads as the one an error response renders`,
				);
			}
			const key = failingKey(route.id, nodes.length);
			const id = tree(nodes, chain);
			if (failing[key] !== undefined && failing[key] !== id) {
				throw new Error(`${route.id}: two error trees of ${String(nodes.length)} levels`);
			}
			failing[key] = id;
		}
		// A page Kit does not render on the server has no root to compile: `render_response`
		// writes an empty body under `ssr: false` and never renders its root. Kit's own static
		// analysis says which, merged down the branch onto the leaf, and null where a page option
		// is not analysable -- which Kit then reads by importing the module at its build, and
		// this reads as rendered, since it cannot import it here.
		if (manifest.nodes[route.page.leaf]?.page_options?.ssr === false) continue;
		// Kit's server loads `[...layouts, leaf]` with a gap where a depth has no layout, renders
		// the levels that are there, and pairs each with an error page by `build_error_chain`
		// (`runtime/error-chain.js`): the one declared at the depth directly above, rewound past
		// the gaps, and none for the first level. The same walk, over the same indexes.
		const branch: (string | null)[] = [];
		const errors: (string | undefined)[] = [];
		let last = -1;
		for (const [at, index] of indexes.entries()) {
			if (index === undefined) continue;
			branch.push(componentOf(index));
			if (at === 0) {
				errors.push(undefined);
				continue;
			}
			let above = at - 1;
			while (above > last + 1 && route.page.errors[above] == null) above -= 1;
			last = above;
			const error = route.page.errors[above];
			errors.push(error == null ? undefined : (componentOf(error) ?? undefined));
		}
		pages.push({
			id: route.id,
			params: route.params.map((one) => one.name),
			branch,
			errors,
			loaded: universalLoaded(indexes),
		});
	}
	return { pages, trees: [...trees.values()], failing };
}
