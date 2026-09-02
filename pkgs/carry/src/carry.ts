/**
 * The code a component's expressions call, compiled to one script with nothing left to import.
 *
 * A derivation may call a function the author imported, and the evaluator that runs derivations
 * has no module system to resolve it with -- that is the promise made about what a backend which
 * is not Node has to carry. Bundling is what keeps it: there is nothing to resolve at request
 * time because nothing is imported at request time.
 *
 * It is bundled, not analysed. See spec/derivation.md, where a purity check over library code was
 * measured against the two functions the question exists for and abandoned.
 */
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import type { Carried } from 'ast';

/** An immediately invoked bundle assigning to one name, which `derive` reads back out. */
const NAME = '__carried';

/**
 * Bundles the named imports of a component into a script that defines `__carried`.
 *
 * Returns an empty string when the component carries nothing, so a page that needs no bundle
 * ships none rather than shipping an empty one.
 */
export async function carry(file: string, names: readonly Carried[]): Promise<string> {
	if (names.length === 0) return '';
	const entry = resolve(file);
	const source = names.map(restate).join('\n');

	const result = await build({
		stdin: { contents: source, resolveDir: dirname(entry), loader: 'ts', sourcefile: 'carried.ts' },
		bundle: true,
		// An IIFE assigning to one name rather than a module, because the evaluator has no module
		// loader and `new Function` can return the value the assignment produced.
		format: 'iife',
		globalName: NAME,
		platform: 'neutral',
		target: 'es2022',
		write: false,
		logLevel: 'silent',
	});

	const [output] = result.outputFiles ?? [];
	if (output === undefined) throw new Error(`nothing came out of bundling ${file}`);
	return output.text;
}

/**
 * The import written again as an export, which is how the entry asks for one name.
 *
 * The three forms are not interchangeable: a default export is not a named one, and a namespace
 * is neither. Writing them all as named exports is a mistake that only shows up on a module
 * whose shape happens to differ, which is the kind that reaches a page rather than a test.
 */
function restate(one: Carried): string {
	const from = JSON.stringify(one.from);
	if (one.kind === 'namespace') return `export * as ${one.local} from ${from};`;
	if (one.kind === 'default') return `export { default as ${one.local} } from ${from};`;
	const exported = one.exported ?? one.local;
	const alias = exported === one.local ? one.local : `${exported} as ${one.local}`;
	return `export { ${alias} } from ${from};`;
}
