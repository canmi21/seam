import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type Carried, importsOf } from 'ast';

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
 * **One name means one module.** Derivations evaluate in a single scope, so two components that
 * carry the same local name for different modules cannot both be right, and that is said rather
 * than resolved by whichever was read last. See spec/derivation.md.
 */
export function carriedBy(files: readonly string[], reads: ReadonlySet<string>): Carried[] {
	const found = new Map<string, Carried>();
	for (const file of files) {
		for (const [local, one] of importsOf(readFileSync(file, 'utf8'))) {
			// A component is composed at compile time and never a value an expression calls.
			if (!reads.has(local) || one.from.endsWith('.svelte')) continue;
			const from = one.from.startsWith('.') ? resolve(dirname(file), one.from) : one.from;
			const now: Carried = { ...one, from };
			const held = found.get(local);
			if (held === undefined) {
				found.set(local, now);
				continue;
			}
			const same =
				held.from === now.from &&
				held.kind === now.kind &&
				(held.exported ?? held.local) === (now.exported ?? now.local);
			if (!same) {
				throw new Error(
					`two components on this route carry \`${local}\`, from \`${held.from}\` and ` +
						`\`${now.from}\`. A derivation is evaluated in one scope, so the name cannot mean ` +
						'both; rename one of them. See spec/derivation.md',
				);
			}
		}
	}
	return [...found.values()];
}
