/**
 * Routing, as SvelteKit does it, spoken through one module.
 *
 * The route id grammar -- `[param]`, `[...rest]`, `[[optional]]`, `(group)`, matchers -- and the
 * order routes are tried in are Kit's, and the code that reads them is Kit's own, vendored as the
 * JavaScript it is written in (see `vendor/kit/VENDOR.md`). This is the one place the vendor's name
 * appears among the packages: everything else imports from here, so a route id means the same
 * thing to the compiler that it means to Kit, and a change of implementation changes one file.
 * The types come through the JSDoc on the vendored source; nothing is redeclared here.
 */
import {
	exec,
	find_route,
	parse_route_id,
	resolve_route,
} from '@sveltejs/kit/src/utils/routing.js';

export type { RouteParam } from 'types';

/** A route id parsed into the regular expression it matches and the parameters it binds. */
export function parsed(id: string): ReturnType<typeof parse_route_id> {
	return parse_route_id(id);
}

/** The parameters a matched pathname binds, or null where a matcher turns the match away. */
export function bound(
	match: RegExpMatchArray,
	params: ReturnType<typeof parse_route_id>['params'],
	matchers: Record<string, (segment: string) => boolean> = {},
): Record<string, string> | undefined {
	return exec(match, params, matchers);
}

/** A route id with its parameters written in, `/blog/[slug]` with `{ slug: 'x' }` as `/blog/x`. */
export function written(id: string, params: Record<string, string | undefined>): string {
	return resolve_route(id, params);
}

export { find_route as found };

export { aliases, configured, type Page, type Routes, routes } from './manifest.ts';
export { root } from './root.ts';
export { entries, type Found, rootFile } from './entries.ts';
