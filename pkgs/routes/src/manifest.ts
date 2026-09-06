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
import { relative, resolve } from 'node:path';
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

/**
 * Kit's validated config for a project, with the file paths spelled out rather than defaulted:
 * the validator's defaults are relative to the process's working directory, and a compile is
 * not run from the project it compiles.
 */
export function configured(cwd: string): ReturnType<typeof validate_config> {
	const src = resolve(cwd, 'src');
	return validate_config(
		{
			kit: {
				files: {
					assets: resolve(cwd, 'static'),
					lib: resolve(src, 'lib'),
					params: resolve(src, 'params'),
					routes: resolve(src, 'routes'),
					hooks: {
						client: resolve(src, 'hooks.client'),
						server: resolve(src, 'hooks.server'),
						universal: resolve(src, 'hooks'),
					},
				},
			},
		},
		cwd,
	);
}

/** The routes under `<root>/src/routes`, as Kit's defaults find them. */
export function routes(root: string): Routes {
	const cwd = resolve(root);
	const config = configured(cwd);
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
