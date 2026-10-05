/**
 * A route's program: written from its IR and derivations at the build, and evaluated once a
 * process. See spec/ir.md, "A route is one program".
 */
import * as runtime from '@seam-js/injector/runtime';
import { type CarriedNames, generate, type Structure } from './generate.ts';

export {
	type CarriedName,
	type CarriedNames,
	type Derivation,
	generate,
	type Source,
	type Structure,
} from './generate.ts';
export type { Render } from '@seam-js/injector/runtime';

const MARK = Symbol.for('seam.hydratable');

/** What a carried bundle's files hold, read off the evaluated bundle. */
export function carriedNamesOf(
	files: Readonly<Record<string, Record<string, unknown>>>,
): CarriedNames {
	return Object.fromEntries(
		Object.entries(files).map(([file, held]) => [
			file,
			Object.entries(held).map(([name, value]) => ({
				name,
				hydratable:
					typeof value === 'function' &&
					(value as unknown as Record<symbol, unknown>)[MARK] === true,
			})),
		]),
	);
}

/** The carried bundle evaluated, as the files it holds. */
export function carriedFiles(carried: string): Record<string, Record<string, unknown>> {
	if (carried === '') return {};
	// eslint-disable-next-line no-new-func
	const exports = new Function(`${carried}\nreturn __carried;`)() as { files?: unknown };
	return (exports.files ?? {}) as Record<string, Record<string, unknown>>;
}

/**
 * The route's script: the carried bundle and the program together, which `evaluated` makes into the
 * render. What the build writes, and what every backend runs.
 */
export function script(structure: Structure, carried: string, names?: CarriedNames): string {
	const program = generate(structure, names ?? carriedNamesOf(carriedFiles(carried)));
	return carried === '' ? program : `${carried}\n${program}`;
}

/** A route's program made in memory, from what a build would write: for a check, not a server. */
export function load(structure: Structure, carried: string): runtime.Render {
	return runtime.evaluated(script(structure, carried));
}
