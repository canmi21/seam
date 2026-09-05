import { resolve, SCOPED, type Scope } from 'injector';

export type Source = { path: string } | { literal: string };

export interface Derivation {
	name: string;
	expression: string;
	/** `null` means the payload's own keys, which is the case for an entry component. */
	scope: Record<string, Source> | null;
	/**
	 * Computed where it is used rather than here, because it reads a name an each block binds.
	 *
	 * It is the same pure function as any other derivation; what its inputs are decides how often
	 * it is called. So it goes into the scope as a function of the scopes, and the injector calls
	 * it at the point of use, where the loop variable exists. See spec/derivation.md.
	 */
	scoped?: boolean;
}

/**
 * Turns an expression into a function once, at startup. `new Function` rather than an
 * interpreter: the expression is the author's own source, compiled from their component at build
 * time, and is no more trusted or less trusted than the rest of their bundle.
 *
 * The body uses `with`, which is normally a mistake and is exactly right here. It binds the
 * names of an object as variables, which is what a component's props are, and it is what lets
 * the expression stay unrewritten. A function built this way is sloppy mode, so `with` is legal,
 * where a module is always strict and would not take it at all.
 *
 * Two scopes, nested. The outer one holds what the component imported, which is the same for
 * every request; the inner one holds the data, which is not. Nesting them rather than merging
 * them is what stops a payload key from shadowing a carried function, or the reverse.
 */
function build(
	expression: string,
	carried: Record<string, unknown>,
): (bindings: Record<string, unknown>) => unknown {
	// eslint-disable-next-line no-new-func
	const make = new Function(
		'$carried',
		`with ($carried) { return ($scope) => { with ($scope) { return (${expression}); } }; }`,
	) as (carried: Record<string, unknown>) => (bindings: Record<string, unknown>) => unknown;
	return make(carried);
}

/**
 * Evaluates the bundle a component's expressions call into, once, and returns what it exported.
 *
 * The script is an immediately invoked function assigning to one name, so returning that name is
 * all it takes to read the exports back. No module loader is involved, which is the point: the
 * evaluator that runs derivations is not required to have one. See spec/derivation.md.
 */
function evaluate(script: string): Record<string, unknown> {
	if (script === '') return {};
	// eslint-disable-next-line no-new-func
	const exports = new Function(`${script}\nreturn __carried;`)() as unknown;
	if (typeof exports !== 'object' || exports === null) {
		throw new Error('the carried bundle did not produce anything to call');
	}
	return exports as Record<string, unknown>;
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

export function compile(derivations: readonly Derivation[], carried = ''): Derived {
	const imported = evaluate(carried);
	const compiled = derivations.map((derivation) => ({
		name: derivation.name,
		scope: derivation.scope,
		scoped: derivation.scoped,
		evaluate: build(derivation.expression, imported),
		source: derivation.expression,
	}));

	return (data) => {
		// What the component imported sits under the data, so a path rooted at an import -- a
		// constant read as `URLS.external.fonts`, which the lowering keeps as a path because it
		// is one -- resolves the way a derivation reading the same name does. The data is spread
		// last for the same reason the two `with` scopes nest: a payload key shadows an import.
		const out: Scope = { ...imported, data };
		if (compiled.length === 0) return out;
		for (const derivation of compiled) {
			const bindings = (): Record<string, unknown> =>
				derivation.scope === null
					? out
					: Object.fromEntries(
							Object.entries(derivation.scope).map(([name, source]) => [
								name,
								'path' in source ? resolve([out], source.path) : source.literal,
							]),
						);
			// A scoped one is not computed here at all: what it reads does not exist yet. It goes
			// into the scope as a function of the scope stack, tagged so the injector knows to call
			// it rather than write it out, and the stack is flattened innermost last so an each
			// binding shadows an outer name the way `resolve` has it shadow.
			if (derivation.scoped === true) {
				const held = (scopes: readonly Scope[]): unknown => {
					try {
						return derivation.evaluate(Object.assign({}, ...scopes) as Record<string, unknown>);
					} catch (error) {
						throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
					}
				};
				out[derivation.name] = Object.assign(held, { [SCOPED]: true });
				continue;
			}
			try {
				out[derivation.name] = derivation.evaluate(bindings());
			} catch (error) {
				throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
			}
		}
		return out;
	};
}
