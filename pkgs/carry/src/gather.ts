import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { APP_STATE, importsOf, readsOf, resolveBare, type Carried } from 'ast';

/**
 * What the expressions of this route call, gathered from every file whose expressions became
 * derivations.
 *
 * The entry's own imports were the whole of this list, and a child the walk enters is the case that
 * breaks it: its markup becomes derivations in the entry's artifact, so `{shout(word)}` in a child
 * compiled cleanly and threw `ReferenceError: shout is not defined` at request time. Nothing at
 * compile time says so, because a render never evaluates a derivation.
 *
 * A specifier is resolved against the file that wrote it, since two components in different
 * directories spell `./helper.ts` differently and the bundle is written from one place.
 *
 * **What is carried is what the expressions read**, and nothing more. The markup's own names were
 * the list once, and they were wrong in both directions: `const src = imgsrc(...)` read as `{src}`
 * is a derivation calling `imgsrc` that the markup never names, and `<Provider client={q}>` names
 * a package the render evaluates and no derivation ever calls -- bundling it pulled a component
 * library into esbuild, which has no loader for `.svelte`. So the caller hands over the free names
 * of the expressions the skeleton actually planted, and an import is carried when one of them is
 * it. Measured on press's home route, both ways.
 *
 * **Grouped by file, because a name means what the file that wrote it imported.** A derivation
 * is evaluated with the imports of each file its expression was written across, innermost
 * first, which is JavaScript's own rule with substitution accounted for. Two files importing one
 * module under one name two ways is then what it is in JavaScript: fine. See spec/derivation.md.
 */
export function carriedBy(
	root: string,
	expressions: readonly { expression: string; files: readonly string[] }[],
): Map<string, Carried[]> {
	// What each file's expressions read, with an expression counted for every file on its chain:
	// a name it reads is taken from the first of them that imports it, and which that is only
	// the imports say.
	const reads = new Map<string, Set<string>>();
	const trace = process.env['SEAM_TRACE'] !== undefined;
	for (const one of expressions) {
		const names = readsOf([one.expression]);
		if (trace && (one.files[0] ?? '').includes('node_modules')) {
			console.error(
				`[seam]   reads ${one.expression.replace(/\s+/g, ' ').slice(0, 200)} in ${one.files[0] ?? '?'}`,
			);
		}
		for (const file of one.files) {
			const held = reads.get(file) ?? new Set<string>();
			for (const name of names) held.add(name);
			reads.set(file, held);
		}
	}
	const found = new Map<string, Carried[]>();
	for (const [file, names] of reads) {
		const at = resolve(root, file);
		const carried: Carried[] = [];
		for (const [local, one] of importsOf(readFileSync(at, 'utf8'))) {
			// A component is composed at compile time and never a value an expression calls. Kit's
			// `$app/state` is bound by the walk -- `page` to the payload's, the rest to constants --
			// and an expression that still names it reads the payload, not the module.
			if (!names.has(local) || one.from.endsWith('.svelte') || one.from === APP_STATE) continue;
			// Resolved from where the file sits, a bare name too: a package's component imports its
			// own dependencies, which are beside the package and not beside the bundle's entry.
			const from = one.from.startsWith('.')
				? resolve(dirname(at), one.from)
				: (resolveBare(one.from, at) ?? one.from);
			carried.push({ ...one, from });
		}
		if (carried.length > 0) found.set(file, carried);
	}
	return found;
}
