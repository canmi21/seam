/**
 * The compiler's entries, found rather than named: one generated root per route with a page.
 *
 * Each root is written under Kit's output directory, `.svelte-kit/seam/routes/<id>/+root.svelte`,
 * so that it has a place on disk for the walk to read and its imports of the route's components
 * are ordinary relative imports. The entry's path is the route id, which is what a server has
 * once `find_route` has run; its payload is the root's props, `data_0` .. `data_n`, `params` and
 * `form`. See spec/build.md and spec/payload.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { type Page, routes } from './manifest.ts';
import { root } from './root.ts';

export interface Found {
	/** Kit's route id, and the URL pattern the server matches against. */
	path: string;
	/** The generated root, relative to the project root, which is what the compiler is handed. */
	component: string;
	page: Page;
}

/** Where a route's generated root sits, relative to the project root. */
export function rootFile(id: string): string {
	return `.svelte-kit/seam/routes${id === '/' ? '' : id}/+root.svelte`;
}

/** Writes every route's root and says where each is. */
export function entries(projectRoot: string): Found[] {
	const at = resolve(projectRoot);
	const found = routes(at);
	return found.pages.map((page) => {
		const file = resolve(at, rootFile(page.id));
		const branch = page.branch.map((one) => {
			const rel = relative(dirname(file), resolve(at, one)).split('\\').join('/');
			return rel.startsWith('.') ? rel : `./${rel}`;
		});
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, root(branch, found.depth));
		return { path: page.id, component: rootFile(page.id), page };
	});
}
