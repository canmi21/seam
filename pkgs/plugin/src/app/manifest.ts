/**
 * `$app/manifest` for the carried bundle: Kit's own values, read at request time.
 *
 * What the module holds -- the routes, the assets, what was prerendered -- Kit's build writes
 * after this compiler has run, some of it after prerendering, so no compile can know it. The
 * dispatcher the plugin puts where Kit's root stood is bundled by Kit's own server build, where
 * `$app/manifest` resolves to the finished module, and it sets that module on a global the moment
 * it loads; the derivations of a route are compiled on the route's first request, which is after.
 * See `handed` in compile.ts.
 */
import { handed } from './handed.ts';

interface Manifest {
	immutable: string;
	assets: readonly string[];
	prerendered: readonly string[];
	routes: readonly unknown[];
}

const held = handed<Manifest>('$app/manifest');

export const immutable: string = held.immutable;
export const assets: readonly string[] = held.assets;
export const prerendered: readonly string[] = held.prerendered;
export const routes: readonly unknown[] = held.routes;
