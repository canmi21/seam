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
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { type Carried, currentAliases, resolveBare } from 'ast';

/** An immediately invoked bundle assigning to one name, which `derive` reads back out. */
const NAME = '__carried';

/**
 * Bundles the named imports of a component into a script that defines `__carried`.
 *
 * Returns an empty string when the component carries nothing, so a page that needs no bundle
 * ships none rather than shipping an empty one.
 */
export async function carry(
	file: string,
	groups: ReadonlyMap<string, readonly Carried[]>,
): Promise<string> {
	if ([...groups.values()].every((names) => names.length === 0)) return '';
	const entry = resolve(file);
	// One import per name per file, under an alias no file wrote, and one object per file holding
	// them under the names the file wrote: `files["src/a.svelte"].m`. The evaluator opens a file's
	// object as a scope, so an expression reads `m` and gets that file's `m`.
	const lines: string[] = [];
	const objects: string[] = [];
	for (const [at, [group, names]] of [...groups].entries()) {
		const fields: string[] = [];
		for (const [n, one] of names.entries()) {
			const alias = `__c${String(at)}_${String(n)}`;
			lines.push(restate(svelted(one), alias));
			fields.push(`${JSON.stringify(one.local)}: ${alias}`);
		}
		objects.push(`${JSON.stringify(group)}: { ${fields.join(', ')} }`);
	}
	lines.push(`export const files = { ${objects.join(', ')} };`);
	const source = lines.join('\n');

	const result = await build({
		stdin: { contents: source, resolveDir: dirname(entry), loader: 'ts', sourcefile: 'carried.ts' },
		bundle: true,
		// An IIFE assigning to one name rather than a module, because the evaluator has no module
		// loader and `new Function` can return the value the assignment produced.
		format: 'iife',
		globalName: NAME,
		platform: 'neutral',
		// Resolved the way a Svelte-aware bundler resolves: the `svelte` condition first, then the
		// ESM ones, and the `svelte`, `module` and `main` fields for a package without an `exports`
		// map. A neutral platform resolves nothing of that on its own.
		conditions: ['svelte', 'import', 'module', 'default'],
		mainFields: ['svelte', 'module', 'main'],
		// `$lib` and the project's own, which a module the expressions call may import by.
		alias: { ...currentAliases() },
		target: 'es2022',
		write: false,
		logLevel: 'silent',
	});

	const [output] = result.outputFiles ?? [];
	if (output === undefined) throw new Error(`nothing came out of bundling ${file}`);
	return output.text;
}

/**
 * The import written again under an alias, in the form it was written in.
 *
 * The three forms are not interchangeable: a default export is not a named one, and a namespace
 * is neither. Writing them all as named imports is a mistake that only shows up on a module
 * whose shape happens to differ, which is the kind that reaches a page rather than a test.
 */
/**
 * Svelte's own helpers, named by where this compiler's Svelte sits rather than resolved from the
 * entry: the entry may be a generated root or a corpus case with no `node_modules` above it, and
 * there is one copy of Svelte in a compile, this package's. See `helpers()` in skeleton.
 */
function svelted(one: Carried): Carried {
	if (one.from !== 'svelte' && !one.from.startsWith('svelte/')) return one;
	const at = resolveBare(one.from, fileURLToPath(import.meta.url));
	return at === null ? one : { ...one, from: at };
}

function restate(one: Carried, alias: string): string {
	// Node resolves a `file:` URL as a specifier and esbuild does not, so it is handed the path.
	const from = JSON.stringify(one.from.startsWith('file:') ? fileURLToPath(one.from) : one.from);
	if (one.kind === 'namespace') return `import * as ${alias} from ${from};`;
	if (one.kind === 'default') return `import ${alias} from ${from};`;
	const exported = one.exported ?? one.local;
	// An export may be named by a string, which is how paraglide spells `"language.switcher"`.
	const name = /^[A-Za-z_$][\w$]*$/.test(exported) ? exported : JSON.stringify(exported);
	return `import { ${name} as ${alias} } from ${from};`;
}
