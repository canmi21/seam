/**
 * The declarations a script makes, read one at a time: what each holds, whether it reads a prop,
 * which are assigned after being declared and which are lost to a change substitution cannot
 * follow. The pieces `locals()` in locals.ts is composed of. See spec/derivation.md.
 */
import {
	bound as namesBound,
	destructure,
	free,
	emptyFor,
	INIT,
	isNode,
	type Node,
	within,
} from './scope.ts';
import { GIVEN } from './runes.ts';
import { type Declared } from './locals.ts';
import {
	ANSWERED,
	bareWrites,
	calling,
	changing,
	FALLS_THROUGH,
	FUNCTIONS,
	reactiveOf,
	reactives,
	runeCalled,
	runic,
	running,
	SUBSTITUTED,
} from './reactive.ts';

/**
 * What each script declares, in either block, with the initialiser kept as source.
 *
 * Both blocks are read the same way and the difference between them falls out rather than being
 * enforced: a module script has no props to read, so what it declares is constant, and an
 * instance script may read them, so what it declares is a derivation. Neither is evaluated here.
 */
export function declared(
	ast: Node,
	source: string,
	names: ReadonlySet<string>,
	fresh: string | null,
	/**
	 * Names the payload carries, which are declarations here and values there.
	 *
	 * `export let x = 1` is Svelte 4's spelling of a prop, and it reaches this pass as an ordinary
	 * declaration -- so `x` would be substituted by `1`, or by `undefined` where it has no
	 * initialiser, instead of standing for what the request brought. Given for the entry, whose
	 * props are the payload; a child's are bound at its call site and arrive as `bound`.
	 */
	props: ReadonlySet<string> = new Set(),
	/** Whether this is the entry, whose props object is the payload bound under `GIVEN`. */
	entry = false,
): Map<string, Declared> {
	const found = new Map<string, Declared>();

	const record = (name: string, node: Node, extra: Partial<Declared>): void => {
		const { start, end } = node;
		if (typeof start !== 'number' || typeof end !== 'number') return;
		const reading = new Set<string>();
		free(node, new Set(), reading);
		found.set(name, {
			name,
			source: source.slice(start, end),
			at: [start, end],
			node,
			free: reading,
			reads: [...reading].some((one) => names.has(one)),
			reach: INIT,
			slots: [],
			holds: 'null',
			...extra,
		} as Declared & { node: Node; free: Set<string> });
	};

	for (const block of [ast['module'], ast['instance']]) {
		if (!isNode(block)) continue;
		const content = block['content'];
		if (!isNode(content)) continue;
		const body = content['body'];
		if (!Array.isArray(body)) continue;

		for (const statement of body) {
			if (!isNode(statement)) continue;
			const declaration =
				statement['type'] === 'ExportNamedDeclaration' ? statement['declaration'] : statement;
			if (!isNode(declaration)) continue;
			const kind = declaration['type'];

			// A function or a class becomes the expression form of itself, which is what makes
			// `fmt(x)` legal: the name expands to `(function fmt(...) {...})`, and one that calls
			// itself still reaches itself, a named function expression carrying its own name.
			// Declaring either evaluates nothing, so neither is neutralised for the render.
			if (kind === 'FunctionDeclaration' || kind === 'ClassDeclaration') {
				const id = declaration['id'];
				if (isNode(id) && typeof id['name'] === 'string') {
					record(id['name'], declaration, { reads: false });
				}
				continue;
			}

			if (kind !== 'VariableDeclaration') continue;
			const declarations = Array.isArray(declaration['declarations'])
				? declaration['declarations']
				: [];

			for (const one of declarations) {
				if (!isNode(one)) continue;
				const id = one['id'];
				const init = one['init'];
				if (!isNode(id)) continue;
				// A prop, not a declaration: the name stands for what the request brought, and its
				// initialiser is the default, which the artifact applies over the payload's key. By
				// name rather than by statement, since `let a, b; export { a }` declares one of each.
				if (typeof id['name'] === 'string' && props.has(id['name'])) continue;
				// Nothing written for the value. Svelte writes `void 0` there, so the name holds
				// `undefined` while the bytes are written, which is a value like any other rather
				// than a name the markup may not read.
				if (!isNode(init)) {
					if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
						record(id['name'], id, { literal: 'undefined', reads: false });
					}
					continue;
				}
				// A rune is an ordinary declaration whose initialiser is its argument. This used to
				// skip every one of them, on the written grounds that a rune holds client state
				// rather than a value the markup can be given, which Svelte's server transform
				// disproves in a line. See spec/derivation.md.
				if (init['type'] === 'CallExpression') {
					const rune = runeCalled(init['callee']);
					// `let props = $props()` binds the whole object a caller passed rather than
					// destructuring it. `transform-server.js` writes `$$sanitized_props =
					// sanitize_props($$props)` and that is what the call returns, so for the entry it is
					// the payload, bound under `GIVEN` the way a bare `$$props` read already is. A
					// child's is a different object -- what its call site passed -- and stays unrecorded,
					// which reports the name where it is read.
					if (rune === '$props' && entry && id['type'] === 'Identifier') {
						if (typeof id['name'] === 'string') {
							record(id['name'], id, { literal: `(${GIVEN})`, reads: true, holds: '{}' });
						}
						continue;
					}
					// The id Svelte's server writes into a `<!--$id-->` anchor and the client reads back
					// from it. Not a value this pass can substitute: it is decided per instance when the
					// bytes are written, so the name stands for a binding the runtime makes there, and
					// the declaration stays for the render to write the anchor. See spec/derivation.md.
					if (rune === '$props.id') {
						if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
							// Left as the name where no binding is given: the render then evaluates it
							// to the id Svelte's helper counts out, which `anchored()` reads back as a
							// marker wherever it landed -- in a string, in an attribute, in a component's
							// own computation -- and everything computed from it stays inert.
							record(id['name'], id, { literal: fresh ?? id['name'], reads: false, rune });
						}
						continue;
					}
					// The three runes a declaration lets through to the visitor that answers them where
					// they stand. `VariableDeclaration.js` names them and no others:
					//
					//     if (!rune || rune === '$effect.tracking' || rune === '$inspect' ||
					//         rune === '$effect.root') { declarations.push(visit(declarator)); continue }
					//
					// Every other rune in a declaration is its first argument, or `void 0` where it has
					// none -- which is why `const n = $effect.pending()` holds `undefined` there and `0`
					// in an expression. The answer is the same rule read in two places, not one rule.
					if (rune !== null && FALLS_THROUGH.has(rune) && id['type'] === 'Identifier') {
						const answer = ANSWERED[rune];
						if (typeof id['name'] === 'string' && answer != null) {
							record(id['name'], id, { literal: answer, reads: false });
						}
						continue;
					}
					if (rune !== null) {
						const suffix = SUBSTITUTED[rune];
						const argument = Array.isArray(init['arguments']) ? init['arguments'][0] : undefined;
						if (suffix === undefined) continue;
						// A rune called with nothing is the same `void 0`, and reaching into it is not
						// a step to take: there is nothing there to reach through.
						if (!isNode(argument)) {
							if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
								record(id['name'], id, { literal: 'undefined', reads: false });
							}
							continue;
						}
						if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
							record(id['name'], argument, { reach: `${INIT}${suffix}`, rune });
							continue;
						}
						const holds = emptyFor(id);
						for (const { name, reach, slots } of destructure(id)) {
							record(name, argument, {
								reach: within(reach, `(${INIT}${suffix})`),
								slots,
								holds,
								rune,
							});
						}
						continue;
					}
				}
				if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
					record(id['name'], init, {});
					continue;
				}
				// A destructuring is the same substitution with the way in written around it, so
				// `a` out of `{ a }` expands to `(init).a`, a rest to the call that gathers what the
				// pattern did not name, and a default to the choice JavaScript makes -- the last in a
				// slot, since it is an expression in this scope rather than a way into the value.
				const holds = emptyFor(id);
				for (const { name, reach, slots } of destructure(id)) {
					record(name, init, { reach, slots, holds });
				}
			}
		}
	}
	// A `$:` that assigns a name nothing else declares is a declaration. `LabeledStatement.js`
	// collects one and `transform-server.js` puts it at the end of the instance body in topological
	// order, declaring `let x` above for the name it assigns -- so `$: doubled = n * 2` is `doubled`
	// standing for `(n * 2)`, and one reading another chains the way two declarations do, the
	// ordering being what substitution does anyway.
	//
	// **Legacy mode only**, which is the mode `LabeledStatement.js` answers in: in runes mode it
	// calls `context.next()` and the label is an ordinary one.
	//
	// **A `$:` wins over the declaration of the same name, because it runs after it.**
	// `transform-server.js` collects each reactive statement and does `instance.body.push(statement)`
	// in the analysis's topological order, after the rest of the instance body and before the
	// template. So `export let c` beside `$: c = a + b` holds `a + b` when the bytes are written,
	// whatever the request sent, and `let b; $: b = f(x)` holds `f(x)`. Read as an assignment to the
	// declaration it was refused, which is what `assigned()` did to every one of these.
	//
	// Two shapes stay out, and each for a reason rather than for caution:
	//
	// - **Two `$:` assigning one name.** Which of them ran last is the analysis's topological order,
	//   not the source's, and this pass does not build that order.
	// - **A `$:` reading the name it assigns**, where something else declares it.
	//   `legacy_reactive_declarations` unshifts `let max;` only for a binding whose kind is
	//   `legacy_reactive` -- a name nothing else declares -- so `$: max = Math.max(num, max || 0)`
	//   reads `undefined` there and reads the declaration's own value here. Two answers, told apart
	//   by whether the name is declared elsewhere, and only the first is written.
	if (!runic(ast)) {
		const all = reactives(ast['instance']);
		const twice = new Set<string>();
		const once = new Set<string>();
		for (const one of all) {
			if (once.has(one.name)) twice.add(one.name);
			once.add(one.name);
		}
		for (const one of all) {
			const name = one.name;
			if (twice.has(name)) continue;
			// A block's assignment declares nothing: Svelte unshifts a `let` only for a body that is
			// one assignment, so a name only a block assigns has to be declared elsewhere or it is
			// not a name at all.
			if (one.declared === true && !found.has(name) && !props.has(name)) continue;
			const reading = new Set<string>();
			free(one.value, new Set(), reading);
			if (reading.has(name) && (found.has(name) || props.has(name))) continue;
			record(name, one.value, {
				reactive: true,
				reach: one.reach,
				slots: one.slots,
				holds: one.holds,
			});
		}
	}

	// Reading a prop is transitive. `const b = a.x` where `a` reads one would evaluate against
	// nothing in a render given no data, and a null dereference is the crash this is here to
	// prevent, so it is settled to a fixed point rather than one level deep.
	const carrying = found as Map<string, Declared & { free: Set<string> }>;
	for (let changed = true; changed;) {
		changed = false;
		for (const one of carrying.values()) {
			if (one.reads) continue;
			for (const name of one.free) {
				if (carrying.get(name)?.reads === true) {
					one.reads = true;
					changed = true;
					break;
				}
			}
		}
	}
	return found;
}

