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
	/**
	 * A derivation that stands over a payload key rather than beside it: a prop's default, whose
	 * expression is the default itself and whose name is the prop's.
	 *
	 * Taken where the payload's **property** is `undefined`, which is what `$props()` destructuring
	 * does and is a question about the object rather than about what the name resolves to. Asking
	 * `typeof x === 'undefined'` inside the expression is a different question and a wrong one:
	 * the scope is read through `with`, so a prop nobody sent falls through to the global of that
	 * name, and `export let Math = { min: ... }` never took its default.
	 *
	 * Computed in order, while the names around it still hold what the request brought, since one
	 * default may read another prop.
	 *
	 * **Every prop the entry declares has one, default or not.** The one with no default holds
	 * `undefined`, and its whole job is that the name is in scope: an expression reads its scope
	 * through `with`, which falls through to the globals for a key the payload has not got, and
	 * `class:unused` over a prop nobody sent threw `unused is not defined` per request where Svelte
	 * writes no class.
	 */
	prop?: boolean;
	/**
	 * The files the expression was written across, innermost first. Each name in it resolves in
	 * the first of these that imports it, so the evaluator opens their imports as scopes, the
	 * innermost shadowing the rest. Absent for an expression the compiler wrote itself.
	 */
	files?: string[];
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
 * Nested scopes. The outer ones hold what each file the expression was written across imported,
 * which is the same for every request, the innermost file shadowing its callers; the inner one
 * holds the data, which is not. Nesting rather than merging is what keeps a payload key from
 * shadowing a carried function, or the reverse, and what lets each file keep its own bindings.
 */
function build(
	expression: string,
	files: Record<string, Record<string, unknown>>,
	chain: readonly string[],
): (bindings: Record<string, unknown>) => unknown {
	// The shared helpers outermost, then each file of the chain from the entry inward, so the
	// component the expression sits in shadows its callers, and the data innermost of all.
	const scopes = ['*', ...chain.toReversed()].map((file) => files[file] ?? {});
	const opened = scopes.map((_, at) => `with ($files[${String(at)}]) {`).join(' ');
	const closed = '}'.repeat(scopes.length);
	// eslint-disable-next-line no-new-func
	const make = new Function(
		'$files',
		`${opened} return ($scope) => { with ($scope) { return (${expression}); } }; ${closed}`,
	) as (files: Record<string, unknown>[]) => (bindings: Record<string, unknown>) => unknown;
	return make(scopes);
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
 * The scope stack as one object to read through, rather than one flattened into a copy.
 *
 * It was `Object.assign({}, ...scopes)`, and that was the whole of a response. A scoped derivation
 * is evaluated once for every item it stands in, and the scope it is given is the route's --
 * holding every derivation the artifact carries, which for a route joined out of several
 * structures is all of theirs. Measured on press's article: 13,224 derivations, 10,692 of them
 * scoped, and injecting one page took **1133ms of a 1180ms response**, nearly all of it copying
 * the same thirteen thousand keys over and over.
 *
 * The expressions read their scope through `with`, which asks an object what it has and what it
 * holds -- so an object that answers by looking down the stack is the same scope without the copy.
 * Innermost last, which is the order `Object.assign` gave it, so an each binding still shadows an
 * outer name; and own properties only, which is what `Object.assign` copied -- reading through the
 * prototype would make `toString` a name in scope.
 */
function stacked(scopes: readonly Scope[]): Record<string, unknown> {
	const [only] = scopes;
	if (scopes.length === 1 && only !== undefined) return only;
	return new Proxy(Object.create(null) as Record<string, unknown>, {
		has: (_, key) => scopes.some((one) => Object.hasOwn(one, key)),
		get: (_, key) => {
			for (let at = scopes.length - 1; at >= 0; at -= 1) {
				const one = scopes[at];
				if (one !== undefined && Object.hasOwn(one, key)) return one[key as string];
			}
			return undefined;
		},
	});
}

/**
 * Takes the entry's props as the load stage filled them and returns the scope injection walks:
 * those props, and the derived fields beside them.
 *
 * The props are the scope's top level because the IR's paths are written in the entry's own
 * names: `data.title` for a page compiled alone, `data_2.title`, `params.slug` and `form` for a
 * route's generated root, which takes one `data_n` per node of its branch. A derived field is the
 * compiler's, not the author's, and sits beside the props under a name no prop has, which keeps
 * it off the wire, where only the props go. See spec/payload.md.
 */
export interface Derived {
	(props: Scope): Scope;
}

export function compile(derivations: readonly Derivation[], carried = ''): Derived {
	const files = (evaluate(carried)['files'] ?? {}) as Record<string, Record<string, unknown>>;
	const compiled = derivations.map((derivation) => ({
		name: derivation.name,
		scope: derivation.scope,
		scoped: derivation.scoped,
		prop: derivation.prop,
		// A prop with no default stands over the payload's key to put the name in scope and holds
		// nothing, so there is no expression to compile: `with` asks the payload whether it has the
		// name, and a key the request did not send has to answer yes and `undefined` rather than
		// falling through to the globals. See `Derivation.prop`.
		evaluate:
			derivation.prop === true && derivation.expression === 'undefined'
				? (): unknown => undefined
				: build(derivation.expression, files, derivation.files ?? []),
		source: derivation.expression,
	}));

	return (props) => {
		const out: Scope = { ...props };
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
						return derivation.evaluate(stacked(scopes));
					} catch (error) {
						throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
					}
				};
				out[derivation.name] = Object.assign(held, { [SCOPED]: true });
				continue;
			}
			// A prop's default stands over the payload's key and is computed in order. The test is
			// the property's value and nothing else, which is what destructuring does: absent and
			// present-as-`undefined` are the same case, and `null` is not one of them. See
			// `Derivation.prop`.
			if (derivation.prop === true) {
				if (out[derivation.name] !== undefined) continue;
				try {
					out[derivation.name] = derivation.evaluate(bindings());
				} catch (error) {
					throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
				}
				continue;
			}
			// Everything else is computed when it is read, once, and not before. A derivation is a pure expression, so
			// when it is computed cannot change what it is -- and whether it is computed at all can:
			// `{#if boxes.length === 2}{@const box2 = boxes[1]}` is a derivation that only makes
			// sense inside its branch, and Svelte evaluates a `{@const}` in the branch's own init.
			// Evaluated up front it threw for every request that took another branch, and the
			// artifact had already been written, so the refusal arrived per request rather than at
			// the build. It also stops a route paying for the derivations of the branches it did not
			// take, which is most of them on a page joined out of several structures.
			let held: unknown;
			let done = false;
			Object.defineProperty(out, derivation.name, {
				configurable: true,
				enumerable: true,
				get: () => {
					if (done) return held;
					try {
						held = derivation.evaluate(bindings());
					} catch (error) {
						throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
					}
					done = true;
					return held;
				},
			});
		}
		return out;
	};
}
