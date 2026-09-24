import { GIVEN, OPTIONS } from 'ast';
import { HYDRATABLES, hydratables, resolve, SCOPED, type Scope, thenable, waiting } from 'injector';

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
	 * A call of Svelte's `hydratable` the entry's script makes as it initializes: computed on every
	 * request, first after the defaults and in order, whether or not anything reads it, because
	 * Svelte's script makes it whether or not the markup does. Its value goes nowhere; what it is for
	 * is the key it records. See `Skeleton.eager` in the skeleton package.
	 */
	eager?: boolean;
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
	/**
	 * Null for an expression that waits on nothing. Otherwise it is built `async`, and these are the
	 * names of other derivations it reads that wait: each is awaited before the expression runs, so
	 * it reads their values rather than their promises. See `compile`.
	 */
	waits: readonly string[] | null = null,
): (bindings: Record<string, unknown>, request?: Record<string, unknown>) => unknown {
	// The shared helpers outermost, then each file of the chain from the entry inward, so the
	// component the expression sits in shadows its callers, and the data innermost of all.
	const scopes = ['*', ...chain.toReversed()].map((file) => files[file] ?? {});
	const opened = scopes.map((_, at) => `with ($files[${String(at)}]) {`).join(' ');
	const closed = '}'.repeat(scopes.length);
	// eslint-disable-next-line no-new-func
	const first =
		waits === null || waits.length === 0
			? ''
			: `await Promise.all([${waits.map((one) => `$scope[${JSON.stringify(one)}]`).join(', ')}]); `;
	// Innermost of all, what the request binds for itself: the names a carried file marks as
	// Svelte's `hydratable`, bound to this request's. See `marked`.
	const made =
		waits === null
			? `return ($scope, $request = {}) => { with ($scope) { with ($request) { return (${expression}); } } };`
			: `return async ($scope, $request = {}) => { ${first}with ($scope) { with ($request) { return (${expression}); } } };`;
	const make = new Function('$files', `${opened} ${made} ${closed}`) as (
		files: Record<string, unknown>[],
	) => (bindings: Record<string, unknown>, request?: Record<string, unknown>) => unknown;
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
	/** `options` is what the server passes `render()`, Kit's `transformError` among it. */
	(props: Scope, options?: Scope): Scope;
}

