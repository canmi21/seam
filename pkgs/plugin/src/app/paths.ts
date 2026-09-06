/**
 * `$app/paths` for the carried bundle: the project's `base` and `assets` as its config sets them,
 * and Kit's own route resolution for `resolve`. What `asset` writes and what a hashed route
 * resolves to are Kit's rules, taken from Kit's source.
 */
import { resolve_route } from '@sveltejs/kit/src/utils/routing.js';

export const base: string = '__SEAM_BASE__';
export const assets: string = '__SEAM_ASSETS__';

export function asset(file: string): string {
	return (assets || base) + file;
}

export function resolve(id: string, params: Record<string, string | undefined> = {}): string {
	return base + resolve_route(id, params);
}

export const resolveRoute = resolve;
