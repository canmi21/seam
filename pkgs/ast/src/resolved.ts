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
	const loose = bindings(source, file).unresolved.filter((one) => !RESERVED.has(one.name));
	if (loose.length === 0) return;

	// One line per name rather than per occurrence, and the expression only where it says more
	// than the name does.
	const seen = new Map<string, string>();
	for (const one of loose) {
		if (!seen.has(one.name)) seen.set(one.name, one.expression);
	}
	const show = ([name, at]: [string, string]): string =>
		at === name ? `\`${name}\`` : `\`${name}\` in \`${at}\``;
	const ambient = loose.filter((one) => one.reason === 'ambient').map((one) => one.name);
	const free = loose.filter((one) => one.reason === 'free').map((one) => one.name);
	const unknown = [...seen]
		.filter(([name]) => !ambient.includes(name) && !free.includes(name))
		.map(show);

	// Three of these are refusals an author can act on now, so each says what to do about it rather
	// than only what is wrong. See spec/refusals.md.
	const reasons = [
		unknown.length > 0
			? `${unknown.join(', ')}, which the data does not carry; the name has to come from the \
payload, an each block, a script in this file, or an import`
			: '',
		// **A name no script writes is the host's, and that is the scope line rather than work.**
		// The other reading of an unresolved name is a binding this compiler failed to record, and
		// there are six of those, which is why they are ranked as a gap. This one is not: nothing
		// in the file ever wrote the name, so the only thing left that could hold it is the global
		// scope of whatever is running -- and spec/pipeline.md says the second backend embeds an
		// evaluator with no host of any kind, so the same artifact would serve two different pages.
		// `process` is the one name kept, and spec/derivation.md writes down what that costs.
		free.length > 0
			? `${[...new Set(free)].map((name) => `\`${name}\``).join(', ')}, which no script in this \
file writes, so it can only be a global of whatever is running -- and a backend that is not Node \
embeds an evaluator with no host to hold one. Read it in the load stage and put the value in the \
data`
			: '',
		ambient.length > 0
			? `${[...new Set(ambient)].map((name) => `\`${name}\``).join(', ')}, which does not read \
the same twice; the load stage can determine the value and put it in the data`
			: '',
	].filter((one) => one !== '');

	throw new Error(`${where} reads ${reasons.join('; and ')}. See spec/derivation.md`);
}
