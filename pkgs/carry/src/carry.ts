import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { type Plugin, rolldown } from 'rolldown';
import { compile, compileModule } from 'svelte/compiler';
import { type Carried, currentAliases, resolveBare } from 'ast';

/** An immediately invoked bundle assigning to one name, which `derive` reads back out. */
const NAME = '__carried';

/** The entry the bundle is made from, which no file backs: the restated imports, as a module. */
const ENTRY = '\0seam:carried';

/**
 * What resolves and bundles the carried modules into one ES module with nothing left to import.
 *
 * rolldown from here by default, resolving the way a Svelte-aware bundler resolves and knowing the
 * project's aliases, with a component a package ships compiled where it sits; inside a Vite build
 * the plugin gives the project's own Vite instead, so that a virtual module of the project's
 * plugins and `$app/*` resolve as the project's build resolves them. Either way the result is
 * wrapped into the script the evaluator takes, which is not the bundler's business.
 */
export type Bundler = (entry: string, source: string) => Promise<string>;

let bundler: Bundler | null = null;

/** Bundles through the given bundler from now on, or through rolldown again when given null. */
export function configureCarry(given: Bundler | null): void {
	bundler = given;
}

/** The entry as a module the bundler can load, since it was never written anywhere. */
function entryOf(source: string): Plugin {
	return {
		name: 'seam:carried-entry',
		resolveId: (id) => (id === ENTRY ? ENTRY : null),
		load: (id) => (id === ENTRY ? source : null),
	};
}

/**
 * A component and a runes module compiled on the way in, as the server compiles them. A module the
 * expressions call may re-export a component beside the function they want -- a query library
 * ships its provider component that way -- and a bundler has no loader for one of its own.
 */
function svelted(): Plugin {
	return {
		name: 'seam:svelte',
		load(id) {
			if (id.endsWith('.svelte')) {
				return compile(readFileSync(id, 'utf8'), {
					generate: 'server',
					name: basename(id, '.svelte'),
					filename: id,
				}).js.code;
			}
			if (/\.svelte\.(?:js|ts)$/.test(id)) {
				const text = readFileSync(id, 'utf8');
				const source = id.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
				return compileModule(source, { generate: 'server', filename: id }).js.code;
			}
			return null;
		},
	};
}

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
			// Svelte's own modules are named by file for the default bundler, which would otherwise
			// take a copy from wherever the component sits; a bundler the project gave resolves them.
			lines.push(restate(bundler === null ? ownSvelte(one) : one, alias));
			fields.push(`${JSON.stringify(one.local)}: ${alias}`);
		}
		objects.push(`${JSON.stringify(group)}: { ${fields.join(', ')} }`);
	}
	lines.push(`export const files = { ${objects.join(', ')} };`);
	const source = lines.join('\n');

	// Resolved and joined by the project's bundler where there is one, then wrapped here: what comes
	// back imports nothing, so wrapping it is a format change and not a resolution.
	const contents = bundler === null ? source : await bundler(entry, source);
	const bundle = await rolldown({
		input: ENTRY,
		cwd: dirname(entry),
		// Resolved the way a Svelte-aware bundler resolves: the `svelte` condition first, then the
		// ESM ones, and the `svelte`, `module` and `main` fields for a package without an `exports`
		// map. A neutral platform resolves nothing of that on its own. `$lib` and the project's own
		// aliases, which a module the expressions call may import by.
		platform: 'neutral',
		resolve: {
			conditionNames: ['svelte', 'import', 'module', 'default'],
			mainFields: ['svelte', 'module', 'main'],
			alias: { ...currentAliases() },
		},
		plugins: [entryOf(contents), svelted()],
		logLevel: 'silent',
	});
	try {
		// An IIFE assigning to one name rather than a module, because the evaluator has no module
		// loader and `new Function` can return the value the assignment produced.
		const { output } = await bundle.generate({ format: 'iife', name: NAME, minify: false });
		const [chunk] = output;
		if (chunk === undefined) throw new Error(`nothing came out of bundling ${file}`);
		return chunk.code;
	} finally {
		await bundle.close();
	}
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
function ownSvelte(one: Carried): Carried {
	if (one.from !== 'svelte' && !one.from.startsWith('svelte/')) return one;
	const at = resolveBare(one.from, fileURLToPath(import.meta.url));
	return at === null ? one : { ...one, from: at };
}

function restate(one: Carried, alias: string): string {
	// Node resolves a `file:` URL as a specifier and a bundler does not, so it is handed the path.
	const from = JSON.stringify(one.from.startsWith('file:') ? fileURLToPath(one.from) : one.from);
	if (one.kind === 'namespace') return `import * as ${alias} from ${from};`;
	if (one.kind === 'default') return `import ${alias} from ${from};`;
	const exported = one.exported ?? one.local;
	// An export may be named by a string, which is how paraglide spells `"language.switcher"`.
	const name = /^[A-Za-z_$][\w$]*$/.test(exported) ? exported : JSON.stringify(exported);
	return `import { ${name} as ${alias} } from ${from};`;
}
