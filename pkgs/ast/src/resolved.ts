/**
 * Every name in a component's markup has to come from somewhere, or the component is refused.
 *
 * It lives on its own because two passes need it and only one had it. A local variable and a
 * payload key are indistinguishable by shape, so a component reading a name nothing binds compiles
 * and renders an empty string where the value should be. The pass that writes the bytes refused
 * that; the pass that renders did not, and `{mystery}` came out as nothing with an exit status of
 * zero. See spec/derivation.md, where the rule is that every identifier resolves or is refused.
 */
import { bindings } from './bindings.ts';

/** Svelte's own names for the props object, which `transform-server.js` builds from `$$props`. */
const RESERVED: ReadonlySet<string> = new Set(['$$props', '$$restProps', '$$slots']);

/**
 * Throws when the source reads a name it cannot get a value for.
 *
 * `where` names the file in whatever way the caller can already say it, since the caller knows
 * whether it is holding a path relative to a project root or an entry. `file` is its absolute
 * path where the caller has one, so that what its imports name can be resolved.
 */
export function resolved(source: string, where: string, file?: string): void {
	// `$$props`, `$$restProps` and `$$slots` are Svelte's own names for the object a component was
	// called with, and never a name the data has to carry. The entry's object is the payload and a
	// child's is what its call site wrote, both of which `locals.ts` writes each of them out over;
	// a child the walk does not enter is Svelte's to render, where the names are its own. So there
	// is nowhere left for one of these to be unresolved, and reporting them refused components that
	// compile.
	// A clock, randomness and a host's global are read per request, where Svelte's render reads them,
	// so they resolve; what is left is a name a script writes that no binding was recorded for. See
	// spec/derivation.md, "Ambient input is read at request time, never at the build".
	const loose = bindings(source, file).unresolved.filter(
		(one) => !RESERVED.has(one.name) && one.reason === 'unknown',
	);
	if (loose.length === 0) return;

	// One line per name rather than per occurrence, and the expression only where it says more
	// than the name does.
	const seen = new Map<string, string>();
	for (const one of loose) {
		if (!seen.has(one.name)) seen.set(one.name, one.expression);
	}
	const show = ([name, at]: [string, string]): string =>
		at === name ? `\`${name}\`` : `\`${name}\` in \`${at}\``;
	const reasons = [
		`${[...seen].map(show).join(', ')}, which the data does not carry; the name has to come from \
the payload, an each block, a script in this file, or an import`,
	];

	throw new Error(`${where} reads ${reasons.join('; and ')}. See spec/derivation.md`);
}
