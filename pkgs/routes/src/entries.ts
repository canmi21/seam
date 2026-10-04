/**
 * The compiler's entries, found rather than named: one generated root per route with a page.
 *
 * Each root is written under Kit's output directory, `.svelte-kit/seam/routes/<id>/+root.svelte`,
 * so that it has a place on disk for the walk to read and its imports of the route's components
 * are ordinary relative imports. The entry's path is the route id, which is what a server has
 * once `find_route` has run; its payload is the root's props, `data_0` .. `data_n`, `page`,
 * `form` and `error`, which are what Kit's `render_response` hands its root, with the tree's data
 * per level as a prop each. See spec/build.md and spec/payload.md.
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

/** Where an error tree's generated root sits: `#error-3` under `errors/3`. */
export function treeFile(id: string): string {
	return `.svelte-kit/seam/errors/${id.replace(/^#error-/, '')}/+root.svelte`;
}

/** Writes every route's root and says where each is. */
export async function entries(projectRoot: string): Promise<Found[]> {
	const at = resolve(projectRoot);
	return written(at, (await routes(at)).pages, rootFile);
}

/**
 * Writes the root of every tree Kit renders an error page with, and says where each is and which
 * one a failed request renders. See `Routes.trees` and spec/framework.md, "The error page".
 */
export async function errorEntries(
	projectRoot: string,
): Promise<{ found: Found[]; failing: Record<string, string> }> {
	const at = resolve(projectRoot);
	const { trees, failing } = await routes(at);
	return { found: written(at, trees, treeFile), failing };
}

function written(at: string, pages: readonly Page[], fileOf: (id: string) => string): Found[] {
	return pages.map((page) => {
		writeRoot(at, page, fileOf(page.id));
		return { path: page.id, component: fileOf(page.id), page };
	});
}

/** Writes the root of `page` at `file`, relative to the project root, its imports relative to it. */
export function writeRoot(projectRoot: string, page: Page, file: string): void {
	const at = resolve(projectRoot);
	const to = resolve(at, file);
	const from = (one: string): string => {
		const rel = relative(dirname(to), resolve(at, one)).split('\\').join('/');
		return rel.startsWith('.') ? rel : `./${rel}`;
	};
	mkdirSync(dirname(to), { recursive: true });
	writeFileSync(
		to,
		root(
			page.branch.map((one) => (one === null ? null : from(one))),
			page.errors.map((one) => (one === undefined ? undefined : from(one))),
		),
	);
}