/**
 * Names the script assigns to after declaring them, which substitution cannot follow.
 *
 * A declared name is replaced by its initialiser wherever the markup reads it, so the initialiser
 * has to be what the name holds when the component renders. An assignment afterwards breaks that,
 * and it broke it silently: `let x = 1; x = 2` rendered `1` where Svelte renders `2`, and so did
 * `const o = { a: 1 }; o.a = 2`. See spec/derivation.md.
 *
 * **Function bodies are not walked here.** A handler that assigns to a name does not run during a
 * render, so `let n = 0; function buy() { n += 1 }` still holds `0` when the bytes are written, and
 * refusing it would refuse the ordinary way an event handler is written. A function the markup
 * *calls* does run, and that is `losing()` below.
 */
export function assigned(
	block: unknown,
	names: ReadonlySet<string>,
	/** Report the store behind a `$x` target rather than the name written. See `locals()`. */
	stores = false,
	/** Names a `$:` declares, whose own statement is not an assignment after a declaration. */
	reactive: ReadonlySet<string> = new Set(),
): Set<string> {
	const found = new Set<string>();

	/** The name an assignment target names, whether it is `x`, `x.a` or `x[0]`. */
	const rootOf = (target: unknown): string | null => {
		let at = target;
		while (isNode(at) && at['type'] === 'MemberExpression') at = at['object'];
		if (!isNode(at) || at['type'] !== 'Identifier') return null;
		const name = typeof at['name'] === 'string' ? at['name'] : null;
		if (!stores || name === null || !name.startsWith('$')) return name;
		return name.slice(1);
	};

	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const one of node) walk(one);
			return;
		}
		if (!isNode(node)) return;
		const type = node['type'];
		if (
			type === 'FunctionDeclaration' ||
			type === 'FunctionExpression' ||
			type === 'ArrowFunctionExpression'
		) {
			return;
		}
		// `$: x = e` where `x` is what that statement declares. Its right-hand side is still walked.
		// A block holding one assignment is that assignment, which is the reading `reactives()`
		// makes of the same shape.
		if (type === 'LabeledStatement' && isNode(node['label']) && node['label']['name'] === '$') {
			const written = reactiveOf(node);
			const held = written?.held ?? null;
			const left = held === null ? null : held['left'];
			// Every name the left binds, not only a plain one: `$: ({ store } = container)` declares
			// `store` the way `$: doubled = n * 2` declares `doubled`, and the statement is that
			// declaration rather than an assignment to one.
			const declares = new Set<string>();
			if (isNode(left)) namesBound(left, declares);
			if (declares.size > 0 && [...declares].every((one) => reactive.has(one))) {
				walk(isNode(held) ? held['right'] : null);
				return;
			}
		}
		if (type === 'AssignmentExpression' || type === 'UpdateExpression') {
			// Every name the target binds, not only its root: `[u, v] = c` and `({ x: a } = c)` assign
			// through a pattern, and each name in one is a target of its own. It used to be the store
			// scan alone, because widening it refused components that were rendering correctly -- and
			// what the rule does with a name is no longer a refusal but leaving it as the author wrote
			// it, which costs nothing where the render evaluates the expression itself.
			const targets: unknown[] = [];
			const spread = (one: unknown): void => {
				if (Array.isArray(one)) {
					for (const each of one) spread(each);
					return;
				}
				if (!isNode(one)) return;
				const held = one['type'];
				if (held === 'Identifier' || held === 'MemberExpression') {
					targets.push(one);
					return;
				}
				for (const value of Object.values(one)) spread(value);
			};
			spread(node[type === 'UpdateExpression' ? 'argument' : 'left']);
			for (const target of targets) {
				const name = rootOf(target);
				if (name !== null && names.has(name)) found.add(name);
			}
		}
		for (const value of Object.values(node)) walk(value);
	};

	if (!isNode(block)) return found;
	const content = block['content'];
	if (isNode(content)) walk(content['body']);
	return found;
}

