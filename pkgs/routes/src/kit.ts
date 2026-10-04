/**
 * Where Kit's own source sits, found through the `package.json` Kit exports.
 *
 * npm's `@sveltejs/kit` exports no `./src/*`, so a file of Kit's is reached by path rather than by
 * specifier, and from the Kit the project installed rather than from a copy. See spec/publish.md,
 * "Kit's internals are read from the project's Kit".
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Kit's `src` directory, as resolved from `from`, a file or a URL. */
export function kitSource(from: string): string {
	return resolve(dirname(createRequire(from).resolve('@sveltejs/kit/package.json')), 'src');
}

/** One of Kit's modules, by its path under `src`, loaded from the Kit `from` resolves to. */
export async function kitModule<T>(path: string, from: string = import.meta.url): Promise<T> {
	return (await import(pathToFileURL(resolve(kitSource(from), path)).href)) as T;
}
