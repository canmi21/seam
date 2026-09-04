import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { bindings, type Carried } from 'ast';

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
 * **One name means one module.** Derivations evaluate in a single scope, so two components that
 * carry the same local name for different modules cannot both be right, and that is said rather
 * than resolved by whichever was read last. See spec/derivation.md.
 */
export function carriedBy(files: readonly string[]): Carried[] {
	const found = new Map<string, Carried>();
	for (const file of files) {
		for (const one of bindings(readFileSync(file, 'utf8')).carried) {
			const from = one.from.startsWith('.') ? resolve(dirname(file), one.from) : one.from;
			const now: Carried = { ...one, from };
			const held = found.get(one.local);
			if (held === undefined) {
				found.set(one.local, now);
				continue;
			}
			const same =
				held.from === now.from &&
				held.kind === now.kind &&
				(held.exported ?? held.local) === (now.exported ?? now.local);
			if (!same) {
				throw new Error(
					`two components on this route carry \`${one.local}\`, from \`${held.from}\` and ` +
						`\`${now.from}\`. A derivation is evaluated in one scope, so the name cannot mean ` +
						'both; rename one of them. See spec/derivation.md',
				);
			}
		}
	}
	return [...found.values()];
}
