import { parse } from 'svelte/compiler';
import { ambientIn } from './ambient.ts';
import { type Edit, type Neutral, apply } from './edits.ts';
import { chains, INIT, SLOT, isNode, type Node, reads, requested, within } from './scope.ts';
import { GIVEN } from './runes.ts';
import { assigned, declared, losing } from './declarations.ts';
import { awaitsOutside, kept, MAKES, mentions, pathOf, shared } from './expressions.ts';
import { ANSWERED, answered, derived, reactive, RESERVED } from './reactive.ts';
import { type Declared, type Locals } from './locals-types.ts';
import { withheld } from './withheld.ts';

/**
 * What a component's scripts declare, as source to be substituted into whatever reads it.
 *
 * Substituting rather than evaluating is what makes a module constant and a constant reading props
 * one mechanism rather than two: `LIMIT` becomes `10` and `total` becomes `data.x * 2`, and the
 * second is a derivation for exactly the reason any other expression is. Nothing is run at build
 * time and nothing has to be serialisable. See spec/derivation.md.
 */

export function locals(
	source: string,
	fixed: ReadonlyMap<string, string> = new Map(),
	/**
	 * The name a `$props.id()` declaration stands for: a binding the runtime makes when it writes
	 * the anchor, one per component instance, so two components declaring an id in one page do not
	 * share it. Given by the walk, which knows which copy this is; the default serves a caller that
	 * only asks which names are declared.
	 */
	fresh: string | null = null,
	/**
	 * What each prop is bound to at the call site, by the prop's local name, as an expression in
	 * the caller's terms already expanded. Given for a component the walk entered; the entry has
	 * none, its props being the payload.
	 */
	bound?: ReadonlyMap<string, string>,
	/** The names the request decides in the caller's scope, which is what `bound` may mention. */
	dynamic?: ReadonlySet<string>,
	/** The entry's own props, which are the payload rather than declarations. See `declared`. */
	props: ReadonlySet<string> = new Set(),
	/**
	 * The names a caller passes for this component's props, which is what `$$restProps` leaves out.
	 * `transform-server.js` builds that list from `analysis.exports` aliases and the bindable
	 * props, so it is the prop's own name rather than the local it was destructured into.
	 */
	passed: readonly string[] = [],
	/**
	 * What the call site passed this component, for a child the walk entered: the object as source,
	 * and the slot names the caller filled.
	 *
	 * `transform-server.js` binds `$$props` to `sanitize_props($$props)`, `$$restProps` to
	 * `rest_props($$sanitized_props, [named])` and `$$slots` to `sanitize_slots($$props)`, each over
	 * the object the caller passed. The entry's is the payload, bound under `GIVEN`; a child's is
	 * this. `sanitize_props` drops `children` and `$$slots`, which this object never carries, so it
	 * is a no-op here; `sanitize_slots` reads which slots were filled, which the caller knows by
	 * name and this carries as one.
	 */
	passing?: { object: string; slots: readonly string[] },
	/**
	 * Where a held initialiser is recorded, shared across every file of one walk.
	 *
	 * **A pattern's initialiser is written once per name it binds**, and where that initialiser
	 * makes something the names come out of different values: `let [one, two] = $state(test())` over
	 * a generator called `test()` twice and read `0` from one call and `0` from the other, where
	 * Svelte calls it once and reads `0` and `1`. It is written as a reference into this list
	 * instead, and the pass that names derivations resolves the reference to the name it already
	 * gave that text, so every name the pattern binds reaches into one value. See
	 * spec/derivation.md.
	 */
	held?: { expression: string; files?: string[] }[],
	/**
	 * Which of the refusals below are made here. `names` makes none, for a caller asking only which
	 * names are declared -- `bindings()`, `reduce()` -- where one of them stopped a name check that
	 * had nothing to do with it. `run` is the walk of an entry, whose script runs as Svelte compiled
	 * it where a read cannot be substituted: a name that cannot be followed comes back in `changed`
	 * and its reads become fields of that run, while a write into the props object, which the run
	 * cannot hand back, is still refused. See spec/derivation.md, "Where substitution cannot
	 * follow, the script runs as Svelte compiled it".
	 */
	refusing: 'refuse' | 'names' | 'run' = 'refuse',
): Locals {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const carried = requested(ast['instance']);
	const imports = importedNames(ast);
	const found = declared(ast, source, carried, fresh, props, bound === undefined) as Map<
		string,
		Declared & { node: Node }
	>;

	// Refused rather than substituted wrongly. Two of these compiled and wrote the wrong bytes with
	// nothing to say so, which is the shape this compiler keeps finding: a model narrower than its
	// input, and no error where they part.
	// The props too, which are not declarations: `let { options = 'foo' } = $props(); options = 'bar'`
	// is one statement of the instance script and Svelte runs it before the template, so the name
	// holds `bar` while the bytes are written. Substituted, it stands for the payload's key and
	// wrote `foo`. The entry's arrive as `props` and a child's as the names `bound` was given, a
	// `$props()` destructuring being read by `propsOf` rather than declared here.
	const names = new Set([...found.keys(), ...props, ...(bound?.keys() ?? [])]);
	// A `$:` that declares a name is also the assignment to it, and reading that as an assignment
	// after a declaration would refuse every reactive declaration there is. Where a `let x` exists
	// beside it the name is not recorded as reactive, and the refusal stands.
	const declares = new Set(
		[...found.values()].filter((one) => one.reactive === true).map((one) => one.name),
	);
	const moved = [
		...assigned(ast['module'], names, false, declares),
		...assigned(ast['instance'], names, false, declares),
	];
	/**
	 * The names substitution cannot follow, each with the sentence that says why.
	 *
	 * **Recorded rather than refused here.** Substitution is what cannot follow a change; the render
	 * runs the instance script and has the value. So a read of one of these is left as the author
	 * wrote it, which the render evaluates correctly, and the refusal belongs where the walk writes
	 * an expansion out instead. See spec/derivation.md.
	 */
	const changed = new Map<string, string>();
	/** Names a neutralised `$:` binds, filled by `reactive()` below. See `eager`. */
	const gone = new Set<string>();
	if (moved.length > 0) {
		const list = [...new Set(moved)].map((one) => `\`${one}\``).join(', ');
		const why =
			`${list} ${moved.length > 1 ? 'are' : 'is'} assigned after being declared, and the markup ` +
			'reads a name by the expression it was declared to be, which stops being what the name ' +
			'holds. Compute the value in one expression, or move the assignment into a function, ' +
			'which does not run while the bytes are written. See spec/derivation.md';
		for (const one of moved) changed.set(one, why);
	}
	for (const [name, why] of losing(
		ast,
		found as Map<string, Declared & { node: Node; free: Set<string> }>,
		names,
		declares,
	)) {
		// The first sentence wins. A name assigned after being declared is often also changed by a
		// function, and the assignment is the more particular of the two things to say.
		if (!changed.has(name)) changed.set(name, why);
	}
	// A declaration whose initialiser does not read the same twice -- `const s = Symbol()` -- is one
	// value per request, and substitution would make one per read. The script run holds it once. See
	// spec/derivation.md, "Ambient input is read at request time, never at the build".
	for (const [name, one] of found) {
		if (changed.has(name) || ambientIn(one.node).length === 0) continue;
		changed.set(
			name,
			`\`${name}\` is declared with a value that does not read the same twice, and the markup ` +
				'reads a name by the expression it was declared to be, so every read would make another. ' +
				'Compute the value in one expression, or move it into the load stage. See ' +
				'spec/derivation.md',
		);
	}

	// Svelte's own names for the object a caller passed are rebuilt at every read here -- the
	// entry's out of the payload, a child's out of what its call site wrote -- so a script that
	// writes into one has changed a value nothing else holds. `$: $$restProps.c = $$restProps.c ??
	// 'c'` beside `{$$restProps.c}` wrote nothing where Svelte wrote `c`: the same rule an
	// assignment after a declaration falls under, on a name that is not a declaration.
	const written = [
		...assigned(ast['module'], RESERVED, false, declares),
		...assigned(ast['instance'], RESERVED, false, declares),
	];
	if (written.length > 0 && refusing !== 'names') {
		const list = [...new Set(written)].map((one) => `\`${one}\``).join(', ');
		throw new Error(
			`${list} ${written.length > 1 ? 'are' : 'is'} written to, and it is not a value this ` +
				'compiler holds: the object a caller passed is rebuilt wherever it is read, so a write ' +
				'into it is lost. Compute the value in one expression, or move the write into a ' +
				'function, which does not run while the bytes are written. See spec/derivation.md',
		);
	}

	// Stores the script itself writes: `$count += 1` sets the store before the template runs, so
	// the value the markup reads is the one those statements left. The render runs the script and
	// has it; a derivation does not, and reading the store fresh would give what it was declared
	// with. So a subscription to one of these is left as written, for the render, which is what it
	// was before the read below was expanded at all.
	// A `$:` that declares a name is not one of these. `$: ({ store } = container)` binds `store`
	// rather than writing to a store the script already had, so `$store` is a subscription the
	// artifact reads like any other. Read as a write it left the whole read to the render, which
	// is given no props and wrote nothing.
	const settled = new Set([
		...assigned(ast['module'], names, true, declares),
		...assigned(ast['instance'], names, true, declares),
	]);

	// A store the script writes is one of these too. `$count += 1` sets the store before the
	// template runs, so the value the markup reads is the one those statements left: the render has
	// it and a derivation reads what the store was declared with. The read is left as written, which
	// is right where the render evaluates it and is a free `$count` where this compiler has to write
	// the expression itself.
	for (const name of settled) {
		// Only where nothing more particular has been said. `settled` is every name the scripts
		// assign to, read with a `$x` target reported as `x`, so a plain name is in it too and the
		// sentence about the declaration it was assigned after is the better one.
		if (changed.has(name)) continue;
		changed.set(
			name,
			`\`$${name}\` is a store this component's own script writes, and the value the markup ` +
				'reads is the one those statements left. The render runs them; a derivation is ' +
				'evaluated outside the script and reads what the store was declared with. Compute the ' +
				'value in one expression, or move what writes it out of the render. See ' +
				'spec/derivation.md',
		);
	}

	const expanded = new Map<string, string>();
	/**
	 * Whether a name a pattern binds is expanded, or left as the script declares it: a reading
	 * written into the script the render runs reads the script's own name, since what a pattern's
	 * expansion is spelled with -- `$$hold(k)`, `$$to_array(...)` -- is the derivations' and no name
	 * Svelte compiles. `@lucide/svelte`'s `Icon` spreads one name of an array pattern over a
	 * `$derived` into another `$derived`.
	 */
	let patternsAsWritten = false;

	function slice(
		node: unknown,
		open: ReadonlySet<string>,
		extra?: ReadonlyMap<string, string>,
		/** Read at this depth only, and never handed to `expand`. See `Locals['rewrite']`. */
		sent?: ReadonlyMap<string, string>,
	): string {
		if (!isNode(node)) return '';
		const { start, end } = node;
		if (typeof start !== 'number' || typeof end !== 'number') return '';

		const edits: Edit[] = [];
		// A path this render is being made for is written out as the value it holds. Whole chains
		// first, and an identifier inside one is left alone afterwards, because two edits over the
		// same characters is a mistake upstream rather than a case to resolve.
		const taken = new Set<number>();
		// A rune call is written as what the server writes there, before anything else looks at the
		// names inside it: `$effect.tracking()` is `false` and holds no names any more, and
		// `$state(v)` is `v` and holds all of them. See `ANSWERED`.
		const replaced: [number, number][] = [];
		answered(node, (one, rune) => {
			const at = [one['start'], one['end']];
			if (typeof at[0] !== 'number' || typeof at[1] !== 'number') return;
			const answer = ANSWERED[rune];
			if (answer !== null && answer !== undefined) {
				edits.push([at[0], at[1], answer]);
				replaced.push([at[0], at[1]]);
				return;
			}
			// The argument itself, with the call around it taken off so the argument's own names are
			// still rewritten where they stand.
			const args = Array.isArray(one['arguments']) ? one['arguments'] : [];
			const [only] = args;
			if (!isNode(only) || typeof only['start'] !== 'number' || typeof only['end'] !== 'number') {
				edits.push([at[0], at[1], 'undefined']);
				replaced.push([at[0], at[1]]);
				return;
			}
			edits.push([at[0], only['start'], '(']);
			edits.push([only['end'], at[1], ')']);
		});
		// A `$derived` written as a class field is a getter, which is the shape `ClassBody.js` gives
		// it. Svelte fills `analysis.classes` in the analysis and answers each field from it: a
		// `$state` or `$state.raw` field is visited in place, where `CallExpression.js` returns the
		// argument -- which `answered()` above already does -- and a `$derived` field becomes a
		// backing property holding `$.derived(() => e)` beside a getter that calls it. Left alone,
		// the rune survived substitution into an expression this compiler has to write itself, where
		// it is a name nothing defines.
		//
		// **The getter re-evaluates, and so does Svelte's**: `$.derived` memoises with `once` only
		// where `ssr_context` is set, and a derivation is evaluated outside a render. What the thunk
		// buys is laziness, which the getter has too -- a field initialiser would run at
		// construction, before a field written after it exists.
		derived(node, (one, at, argument, called) => {
			const key = one['key'];
			const name = isNode(key) && key['type'] === 'Identifier' ? key['name'] : null;
			if (typeof name !== 'string' || one['static'] === true || one['computed'] === true) return;
			edits.push([at[0], argument[0], `get ${name}() { return (`]);
			edits.push([argument[1], at[1], called ? ')() }' : ') }']);
		});
		const replacedAt = (from: number): boolean => replaced.some(([a, b]) => from >= a && from < b);
		if (fixed.size > 0) {
			chains(node, (at, base, rest) => {
				const name = base['name'];
				if (typeof name !== 'string') return false;
				const root = extra?.get(name) ?? (found.has(name) ? expand(name, open, extra) : name);
				const head = pathOf(root);
				if (head === null) return false;
				if (typeof base['start'] === 'number' && replacedAt(base['start'])) return false;
				const literal = fixed.get([head, ...rest].join('.'));
				if (literal === undefined) return false;
				const from = base['start'];
				if (typeof from === 'number') taken.add(from);
				edits.push([at[0], at[1], literal]);
				return true;
			});
		}
		// The functions inside this node that are not `async`, where an `await` is not JavaScript.
		const closures: [number, number][] = [];
		const functions = (one: unknown): void => {
			if (Array.isArray(one)) {
				for (const each of one) functions(each);
				return;
			}
			if (!isNode(one)) return;
			const type = one['type'];
			if (
				(type === 'FunctionExpression' ||
					type === 'ArrowFunctionExpression' ||
					type === 'FunctionDeclaration') &&
				one['async'] !== true &&
				typeof one['start'] === 'number' &&
				typeof one['end'] === 'number'
			) {
				closures.push([one['start'], one['end']]);
			}
			for (const [key, value] of Object.entries(one)) {
				if (key !== 'parent') functions(value);
			}
		};
		functions(node);
		const inClosure = (at: number): boolean => closures.some(([from, to]) => at > from && at < to);
		reads(node, new Set(), (at, shorthand) => {
			const name = at['name'];
			if (typeof name !== 'string') return;
			if (open.has(name)) {
				// A name standing in for itself. For an ordinary declaration that is the author's cycle
				// and the name is left for the pass that resolves names to report. For a `$:` it is
				// Svelte's own answer and it is `undefined`: `transform-server.js` collects each
				// `legacy_reactive` binding the statement assigns and unshifts `let max;` above the
				// instance body, so `$: max = Math.max(num, max || 0)` reads nothing on the one pass
				// the server makes. Left as the name it resolved nowhere per request.
				if (found.get(name)?.reactive !== true) return;
				const from = at['start'];
				const to = at['end'];
				if (typeof from !== 'number' || typeof to !== 'number') return;
				if (taken.has(from)) return;
				edits.push([from, to, shorthand === true ? `${name}: undefined` : 'undefined']);
				return;
			}
			// Inside a rune call already replacedAt out as a constant, where nothing is left to name.
			if (typeof at['start'] === 'number' && replacedAt(at['start'])) return;
			// A name bound by something other than a script, which the caller knows about and this
			// does not: a snippet's parameter, whose value is the argument at the one `{@render}`
			// that calls it. It wins over a script declaration of the same name, being the inner
			// scope.
			// The settled names first: they are the innermost scope of all, being what the template
			// itself sees. `expand` is never given them, so a declaration reading the same name
			// reaches the value it had before the child sent anything.
			const settling = sent?.get(name);
			if (settling !== undefined) {
				const from = at['start'];
				const to = at['end'];
				if (typeof from !== 'number' || typeof to !== 'number') return;
				if (taken.has(from)) return;
				edits.push([from, to, shorthand === true ? `${name}: ${settling}` : settling]);
				return;
			}
			const given = extra?.get(name);
			// `$foo` is a subscription to the store `foo`, which Svelte compiles to
			// `store_get($$store_subs, '$foo', foo)`. Where `foo` is a declaration this pass can
			// substitute, the read is the store's value: `get` from `svelte/store`, which subscribes,
			// takes the value and unsubscribes -- Svelte's own `store_get` keeps the subscription
			// until the render tears down, and a derivation has no teardown to hang it on. Where
			// `foo` is what the request brought, `subscribing()` refuses it instead.
			// The whole of what a caller passed, which the entry's payload is. `transform-server.js`
			// writes `$$sanitized_props` as `sanitize_props($$props)` and `$$restProps` as
			// `rest_props($$sanitized_props, [named])`, and `$$slots` as `sanitize_slots($$props)`;
			// each is Svelte's own function over the object, and the object is bound under `GIVEN`.
			// Only for the entry: its object is the payload, bound under `GIVEN`. A child's is what
			// its call site passed, which is a different object and is refused where it is read.
			if (RESERVED.has(name) && (bound === undefined || passing !== undefined)) {
				const from = at['start'];
				const to = at['end'];
				if (typeof from !== 'number' || typeof to !== 'number') return;
				if (taken.has(from)) return;
				const listed = [...passed].map((one) => JSON.stringify(one)).join(', ');
				// A child's object is replacedAt out rather than named, and it never carries `children`
				// or `$$slots`, so `sanitize_props` has nothing to drop and is left off. Which slots
				// the caller filled is known by name, so `sanitize_slots` is replacedAt out too.
				const object = passing === undefined ? `${GIVEN}` : passing.object;
				const slots =
					passing === undefined
						? `($$sanitize_slots(${GIVEN}))`
						: `({ ${passing.slots.map((one) => `${JSON.stringify(one)}: true`).join(', ')} })`;
				const rest =
					passing === undefined
						? `($$rest_props($$sanitize_props(${GIVEN}), [${listed}]))`
						: `($$rest_props(${object}, [${listed}]))`;
				const substitute = name === '$$props' ? `(${object})` : name === '$$slots' ? slots : rest;
				edits.push([from, to, shorthand === true ? `${name}: ${substitute}` : substitute]);
				return;
			}
			const store = name.startsWith('$') && !RESERVED.has(name) ? name.slice(1) : null;
			if (given === undefined && !found.has(name)) {
				if (store === null) return;
				// A store the file declares, or one a prop holds: the entry's props are the render
				// input and a child's are what its call site bound, and either may be a store. See
				// spec/payload.md.
				const handed = props.has(store) || bound?.has(store) === true;
				// Or one a script imports, which the carried bundle imports too and reads as it
				// stands at the request. Left as `$store` it named nothing there. See spec/derivation.md,
				// "A store read is the store's value, where the store is a declaration".
				const imported = !found.has(store) && !handed && imports.has(store);
				if (!handed && !imported && (!found.has(store) || settled.has(store))) return;
				const from = at['start'];
				const to = at['end'];
				if (typeof from !== 'number' || typeof to !== 'number') return;
				if (taken.has(from)) return;
				// What the caller bound it to first, the way the branch below reads a name: a child's
				// `export let items;` is a declaration holding `undefined` here and a prop bound at
				// the call site there, and reading the declaration gave `$$get_store(undefined)`.
				let inner = extra?.get(store) ?? (imported ? store : expand(store, open, extra));
				if (inner === 'undefined') return;
				// A store that awaits, read inside a function that is not `async`: held, as below.
				if (
					held !== undefined &&
					inClosure(from) &&
					!inner.includes('$$hold(') &&
					awaitsOutside(inner)
				) {
					inner = `$$hold(${String(kept(inner, held))})`;
				}
				const read = `($$get_store(${inner}))`;
				edits.push([from, to, shorthand === true ? `${name}: ${read}` : read]);
				return;
			}
			const from = at['start'];
			const to = at['end'];
			if (typeof from !== 'number' || typeof to !== 'number') return;
			// Already replacedAt out as part of a bound path.
			if (taken.has(from)) return;
			// A name substitution cannot follow is left as the author wrote it. The render runs the
			// instance script and has the value; what cannot follow the change is writing the
			// initialiser at each read. Where the expression is one the render evaluates that is the
			// whole answer, and where it is one this compiler has to write itself the name survives
			// into it and the refusal is made there. See `changed` and spec/derivation.md.
			if (given === undefined && changed.has(name)) return;
			let inner = given ?? expand(name, open, extra);
			// **A value that awaits, read inside a function that is not `async`**, is one value awaited
			// once where Svelte's async mode awaits it: `const value = await getValue()` read inside
			// `keys.every((k) => value.has(k))`. Written out there the `await` is not JavaScript at
			// all, so it is held, the way a pattern's shared value is, and the read names the
			// derivation that holds it, which the program awaits before anything reading it. Only
			// there: held anywhere else it would be a derivation where the render could have
			// evaluated it. See spec/derivation.md.
			if (
				held !== undefined &&
				inClosure(from) &&
				!inner.includes('$$hold(') &&
				awaitsOutside(inner)
			) {
				inner = `$$hold(${String(kept(inner, held))})`;
			}
			const mark = `(${inner})`;
			edits.push([from, to, shorthand === true ? `${name}: ${mark}` : mark]);
		});

		return apply(source.slice(start, end), edits, start);
	}

	function expand(
		name: string,
		open: ReadonlySet<string>,
		extra?: ReadonlyMap<string, string>,
	): string {
		// Not cached when names come from outside: the same declaration expands differently for
		// two callers, which is the whole point of a composed child having its own call site.
		// A name substitution cannot follow is left as the author wrote it, wherever the expansion is
		// reached from: the read above is one way in and a `$store`'s own name is another, and the
		// second went on substituting after the first stopped -- `$: z = u.id` over a `u` the script
		// reassigns came out as `(undefined).id`.
		if (changed.has(name)) return name;
		const cached = expanded.get(name);
		if (cached !== undefined && open.size === 0 && extra === undefined) return cached;
		const one = found.get(name);
		if (one === undefined) return name;
		if (one.literal !== undefined) return one.literal;
		if (one.module === true) return name;
		// A `new` the request reaches is one instance per request, held as a pattern's value is:
		// `const live = new Live(data)` in `status` was a new `Live` at each of its reads, which
		// were thousands, each folding every row the page holds -- a tenth of a second of CPU a
		// request became seven, and an instance compared with itself would not have been. See
		// spec/derivation.md, "An instance is made once".
		const instance =
			one.reach === INIT &&
			held !== undefined &&
			one.node['type'] === 'NewExpression' &&
			one.rune === undefined;
		if (patternsAsWritten && (one.reach !== INIT || instance)) return name;
		// A name cannot stand in for itself. A cycle among declarations is the author's, and
		// leaving the name in place lets the pass that resolves names report it.
		const inner = new Set(open).add(name);
		// Carried down, so a declaration that reads a prop reaches the value the caller passed
		// rather than the name it was written with.
		const body = slice(one.node, inner, extra);
		// Parenthesised because what follows it is a member access, and because a function or a
		// class only reads as an expression that way.
		// Parenthesised only where something reaches into it: what follows is a member access, and a
		// function or a class only reads as an expression that way. Where the declaration named the
		// value directly the source stands as written, because a `function f() {}` wrapped in
		// parentheses is no longer a declaration and `export (function f() {})` is not JavaScript.
		// A pattern reaches into the initialiser, and every name it binds reaches into the same one.
		// Held where this walk has a list to hold it in, so that they reach into one value rather
		// than one each. A declaration that named the value directly is read once and needs none.
		let reached = one.reach === INIT ? body : within(one.reach, `(${body})`);
		// And only where the initialiser **makes** something: an object or array literal, a `new`, or
		// a call, whose two evaluations are two values. A pattern over a name or a member read takes
		// the same value apart however many times it is reached out, so holding it would buy nothing
		// and cost a derivation where the render used to evaluate the expression itself.
		const makes = MAKES.has(String(one.node['type']));
		if (one.reach !== INIT && held !== undefined && makes) {
			// What every name of this pattern shares, which is what has to be one value: the whole
			// `$$to_array(...)` call for an array, and the initialiser itself for an object. Holding
			// the initialiser alone is not enough for an array -- `to_array` would be called once per
			// name, and a second call over a generator reads an exhausted one, which is
			// `derived-destructured-iterator` reached as `[a, b, c]` and coming out `1`, empty,
			// empty.
			const cut = shared(one.reach);
			if (cut !== null) {
				const at = kept(within(cut, `(${body})`), held);
				reached = `$$hold(${String(at)})${one.reach.slice(cut.length)}`;
			}
		}
		if (instance && mentions(body, new Set([...(dynamic ?? carried), ...props, GIVEN]))) {
			reached = `$$hold(${String(kept(`(${body})`, held))})`;
		}
		for (const [at, node] of one.slots.entries()) {
			reached = reached.split(SLOT(at)).join(`(${slice(node, inner, extra)})`);
		}
		// A name declared to be one of the bound paths holds that path's value in this render.
		const path = fixed.size === 0 ? null : pathOf(reached);
		const text = (path === null ? undefined : fixed.get(path)) ?? reached;
		if (open.size === 0 && extra === undefined) expanded.set(name, text);
		return text;
	}

	const reading: Neutral[] = [
		...reactive(
			ast,
			found,
			new Set([...carried, ...props, ...(bound?.keys() ?? [])]),
			declares,
			gone,
		),
		...new Map(
			[...found.values()]
				.filter((one) => one.reads)
				.map((one): [string, Neutral] => {
					// Expanded whole to ask what it reads, and written with a pattern's names as the script
					// declares them. See `patternsAsWritten`.
					const deep = one.literal ?? slice(one.node, new Set([one.name]), bound);
					patternsAsWritten = true;
					let text: string;
					try {
						text = one.literal ?? slice(one.node, new Set([one.name]), bound);
					} finally {
						patternsAsWritten = false;
					}
					// `GIVEN` is the payload object, which the render is not given any more than it
					// is given a payload name. A declaration standing for it is neutralised for the
					// same reason one reading a prop is, and Svelte refuses a `$$` name outright.
					const neutralising = new Set([...(dynamic ?? carried), GIVEN]);
					const neutralised = !mentions(deep, neutralising) ? text : one.holds;
					// The render no longer computes this one either, so a read of it left as the
					// author wrote it reads the placeholder. `function foo() { b = c }` neutralised
					// over a `c` that reads a prop left `foo` as `null`, and the script's own
					// `foo()` failed inside Svelte's renderer.
					if (neutralised !== text) gone.add(one.name);
					if (process.env['SEAM_TRACE'] !== undefined && neutralised !== text) {
						const mentioned = [...neutralising].filter((each) => mentions(text, new Set([each])));
						console.error(
							`[seam] neutralised \`${one.name}\` mentioning ${mentioned.join(', ') || '(unparsable)'}: ` +
								text.replace(/\s+/g, ' ').slice(0, 240),
						);
					}
					return [one.at.join(':'), [one.at, neutralised]];
				}),
		).values(),
	];

	// **Two of these refuse here rather than where the expansion is written out.**
	//
	// A prop, because a copy of a component is handed `null` for every prop and a markup read of one
	// is always written out expanded: leaving the name would leave the copy reading nothing.
	//
	// A name a neutralised `$:` binds, because the render no longer computes it either. Leaving the
	// name is only right where the render evaluates the author's own text and gets the value the
	// script left, and a statement written over with `undefined` leaves nothing.
	//
	// A prop says so in its own words. The caller's value reaches a copy as a marker standing for
	// it, so the change is made to the marker -- `export let value; value += 1` wrote the marker
	// back with a digit on it, which nothing downstream could tell from the value. `descend()` reads
	// this sentence and lets it reach the author rather than rolling the copy back, since leaving
	// the component to Svelte is what hands it the marker.
	const given = [...changed].find(([name]) => props.has(name) || bound?.has(name) === true);
	if (given !== undefined && refusing === 'refuse') {
		throw new Error(
			`\`${given[0]}\` is a prop this component changes, and a value handed to a component is ` +
				'written out as a marker standing for it, so the change is made to the marker rather ' +
				'than to the value. Compute the value in one expression, or move what changes it out ' +
				'of the render. See spec/derivation.md',
		);
	}
	const eager = [...changed].find(([name]) => bound !== undefined || gone.has(name));
	if (eager !== undefined && refusing === 'refuse') throw new Error(eager[1]);
	// The run answers a neutralised name's reads, but the render still runs the script, and a name
	// neutralised to nothing that the script then calls stops it: `function foo() { b = c }` over a
	// prop, called by `foo()`, and `$: x = xGetter()` over an `xGetter` a neutralised block assigns.
	// What that call computes is the run's to answer, so the render is not given it either. See
	// spec/derivation.md, "The build's render runs only what the run does not answer".
	if (refusing === 'run')
		withheld(
			ast,
			found as Map<string, Declared & { node: Node; free: Set<string> }>,
			reading,
			gone,
			changed,
		);

	return {
		changed,
		has: (name) => found.has(name),
		rune: (name) => found.get(name)?.rune,
		ids: new Set(
			[...found.values()].filter((one) => one.rune === '$props.id').map((one) => one.name),
		),
		rewrite: (node, extra, sent) => slice(node, new Set(), extra, sent),
		// By span rather than by name: one destructuring declares several names and is one place
		// in the source, and writing over it twice would take the file apart.
		// A declaration that reads a prop is handed something harmless, because the render is given
		// no data and evaluating it would reach for what is not there.
		//
		// **Unless it no longer reads one.** A render made for a bound path has that path's value,
		// so `const locale = data.locale.code` expands to a literal and there is nothing left to
		// hold: it is written out as what it is, and the name works for whoever reads it -- markup
		// left for Svelte to evaluate included, which is the half that would otherwise disagree
		// with the expression the walk carried. The same holds one level up: a component the walk
		// entered has each prop bound to the caller's expression, and where that expression varies
		// with nothing the request decides, the declaration is inert with it and the render
		// evaluates it as written -- which is what lets a package's component set the context its
		// children read, from props the caller gave it as constants. What is written back is the
		// **initialiser's** own expansion rather than the name's, because one initialiser stands for
		// every name a destructuring binds and each of those reaches a different part of it. For a
		// declaration that named the value directly the two are the same text.
		reading,
	};
}

/** The names a component's scripts import, the module block's included, type imports left out. */
function importedNames(ast: Node): Set<string> {
	const found = new Set<string>();
	for (const block of [ast['module'], ast['instance']]) {
		const content = isNode(block) ? block['content'] : undefined;
		const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
		for (const statement of body) {
			if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
			if (statement['importKind'] === 'type') continue;
			for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
				const local = isNode(one) ? one['local'] : undefined;
				if (isNode(local) && typeof local['name'] === 'string') found.add(local['name']);
			}
		}
	}
	return found;
}