/**
 * Refuses a declaration whose value is changed by something the render actually runs.
 *
 * `transform-server.js` puts the instance script's statements at the top of the component function
 * and the template after them, so a declaration is evaluated **once** and every reference is that
 * one binding -- a function beside it closes over the same value. Substitution replaces a name by
 * its initialiser at each read, which is the same answer only where evaluating it again is. A
 * change makes it a different answer, and the change is invisible either way:
 *
 * ```svelte
 * const log = [];
 * function next(x) { log.push(x); return x; }
 * {#each rows as row}<p>{next(row)}|{log.length}</p>{/each}
 * ```
 *
 * `log` expands to `([])` at every read, so each read builds its own empty array and the pushes go
 * nowhere. Measured: `1|0`, `2|0` against Svelte's `1|1`, `2|2`. Nothing said so, which is what
 * makes it worse than a refusal.
 *
 * **Both halves have to hold**, which is what keeps this off the ordinary component. A name is
 * lost only where something the render runs changes it *and* the markup reads it. `let n = 0;
 * function buy() { n += 1 }` with `{n}` and `on:click={buy}` is neither: the handler is named and
 * not called, so the render never runs it and `0` is what Svelte writes too.
 *
 * What the render runs is the closure of calls: every name called in the markup, and every name
 * called inside a declaration the markup reads, since reading one writes its initialiser out where
 * the render evaluates it. A function handed to something else that calls it -- `xs.map(fmt)` --
 * is not seen, and is the hole left here.
 */
