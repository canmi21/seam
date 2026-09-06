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
import { validate_config } from '@sveltejs/kit/src/core/config/index.js';
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
type Files = Config['kit']['files'];

/**
 * The project's own `svelte.config.js`, imported as Kit imports it, or nothing where there is none.
 * Kit's own loader asks Vite for it first and prints when the file is missing; a compile wants the
 * file and silence.
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

/**
 * Kit's validated config for a project: its `svelte.config.js` where it has one, with the file
 * paths spelled out absolute rather than left as the validator leaves them. The validator's
 * defaults and the author's own are relative to the process's working directory, and a compile is
 * not run from the project it compiles.
 */
export async function configured(cwd: string): Promise<Config> {
	const user = await userConfig(cwd);
	const kit = (user['kit'] ?? {}) as Record<string, unknown>;
	const given = (kit['files'] ?? {}) as Partial<Record<keyof Files, string>> & {
		hooks?: Partial<Record<'client' | 'server' | 'universal', string>>;
	};
	const at = (fallback: string, own: string | undefined): string =>
		own === undefined ? fallback : resolve(cwd, own);
	const src = at(resolve(cwd, 'src'), given.src);
	const files: Files = {
		src,
		assets: at(resolve(cwd, 'static'), given.assets),
		lib: at(resolve(src, 'lib'), given.lib),
		params: at(resolve(src, 'params'), given.params),
		routes: at(resolve(src, 'routes'), given.routes),
		serviceWorker: at(resolve(src, 'service-worker'), given.serviceWorker),
		appTemplate: at(resolve(src, 'app.html'), given.appTemplate),
		errorTemplate: at(resolve(src, 'error.html'), given.errorTemplate),
		hooks: {
			client: at(resolve(src, 'hooks.client'), given.hooks?.client),
			server: at(resolve(src, 'hooks.server'), given.hooks?.server),
			universal: at(resolve(src, 'hooks'), given.hooks?.universal),
		},
	};
	return validate_config({ ...user, kit: { ...kit, files } }, cwd);
}

/**
 * The prefix aliases Kit's plugin gives Vite, as a map: `$lib` to the lib directory, and each of
 * `kit.alias` with a trailing `/*` taken off both sides, resolved against the project. Kit's own
 * `get_config_aliases` writes the same as Vite alias entries; this is the shape a resolver takes.
 */
export async function aliases(root: string): Promise<Record<string, string>> {
	const cwd = resolve(root);
	const config = await configured(cwd);
	const found: Record<string, string> = { $lib: config.kit.files.lib };
	for (const [key, value] of Object.entries(config.kit.alias)) {
		found[key.replace(/\/\*$/, '')] = resolve(cwd, value.replace(/\/\*$/, ''));
	}
	return found;
}

/** The routes under the project's routes directory, as Kit finds them. */
export async function routes(root: string): Promise<Routes> {
	const cwd = resolve(root);
	const config = await configured(cwd);
	const manifest = create_manifest_data({ config, cwd });
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
