/**
 * What Kit's own server hands the carried bundle: the modules whose values are the build's or the
 * request's and not the compile's. The dispatcher, bundled by Kit's server build where every
 * `$app/*` module resolves to its finished self, sets them on this global as it loads; a route's
 * derivations are compiled on its first request, which is after. See spec/framework.md.
 */
export const HANDED = Symbol.for('seam.kit');

export function handed<T>(name: string): T {
	const registry = (globalThis as Record<symbol, unknown>)[HANDED] as
		| Record<string, unknown>
		| undefined;
	const held = registry?.[name];
	if (held === undefined) {
		throw new Error(
			`\`${name}\` was read before the framework handed it in. See spec/framework.md`,
		);
	}
	return held as T;
}
