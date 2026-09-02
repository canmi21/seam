import { resolve, type Scope } from 'injector';

export type Source = { path: string } | { literal: string };

export interface Derivation {
	name: string;
	expression: string;
	/** `null` means the payload's own keys, which is the case for an entry component. */
	scope: Record<string, Source> | null;
}

/**
 * Turns an expression into a function once, at startup. `new Function` rather than an
 * interpreter: the expression is the author's own source, compiled from their component at build
 * time, and is no more trusted or less trusted than the rest of their bundle.
 *
 * The body uses `with`, which is normally a mistake and is exactly right here. It binds the
 * names of an object as variables, which is what a component's props are, and it is what lets
 * the expression stay unrewritten. A function built this way is sloppy mode, so `with` is legal.
 */
function build(expression: string): (bindings: Record<string, unknown>) => unknown {
	// eslint-disable-next-line no-new-func
	const fn = new Function('$scope', `with ($scope) { return (${expression}); }`) as (
		bindings: Record<string, unknown>,
	) => unknown;
	return fn;
}

/**
 * Takes what the load stage produced and returns the scope injection walks: that value under the
 * one name the protocol gives it, and the derived fields beside it.
 *
 * The two are one level apart rather than mixed, which is the point. A derived field is the
 * compiler's, not the author's, and putting it beside `data` rather than among its keys is what
 * makes a collision impossible and keeps it off the wire, where only `data` goes. See
 * spec/payload.md.
 */
export interface Derived {
	(data: unknown): Scope;
}

export function compile(derivations: readonly Derivation[]): Derived {
	const compiled = derivations.map((derivation) => ({
		name: derivation.name,
		scope: derivation.scope,
		evaluate: build(derivation.expression),
		source: derivation.expression,
	}));

	return (data) => {
		const out: Scope = { data };
		if (compiled.length === 0) return out;
		for (const derivation of compiled) {
			const bindings: Record<string, unknown> =
				derivation.scope === null
					? out
					: Object.fromEntries(
							Object.entries(derivation.scope).map(([name, source]) => [
								name,
								'path' in source ? resolve([out], source.path) : source.literal,
							]),
						);
			try {
				out[derivation.name] = derivation.evaluate(bindings);
			} catch (error) {
				throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
			}
		}
		return out;
	};
}