export function losing(
	ast: Node,
	found: Map<string, Declared & { node: Node; free: Set<string> }>,
	names: Set<string>,
	/** Names a `$:` declares. Its statement is the declaration, not a change to one. */
	declares: ReadonlySet<string>,
): ReadonlyMap<string, string> {
	const fragment = ast['fragment'];
	const closure = (
		seed: Iterable<string>,
		next: (one: Declared & { node: Node; free: Set<string> }) => Iterable<string>,
		avoid?: string,
	): Set<string> => {
		const out = new Set<string>();
		const queue = [...seed];
		while (queue.length > 0) {
			const one = queue.pop() as string;
			if (out.has(one) || one === avoid) continue;
			out.add(one);
			const held = found.get(one);
			if (held !== undefined) queue.push(...next(held));
		}
		return out;
	};

	const mentioned = new Set<string>();
	free(fragment, new Set(), mentioned);
	// Outside a function, which is where the markup writes bytes. A handler is written nowhere on
	// the server -- `onclick={() => queued.shift()?.()}` reaches `queued` and puts nothing of it in
	// the output -- so a name the markup only names inside one is not a name a change can be seen
	// through, and holding it against a change is a refusal nobody could act on.
	const outside = new Set<string>();
	running(fragment, (one) => {
		if (one['type'] === 'Identifier' && typeof one['name'] === 'string') outside.add(one['name']);
	});
	const named = [...mentioned].filter((one) => names.has(one) && outside.has(one));
	// What the markup reads, through the declarations it reaches: reading `a` writes out `a`'s
	// initialiser, so whatever that names is read too.
	const read = closure(named, (one) => one.free);
	// What the render runs: called by the instance script's own statements, which Svelte puts
	// ahead of the template; called in the markup; or called by something the markup writes out.
	// `let promise; ... new_promise()` is the first of those -- a statement assigning through a
	// call rather than directly, which is the rule one level in.
	const instance = isNode(ast['instance']) ? (ast['instance'] as Node)['content'] : undefined;
	// Apart, because the two are not the same to a script run: what the script's statements call
	// runs before the template, where the run's capture sits, and what the markup calls runs while
	// the bytes are written, which no capture sees. See spec/derivation.md, "Where substitution
	// cannot follow, the script runs as Svelte compiled it".
	const scripted = closure(
		calling(isNode(instance) ? instance['body'] : undefined, names, false),
		(one) => calling(one.node, names, true),
	);
	const templated = closure(
		[
			...calling(fragment, names, false),
			...[...read].flatMap((one) => Array.from(calling(found.get(one)?.node, names, false))),
		],
		(one) => calling(one.node, names, true),
	);
	const ran = new Set([...scripted, ...templated]);

	const lost = new Set<string>();
	const lostBefore = new Set<string>();
	// The script's own statements run before the template, so what they change is changed. They are
	// walked here rather than through `ran`, whose names are the declarations: `run(() => count++)`
	// from `svelte/legacy` and `untrack(() => count++)` are calls of an import, and what they were
	// handed is a function this pass sees only where the statement is walked itself.
	{
		const instance = isNode(ast['instance']) ? (ast['instance'] as Node)['content'] : undefined;
		const body = isNode(instance) ? instance['body'] : undefined;
		// The written half only. A method call is the conservative one and at this level it is
		// everywhere -- `array.reduce(...)`, `items.find(...)` -- where inside a function the render
		// calls it is rare enough to be worth the refusal. What that leaves out is a top-level
		// `xs.push(1)`, which the rule above never caught either.
		const { written } = changing(body, names, new Set());
		const read = closure(named, (one) => one.free);
		for (const target of written)
			if (read.has(target) && !declares.has(target)) lostBefore.add(target);
	}
	for (const name of ran) {
		const held = found.get(name);
		if (held === undefined) continue;
		const { written, called } = changing(held.node, names);
		// A method call changes the value it is called on, and a name standing for `undefined` has
		// no value to change: the call throws, or written `?.` does nothing. `let button = $state()`
		// with `button?.click()` is the shape, and `bind:this` is the client's either way.
		const changed = new Set([
			...written,
			...[...called].filter((one) => found.get(one)?.literal !== 'undefined'),
		]);
		if (changed.size === 0) continue;
		// A function the markup calls that changes the script's state is the run's to call, whatever
		// reads what it changed: written out where it is called, its body would make the change to a
		// name no derivation holds. See spec/derivation.md, "What the markup changes while the bytes
		// are written is changed in the run".
		if (templated.has(name) && bareWrites(held.node, names).size > 0) lost.add(name);
		// Read by a route that does not pass through the function doing the changing. One that only
		// goes through it is that function reading back what it just wrote, which is one evaluation
		// and holds: `export function compute() { return value.toUpperCase() }` with `{compute()}`
		// is the whole of `value`'s life.
		const elsewhere = closure(named, (one) => one.free, name);
		for (const target of changed) {
			if (!elsewhere.has(target)) continue;
			if (!templated.has(name)) {
				lostBefore.add(target);
				continue;
			}
			lost.add(target);
			// The function itself, so that an expression this compiler writes out is refused for
			// calling it. `{count}` left as the author wrote it is the render's to evaluate and comes
			// out right; a derivation that calls `default_arg` runs the change once per read, where
			// the render runs it once, and the two disagree about a name neither expression names.
			lost.add(name);
		}
	}
	// And what the markup writes itself, outside any function it only names: `{num++}`, a computed
	// key in a pattern the markup destructures.
	for (const target of bareWrites(fragment, names)) lost.add(target);
	// A declaration whose initialiser calls one of those holds what that call returned when the
	// script ran it; written out at a read, the call would be made again.
	for (const [name, one] of found) {
		if (lost.has(name) || FUNCTIONS.has(String(one.node['type']))) continue;
		if ([...calling(one.node, names, true)].some((each) => lost.has(each))) lost.add(name);
	}
	for (const one of lost) lostBefore.delete(one);
	if (lost.size === 0 && lostBefore.size === 0) return new Map();
	const list = [...lost].map((one) => `\`${one}\``).join(', ');
	const why =
		`${list} ${lost.size > 1 ? 'are' : 'is'} changed by a function this render calls, and the ` +
		'markup reads a name by the expression it was declared to be -- so every read evaluates ' +
		'that expression again and the change is made to a value nothing else holds. Compute the ' +
		'value in one expression, or move what changes it out of the render. See spec/derivation.md';
	const before = [...lostBefore].map((one) => `\`${one}\``).join(', ');
	const whyBefore =
		`${before} ${lostBefore.size > 1 ? 'are' : 'is'} changed by a function the script calls, ` +
		'and the markup reads a name by the expression it was declared to be, which stops being ' +
		'what the name holds. Compute the value in one expression, or move what changes it out of ' +
		'the render. See spec/derivation.md';
	return new Map([
		...[...lost].map((one): [string, string] => [one, why]),
		...[...lostBefore].map((one): [string, string] => [one, whyBefore]),
	]);
}

