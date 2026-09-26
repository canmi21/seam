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
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveConfig } from 'vite';
import {
	extract_svelte_config,
	process_config,
	validate_config,
} from '@sveltejs/kit/src/core/config/index.js';
import create_manifest_data from '@sveltejs/kit/src/core/sync/create_manifest_data/index.js';

export interface Page {
	/** Kit's route id: `/blog/[slug]`, with groups and parameters spelled as Kit spells them. */
	id: string;
	/** The names the route's parameters bind, in order. */
	params: string[];
	/**
	 * The components down the branch, relative to the project root: every layout that applies,
	 * outermost first, then the page. `data_0` .. `data_n` go to these in this order.
	 */
	branch: string[];
}

export interface Routes {
	pages: Page[];
	/**
	 * Kit's `max_depth`: the longest branch's layouts plus one. The generated root has one level
	 * more than that, as Kit's does, and every route's root is sized to it rather than to its own
	 * branch, so that the bytes around a page are the bytes Kit writes around it.
	 */
	depth: number;
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
			const file = ['js', 'ts', 'mjs', 'mts']
				.map((ext) => resolve(cwd, `vite.config.${ext}`))
				.find((one) => existsSync(one));
			if (file === undefined) return process_config(validate_config({}), cwd);
			const vite = await resolveConfig(
				{ configFile: file, root: cwd, logLevel: 'silent' },
				'build',
				'production',
			);
			return extract_svelte_config(vite);
		})();
		resolved.set(cwd, held);
	}
	return held;
}

/**
 * The compile options the project's `svelte.config.js` sets that change what a component compiles
 * to, read off the file as `vite-plugin-svelte` reads it, since Kit's validator does not know the
 * key: `runes`, a boolean or Svelte's function of the file, taken as it is, and
 * `experimental.async`.
 */
export async function compilerOptions(root: string): Promise<{
	runes?: boolean | ((options: { filename: string }) => boolean | undefined);
	experimental?: { async: true };
}> {
	const given = (await userConfig(resolve(root)))['compilerOptions'];
	const held =
		typeof given === 'object' && given !== null ? (given as Record<string, unknown>) : {};
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
	let depth = 1;
	for (const route of manifest.routes) {
		if (route.page === null) continue;
		// Kit's `compact`: a level with no layout is skipped, and the branch is what is left.
		const indexes = [...route.page.layouts, route.page.leaf].filter(
			(one): one is number => one !== undefined,
		);
		const branch = indexes.map((index) => {
			const component = manifest.nodes[index]?.component;
			if (component === undefined) {
				throw new Error(`route ${route.id} has a node with no component, which Kit does not allow`);
			}
			// Kit's paths are relative to the working directory it was given; a fallback layout of
			// Kit's own comes out relative too, from wherever the vendored runtime sits.
			return relative(cwd, resolve(cwd, component)).split('\\').join('/');
		});
		pages.push({ id: route.id, params: route.params.map((one) => one.name), branch });
		// Kit's own arithmetic, `filter(Boolean)` included: node 0 is falsy, so a root layout that
		// is the first node is not counted, and a project whose only layout is the root one has a
		// depth of one and its pages at the innermost level. The root has to be sized as Kit sizes
		// it, so the count is Kit's rather than the right one.
		depth = Math.max(depth, route.page.layouts.filter(Boolean).length + 1);
	}
	return { pages, depth };
}