export function compile(derivations: readonly Derivation[], carried = ''): Derived {
	const files = (evaluate(carried)['files'] ?? {}) as Record<string, Record<string, unknown>>;
	const awaiting = waits(derivations);
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
				: build(
						derivation.expression,
						files,
						derivation.files ?? [],
						awaiting.get(derivation.name) ?? null,
					),
		source: derivation.expression,
		/** Whether it was built `async`, which is the only promise it returns that is waited on. */
		asynchronous: awaiting.has(derivation.name),
		eager: derivation.eager === true,
		marked: marked(files, derivation.files ?? []),
	}));
	const hydrating = compiled.some((one) => one.marked.length > 0);

	return (props, options = {}) => {
		const out: Scope = { ...props };
		// The payload itself, under a name nothing an author writes can be: `$$props` is the object
		// a component was called with, and the entry's is the payload. An expression reads its scope
		// through `with`, which binds the keys and not the object, so `$$props`, `$$restProps` and a
		// rest in the entry's `$props()` had nothing to be built from. The derived fields sit beside
		// the props in `out` and are not part of it, which is why this holds `props` and not `out`.
		out[GIVEN] = props;
		// The render options beside it, under a name of the same kind. See `OPTIONS` in `ast`.
		out[OPTIONS] = options;
		if (compiled.length === 0) return out;
		// One table per request, which every derivation calling `hydratable` fills and the injector
		// writes out. See `hydratables` in the injector.
		const table = hydratables();
		if (hydrating) out[HYDRATABLES] = table.record;
		const requested = (names: readonly string[]): Record<string, unknown> =>
			Object.fromEntries(names.map((name) => [name, table.hydratable]));
		for (const derivation of compiled) {
			const request = requested(derivation.marked);
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
						return failing(
							derivation.evaluate(stacked(scopes), request),
							derivation.source,
							derivation.asynchronous,
						);
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
				let value: unknown;
				try {
					value = derivation.evaluate(bindings(), request);
				} catch (error) {
					throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
				}
				// One that awaits -- a default read from the script's run in async mode -- is waited on
				// where it is read, and reads as its value once it settles, as any derivation does.
				const name = derivation.name;
				out[name] =
					derivation.asynchronous && thenable(value)
						? waiting(
								Promise.resolve(value).then((settled) => {
									out[name] = settled;
									return settled;
								}),
							)
						: value;
				continue;
			}
			// Made now, as Svelte's script makes it, and read by nothing. See `Derivation.eager`.
			if (derivation.eager) {
				try {
					out[derivation.name] = failing(
						derivation.evaluate(bindings(), request),
						derivation.source,
						derivation.asynchronous,
					);
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
						held = failing(
							derivation.evaluate(bindings(), request),
							derivation.source,
							derivation.asynchronous,
						);
					} catch (error) {
						throw new Error(`deriving \`${derivation.source}\` failed`, { cause: error });
					}
					done = true;
					// Once it settles it reads as its value, so what reads it after an `await` reads
					// the value rather than the promise. See `build`.
					if (derivation.asynchronous && thenable(held)) {
						held = waiting(
							Promise.resolve(held).then((value) => {
								held = value;
								return value;
							}),
						);
					}
					return held;
				},
			});
		}
		return out;
	};
}

/**
 * The names an expression's files carry as Svelte's `hydratable`, which the request binds to its
 * own. The carried bundle stands a marked function in for the import, and the evaluator puts the
 * request's over it, innermost. See `hydratable` in the carry package.
 */
function marked(
	files: Record<string, Record<string, unknown>>,
	chain: readonly string[],
): string[] {
	const names = new Set<string>();
	for (const file of ['*', ...chain]) {
		for (const [name, value] of Object.entries(files[file] ?? {})) {
			if (
				typeof value === 'function' &&
				(value as unknown as Record<symbol, unknown>)[MARK] === true
			) {
				names.add(name);
			}
		}
	}
	return [...names];
}

const MARK = Symbol.for('seam.hydratable');

/**
 * Which derivations wait, and on which others: one whose expression holds an `await`, and one that
 * reads one that waits, to the fixed point. The second reads through `with`, which would hand it the
 * other's promise, so it is built to await those names first. Only a project in Svelte's async mode
 * has an `await` here, and only of a value the build can know. See spec/derivation.md.
 */
function waits(derivations: readonly Derivation[]): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const one of derivations) {
		if (/\bawait\b/.test(one.expression)) found.set(one.name, []);
	}
	for (let moved = true; moved;) {
		moved = false;
		for (const one of derivations) {
			const reads = [...found.keys()].filter(
				(name) =>
					name !== one.name &&
					new RegExp(`(?<![\\w$])${escaped(name)}(?![\\w$])`).test(one.expression),
			);
			const held = found.get(one.name);
			if (
				reads.length === 0 ||
				(held !== undefined && reads.every((name) => held.includes(name)))
			) {
				continue;
			}
			found.set(one.name, [...new Set([...(held ?? []), ...reads])]);
			moved = true;
		}
	}
	return found;
}

function escaped(name: string): string {
	return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A derivation's value, with a rejection saying which derivation it was, the way a throw does. */
function failing(value: unknown, source: string, asynchronous: boolean): unknown {
	if (!asynchronous || !thenable(value)) return value;
	return waiting(
		Promise.resolve(value).catch((error: unknown) => {
			throw new Error(`deriving \`${source}\` failed`, { cause: error });
		}),
	);
}