/**
 * Where the render has to be given nothing in place of a `$:` statement's body.
 *
 * `LabeledStatement.js` collects a `$:` and `transform-server.js` puts it at the end of the
 * instance body in topological order, so it runs once per render and writes no bytes of its own.
 * It is not a declaration, so nothing neutralised it, and a render given no data ran
 * `$: console.log('$:' + todo.id)` against the `null` standing in for the prop and threw inside
 * Svelte's own renderer -- an error naming nothing an author could act on.
 *
 * The whole body goes, not the right-hand side: a name a `$:` assigns is refused where the markup
 * reads it -- `reads \`doubled\`, which the data does not carry` -- so by here nothing is left that
 * wanted its value, and a destructuring `$: ({ a } = o)` would throw on a neutralised right-hand
 * side the way the read did.
 */
/** Every name a statement assigns to by a bare name, however deep, function bodies included. */
export function writes(node: unknown, into: Set<string>): void {
	if (Array.isArray(node)) {
		for (const one of node) writes(one, into);
		return;
	}
	if (!isNode(node)) return;
	const type = node['type'];
	const target =
		type === 'AssignmentExpression'
			? node['left']
			: type === 'UpdateExpression'
				? node['argument']
				: null;
	if (isNode(target) && target['type'] === 'Identifier' && typeof target['name'] === 'string') {
		into.add(target['name']);
	}
	for (const value of Object.values(node)) writes(value, into);
}
