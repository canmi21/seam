/**
 * `$app/paths` for the carried bundle: Kit's own server module, handed in by the dispatcher.
 *
 * What `resolve` and `asset` write depends on the request: with `paths.relative` on, which is
 * Kit's default, Kit prefixes `..` per segment of the URL being answered, read out of its request
 * store. Only Kit's own module, bundled into Kit's server, has that store, so it is handed rather
 * than written again; `base` and `assets` are read off it once the server has started, which is
 * before any route's first request. See `handed` in compile.ts.
 */
import { handed } from './handed.ts';

interface Paths {
	base: string;
	assets: string;
	app_dir: string;
	asset: (file: string) => string;
	resolve: (id: string, params?: Record<string, string | undefined>) => string;
	match: (url: string | URL) => Promise<unknown>;
}

const held = handed<Paths>('$app/paths');

export const base: string = held.base;
export const assets: string = held.assets;
export const app_dir: string = held.app_dir;

export function asset(file: string): string {
	return held.asset(file);
}

export function resolve(id: string, params?: Record<string, string | undefined>): string {
	return held.resolve(id, params);
}

export function match(url: string | URL): Promise<unknown> {
	return held.match(url);
}
