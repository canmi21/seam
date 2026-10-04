/**
 * Routing, as SvelteKit does it, spoken through one module.
 *
 * The route id grammar -- `[param]`, `[...rest]`, `[[optional]]`, `(group)`, matchers -- and the
 * order routes are tried in are Kit's, and the code that reads them is Kit's own, loaded from the
 * Kit the project installed (see `./kit.ts`). This is the one place the vendor's name
 * appears among the packages: everything else imports from here, so a route id means the same
 * thing to the compiler that it means to Kit, and a change of implementation changes one file.
 * The types come through the JSDoc on the vendored source; nothing is redeclared here.
 */
import { kitModule } from './kit.ts';

const { exec, find_route, parse_route_id, resolve_route } =
	await kitModule<typeof import('@sveltejs/kit/src/utils/routing.js')>('utils/routing.js');

/** A route id parsed into the regular expression it matches and the parameters it binds. */
export function parsed(id: string): ReturnType<typeof parse_route_id> {
	return parse_route_id(id);
}

/** The parameters a matched pathname binds, or null where a matcher turns the match away. */
export function bound(
	match: RegExpMatchArray,
	params: ReturnType<typeof parse_route_id>['params'],
	matchers: Parameters<typeof exec>[2] = {},
): Record<string, string> | undefined {
	return exec(match, params, matchers);
}

/** A route id with its parameters written in, `/blog/[slug]` with `{ slug: 'x' }` as `/blog/x`. */
export function written(id: string, params: Record<string, string | undefined>): string {
	return resolve_route(id, params);
}

export { find_route as found };
export { kitModule, kitSource } from './kit.ts';

export {
	aliases,
	builtWith,
	compilerOptions,
	configured,
	type ErrorTree,
	failingKey,
	type Page,
	READING,
	RESPONDING,
	type Routes,
	routes,
} from './manifest.ts';
export { root } from './root.ts';
export { entries, errorEntries, type Found, rootFile, treeFile, writeRoot } from './entries.ts';
