import { parse } from 'svelte/compiler';
import { type Edit, type Neutral, apply } from './edits.ts';
import { chains, destructure, free, isNode, type Node, reads, requested, WRAPS } from './scope.ts';

/**
 * What a component's scripts declare, as source to be substituted into whatever reads it.
 *
 * Substituting rather than evaluating is what makes a module constant and a constant reading props
 * one mechanism rather than two: `LIMIT` becomes `10` and `total` becomes `data.x * 2`, and the
 * second is a derivation for exactly the reason any other expression is. Nothing is run at build
 * time and nothing has to be serialisable. See spec/derivation.md.
 */

/** One name a script declares, and the source of what it was declared to be. */
export interface Declared {
	name: string;
	/** The initialiser, as written. */
	source: string;
	/** Where it sits in the file, so a render can be given something harmless in its place. */
	at: [number, number];
	/** Whether it reads a prop, which decides whether a render with no data can hold it. */
	reads: boolean;
	/** What follows the initialiser to reach this name: `.a` out of an object, `[0]` out of an
	 * array, and nothing at all when the declaration named it directly. */
	access: string;
	/** What a render is handed in its place, which has to be destructurable when it was. */
	holds: 'value' | 'callable' | 'object' | 'array';
	/**
	 * The rune the declaration was written with, where it was: `$state`, `$derived`. Svelte's
	 * analysis reads a component tag naming such a declaration as dynamic and writes anchors
	 * around it, which a tag naming a plain `const` does not get. See `walk.ts`.
	 */
	rune?: string;
	/**
	 * What the name expands to, where that is not a span of the source.
	 *
	 * `let t;` and `let t = $state()` declare a name with nothing written for its value, and
	 * Svelte's server transform answers both the same way: `args.length > 0 ? visit(args[0]) :
	 * b.void0`, so the declaration holds `undefined`. There is no source to slice for that, so it
	 * is carried here instead.
	 */
	literal?: string;
}

/**
 * The rune a call names, as the dotted keypath Svelte itself builds: `$state`, `$derived.by`,
 * `$props.id`. Null when the callee is not one.
 */
function runeOf(callee: unknown): string | null {
	let at = callee;
	let joined = '';
	while (isNode(at) && at['type'] === 'MemberExpression') {
		const property = at['property'];
		if (at['computed'] === true || !isNode(property) || property['type'] !== 'Identifier') {
			return null;
		}
		joined = `.${String(property['name'])}${joined}`;
		at = at['object'];
	}
	if (!isNode(at) || at['type'] !== 'Identifier') return null;
	const name = at['name'];
	return typeof name === 'string' && name.startsWith('$') ? `${name}${joined}` : null;
}

/**
 * What a rune declaration holds when the bytes are written, written as what follows its first
 * argument to reach that value.
 *
 * On the server there is no reactivity, so nothing a rune marks can change after the render, and
 * Svelte's own server transform says the value in a line: the initialiser is the rune's argument.
 * `$derived.by` is given a function rather than a value, so reaching it is a call.
 *
 * A rune that is not here is left unresolved, which the pass that resolves names reports. It is
 * the shorter list on purpose: `$props()` is the payload and is read elsewhere, `$effect` declares
 * nothing and does not run, and `$props.id()` is not a substitution at all -- see `locals`, which
 * gives it a name the runtime binds.
 */
const SUBSTITUTED: Readonly<Record<string, string>> = {
	$state: '',
	'$state.raw': '',
	$derived: '',
	'$derived.by': '()',
};

/**
 * What each script declares, in either block, with the initialiser kept as source.
 *
 * Both blocks are read the same way and the difference between them falls out rather than being
 * enforced: a module script has no props to read, so what it declares is constant, and an
 * instance script may read them, so what it declares is a derivation. Neither is evaluated here.
 */
function declared(
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
			access: '',
			holds: 'value',
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
					record(id['name'], declaration, { holds: 'callable', reads: false });
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
					const rune = runeOf(init['callee']);
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
					if (rune !== null) {
						const reach = SUBSTITUTED[rune];
						const argument = Array.isArray(init['arguments']) ? init['arguments'][0] : undefined;
						if (reach === undefined) continue;
						// A rune called with nothing is the same `void 0`, and reaching into it is not
						// a step to take: there is nothing there to reach through.
						if (!isNode(argument)) {
							if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
								record(id['name'], id, { literal: 'undefined', reads: false });
							}
							continue;
						}
						if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
							record(id['name'], argument, { access: reach, rune });
							continue;
						}
						const holds = id['type'] === 'ArrayPattern' ? 'array' : 'object';
						for (const [name, into] of destructure(id)) {
							record(name, argument, { access: `${reach}${into}`, holds, rune });
						}
						continue;
					}
				}
				if (id['type'] === 'Identifier' && typeof id['name'] === 'string') {
					record(id['name'], init, {});
					continue;
				}
				// A destructuring is the same substitution with the way in written after it, so
				// `a` out of `{ a }` expands to `(init).a`. A default or a rest is neither a
				// member nor an index, and is left out, which reports the name rather than
				// guessing at it.
				const holds = id['type'] === 'ArrayPattern' ? 'array' : 'object';
				for (const [name, access] of destructure(id)) record(name, init, { access, holds });
			}
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

const EMPTY: Record<Declared['holds'], string> = {
	value: 'null',
	callable: 'null',
	object: '{}',
	array: '[]',
};

export interface Locals {
	/** Whether the scripts declare this name. */
	has: (name: string) => boolean;
	/** The rune a declaration was written with, or undefined for a plain one or no declaration. */
	rune: (name: string) => string | undefined;
	/** The names declared with `$props.id()`, which the render evaluates and which hold a string. */
	ids: ReadonlySet<string>;
	/**
	 * An expression's source with every declared name replaced by what it was declared to be.
	 *
	 * `extra` names things a script did not declare, mapped to the source that stands for them. A
	 * snippet's parameter is the case it exists for: its value is the argument at the one
	 * `{@render}` that calls the snippet, which this file cannot see.
	 */
	rewrite: (node: unknown, extra?: ReadonlyMap<string, string>) => string;
	/**
	 * Where a declaration that reads a prop sits, and what to put there instead. A render is
	 * given no data, so holding one is how a component used to crash inside Svelte's own renderer
	 * rather than being refused. A destructuring needs something it can be taken apart from,
	 * which `null` is not.
	 */
	reading: Neutral[];
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
function assigned(block: unknown, names: ReadonlySet<string>): Set<string> {
	const found = new Set<string>();

	/** The name an assignment target names, whether it is `x`, `x.a` or `x[0]`. */
	const rootOf = (target: unknown): string | null => {
		let at = target;
		while (isNode(at) && at['type'] === 'MemberExpression') at = at['object'];
		if (!isNode(at) || at['type'] !== 'Identifier') return null;
		return typeof at['name'] === 'string' ? at['name'] : null;
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
		if (type === 'AssignmentExpression' || type === 'UpdateExpression') {
			const name = rootOf(node[type === 'UpdateExpression' ? 'argument' : 'left']);
			if (name !== null && names.has(name)) found.add(name);
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
function losing(
	ast: Node,
	found: Map<string, Declared & { node: Node; free: Set<string> }>,
	names: Set<string>,
): void {
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
	const ran = closure(
		[
			...calling(isNode(instance) ? instance['body'] : undefined, names, false),
			...calling(fragment, names, false),
			...[...read].flatMap((one) => [...calling(found.get(one)?.node, names, false)]),
		],
		(one) => calling(one.node, names, true),
	);

	const lost = new Set<string>();
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
		for (const target of written) if (read.has(target)) lost.add(target);
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
		// Read by a route that does not pass through the function doing the changing. One that only
		// goes through it is that function reading back what it just wrote, which is one evaluation
		// and holds: `export function compute() { return value.toUpperCase() }` with `{compute()}`
		// is the whole of `value`'s life.
		const elsewhere = closure(named, (one) => one.free, name);
		for (const target of changed) if (elsewhere.has(target)) lost.add(target);
	}
	if (lost.size === 0) return;
	const list = [...lost].map((one) => `\`${one}\``).join(', ');
	throw new Error(
		`${list} ${lost.size > 1 ? 'are' : 'is'} changed by a function this render calls, and the ` +
			'markup reads a name by the expression it was declared to be -- so every read evaluates ' +
			'that expression again and the change is made to a value nothing else holds. Compute the ' +
			'value in one expression, or move what changes it out of the render. See ' +
			'spec/derivation.md',
	);
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
function reactive(
	ast: Node,
	found: Map<string, Declared & { node: Node }>,
	/** What the render is not given: the request's names, and the props of this component -- the
	 * entry's own, and a child's, which its call site bound and the render is handed a literal
	 * for. */
	given: ReadonlySet<string>,
): [at: [number, number], text: string][] {
	const out: [[number, number], string][] = [];
	const instance = ast['instance'];
	if (!isNode(instance)) return out;
	const content = instance['content'];
	if (!isNode(content) || !Array.isArray(content['body'])) return out;
	for (const statement of content['body']) {
		if (!isNode(statement) || statement['type'] !== 'LabeledStatement') continue;
		const label = statement['label'];
		if (!isNode(label) || label['name'] !== '$') continue;
		const body = statement['body'];
		if (!isNode(body)) continue;
		const reads = new Set<string>();
		free(body, new Set(), reads);
		const wanting = [...reads].some((one) => given.has(one) || found.get(one)?.reads === true);
		if (!wanting) continue;
		const { start, end } = body;
		if (typeof start === 'number' && typeof end === 'number') out.push([[start, end], 'undefined']);
	}
	return out;
}

/**
 * The two calls known to run what they are handed while the bytes are written, by name.
 *
 * `run` is `svelte/legacy`'s, which a migrated `$:` compiles to, and `legacy-server.js` is one
 * line: `fn()`. `untrack` is the same function -- `index-server.js` exports `run as untrack` --
 * so Svelte's own answer for both is a synchronous call.
 *
 * A list rather than a rule, because there is no rule: `onMount`, `beforeUpdate` and `$effect`
 * take a function the server never calls, `sleep(10).then(fn)` calls it later, and nothing in the
 * shape of a call says which. Anything not here is left alone, and that is the hole.
 */
const CALLS = new Set(['run', 'untrack']);

/** The three shapes a function is written in, whose body does not run where it is written. */
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * Walks the part of a node the render runs, which is not all of it.
 *
 * A function written inside an expression does not run where it is written: `on:change={() =>
 * handler(bar)}` names a call and makes none, and `factory` returning `{ onclick: () => { v = 1 } }`
 * assigns nothing while the bytes are written. So the walk stops at every function it meets --
 * except the one it was given, whose body is the thing being asked about, and one written as the
 * argument of a call, which that call runs.
 */
function running(node: unknown, at: (one: Node) => void): void {
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (FUNCTIONS.has(String(one['type']))) return;
		at(one);
		// A function written as an argument of a call is run by that call. `run(() => count++)` from
		// `svelte/legacy` is a `$:` migrated, and `untrack(() => count++)` is Svelte's own; both call
		// what they are handed while the bytes are written. Conservative: `xs.map((x) => x.y)` is
		// walked too and changes nothing, so it costs nothing to be in.
		if (one['type'] === 'CallExpression' || one['type'] === 'NewExpression') {
			// A plain name only. `sleep(10).then(() => { count += 1 })` hands its function to a
			// method, and `then` does not run it while the bytes are written -- nor do `setTimeout`,
			// `addEventListener` or any of the others reached through a member. What a member call
			// does with a function is the member's, and this pass does not know it.
			const callee = one['callee'];
			if (isNode(callee) && callee['type'] === 'Identifier' && CALLS.has(String(callee['name']))) {
				for (const argument of Array.isArray(one['arguments']) ? one['arguments'] : []) {
					if (!isNode(argument) || !FUNCTIONS.has(String(argument['type']))) continue;
					step(argument['params']);
					step(argument['body']);
				}
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	if (isNode(node) && FUNCTIONS.has(String(node['type']))) {
		step(node['params']);
		step(node['body']);
		return;
	}
	step(node);
}

/**
 * The declared names a node calls, each written where the render would run it.
 *
 * A callee only: `on:click={buy}` names the function and does not run it, which is the ordinary
 * way a handler is written, while `{buy()}` runs it where the bytes are written. A method call is
 * not one of these -- `a.b()` runs `b`, which is not a name this file declares.
 *
 * `run` says which question is being asked of the node: whether the render runs its body, which is
 * true of a function something calls and false of one something merely reads.
 */
function calling(node: unknown, names: ReadonlySet<string>, run: boolean): Set<string> {
	const found = new Set<string>();
	// Reading a name writes its initialiser out; where that is a function, writing it out runs
	// nothing. `onclick={go}` and `const go = () => f()` both name `f` and neither calls it.
	if (!run && isNode(node) && FUNCTIONS.has(String(node['type']))) return found;
	running(node, (one) => {
		if (one['type'] !== 'CallExpression' && one['type'] !== 'NewExpression') return;
		const callee = one['callee'];
		if (!isNode(callee) || callee['type'] !== 'Identifier') return;
		if (typeof callee['name'] === 'string' && names.has(callee['name'])) found.add(callee['name']);
	});
	return found;
}

/** Every name a function body declares for itself, which shadows the script's. */
function shadows(node: unknown): Set<string> {
	const found = new Set<string>();
	const take = (target: unknown): void => {
		if (Array.isArray(target)) {
			for (const one of target) take(one);
			return;
		}
		if (!isNode(target)) return;
		if (target['type'] === 'Identifier' && typeof target['name'] === 'string') {
			found.add(target['name']);
			return;
		}
		for (const value of Object.values(target)) take(value);
	};
	const walk = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) walk(each);
			return;
		}
		if (!isNode(one)) return;
		const type = one['type'];
		if (type === 'VariableDeclarator') take(one['id']);
		if (type === 'FunctionDeclaration' || type === 'ClassDeclaration') take(one['id']);
		if (
			type === 'FunctionDeclaration' ||
			type === 'FunctionExpression' ||
			type === 'ArrowFunctionExpression'
		) {
			take(one['params']);
		}
		for (const value of Object.values(one)) walk(value);
	};
	walk(node);
	return found;
}

/**
 * The declared names a body may change the value of, rather than read.
 *
 * Three shapes, in two kinds. An assignment and an update say what the new value is. A method call
 * does not -- `log.push(x)` is not an assignment and changes the array all the same -- so a callee
 * reaching a declared name through a member is counted too, and counted apart, because it is the
 * conservative half: `xs.map(f)` changes nothing and is in it. Names the body declares for itself
 * are skipped, since those shadow and are not the script's.
 */
function changing(
	node: unknown,
	names: ReadonlySet<string>,
	/** What the node declares for itself, which shadows the script's. Empty for the script's own
	 * statements, whose declarations are the ones being asked about. */
	mine: ReadonlySet<string> = shadows(node),
): { written: Set<string>; called: Set<string> } {
	const written = new Set<string>();
	const called = new Set<string>();
	const rootOf = (target: unknown): string | null => {
		let at = target;
		while (isNode(at) && at['type'] === 'MemberExpression') at = at['object'];
		if (!isNode(at) || at['type'] !== 'Identifier') return null;
		return typeof at['name'] === 'string' ? at['name'] : null;
	};
	const hit = (into: Set<string>, target: unknown): void => {
		const name = rootOf(target);
		if (name !== null && names.has(name) && !mine.has(name)) into.add(name);
	};
	running(node, (one) => {
		const type = one['type'];
		if (type === 'AssignmentExpression') hit(written, one['left']);
		if (type === 'UpdateExpression') hit(written, one['argument']);
		if (type === 'CallExpression') {
			const callee = one['callee'];
			if (isNode(callee) && callee['type'] === 'MemberExpression') hit(called, callee['object']);
		}
	});
	return { written, called };
}

/**
 * One expression, parsed as the component it would be the whole of.
 *
 * The empty script is what makes TypeScript readable. An expression in the markup of a
 * `lang="ts"` component may carry an annotation or an `as`, and Svelte chooses its parser from the
 * script tag rather than from the expression -- so without one, `(q: { s: string }) => q.s` is a
 * syntax error. That was not a parse failure anyone saw: `mentions` reads a failure as "assume it
 * reaches the payload", which is the safe answer and the wrong one here, and a value that was the
 * same every request got a marker planted in it and was handed to a package as a string.
 */
export function parsed(expression: string): Node {
	if (process.env['SEAM_NO_MEMO'] !== undefined) {
		return parse(`<script lang="ts"></script>{${expression}}`, { modern: true }) as unknown as Node;
	}
	const held = trees.get(expression);
	if (held !== undefined) {
		if (held instanceof Error) throw held;
		return held;
	}
	try {
		const tree = parse(`<script lang="ts"></script>{${expression}}`, {
			modern: true,
		}) as unknown as Node;
		trees.set(expression, tree);
		return tree;
	} catch (error) {
		// The failure is cached too, because the callers all catch one and an expression that does
		// not parse is asked about as often as one that does.
		trees.set(expression, error as Error);
		throw error;
	}
}

/**
 * Every expression this process has parsed, by its source.
 *
 * Parsing is where a compile spent its time: measured on one real application, the walk was 88% of
 * a 425-second compile, and a walk asks these questions of every expression it meets -- what it
 * reads, whether it mentions the payload, what path it is. The walk runs once per render and a
 * route renders hundreds of times, so one expression was parsed hundreds of times into the same
 * tree. Svelte's parser builds a whole component AST for each one, since an expression is read as
 * the component it would be the whole of.
 *
 * The tree is handed out shared, which is sound because every caller here only reads it -- none
 * writes to a node. The map is bounded by the number of distinct expressions a compile produces,
 * not by the number of walks, which is the whole point. See spec/build.md.
 */
const trees = new Map<string, Node | Error>();

/**
 * A whole component, parsed, by its source.
 *
 * **Not memoised, and that is the measurement rather than an omission.** Remembering these was
 * tried, on the reading that a walk parses the entry and everything it enters once per render and
 * so parses a route's hundred components fifty thousand times. It bought twelve seconds of a
 * two-hundred-and-thirty-second walk -- five per cent -- and held three hundred and eighty-one
 * whole-component trees, which measured as the larger part of three gigabytes of live heap. A
 * compile that cannot run in CI is worse than one that takes five per cent longer, so the trade is
 * refused here and taken one level down, where an expression's tree is small and the saving is
 * forty per cent. See spec/build.md.
 */
export function parsedComponent(source: string): Node {
	return parse(source, { modern: true }) as unknown as Node;
}

/**
 * A lookup in an object literal, `({ a: A, b: B })[key]`, written as the choice it is:
 * `(key) === "a" ? (A) : (key) === "b" ? (B) : undefined`.
 *
 * The keys of a literal are in the source, so a component chosen through such a table is chosen
 * from a domain the compiler can read, and the chain is a structural ternary like any other: each
 * test varies with the request and each branch names a component, so `settle` enumerates it as
 * the tree it is, and a key the table lacks is the `undefined` that `<svelte:component>` writes
 * nothing for. Null where the expression is not that shape, or where a key is not a name or a
 * string -- a number compares to a string key as the author's lookup would not.
 */
/**
 * The entries of an object literal, as the source of each key and value, or null where the
 * expression is not one written out in full: a spread inside it, a computed key, a getter.
 *
 * What a `{...props}` on a component call site spreads is a set of keys, and a call site knows
 * them exactly when the object is written out -- which is what a rest gathered from a caller's
 * attributes expands to. Then the spread is so many props, and the walk can enter the child.
 */
export function objectEntries(expression: string): [key: string, value: string][] | null {
	const wrapped = `<script lang="ts"></script>{${expression}}`;
	let ast: Node;
	try {
		ast = parse(wrapped, { modern: true }) as unknown as Node;
	} catch {
		return null;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const tag = nodes.find((one) => isNode(one) && one['type'] === 'ExpressionTag');
	const node = isNode(tag) ? tag['expression'] : undefined;
	if (!isNode(node) || node['type'] !== 'ObjectExpression') return null;
	const found: [string, string][] = [];
	for (const one of Array.isArray(node['properties']) ? node['properties'] : []) {
		if (!isNode(one) || one['type'] !== 'Property' || one['computed'] === true) return null;
		if (one['kind'] !== 'init') return null;
		const key = one['key'];
		const value = one['value'];
		if (!isNode(key) || !isNode(value)) return null;
		let name: string;
		if (key['type'] === 'Identifier' && typeof key['name'] === 'string') name = key['name'];
		else if (key['type'] === 'Literal' && typeof key['value'] === 'string') name = key['value'];
		else return null;
		const { start, end } = value;
		if (typeof start !== 'number' || typeof end !== 'number') return null;
		found.push([name, wrapped.slice(start, end)]);
	}
	return found;
}

/**
 * An expression with the TypeScript written around it taken off.
 *
 * `{ a: Ay } as const` is a `TSAsExpression` holding the object, and `k as keyof typeof T` is one
 * holding the name. Neither changes what the expression is at runtime, and reading the wrapper as
 * the thing made a table that press writes `as const` look like no table at all -- so the domain
 * its keys hold went unseen and the choice was refused as one nobody could enumerate.
 */
function bare(node: unknown): Node | null {
	let found = node;
	while (isNode(found) && typeof found['type'] === 'string' && WRAPS.has(found['type'])) {
		found = found['expression'];
	}
	return isNode(found) ? found : null;
}

/**
 * Where a node sits in the expression it was parsed from, with the wrapper's offset taken off.
 */
function spanOf(node: Node): [number, number] | null {
	const { start, end } = node;
	return typeof start === 'number' && typeof end === 'number'
		? [start - WRAPPED, end - WRAPPED]
		: null;
}

/**
 * What an expression reads off whatever it is read from, and the thing underneath.
 *
 * `short` is whether the first access away from that thing short-circuits, which decides the value
 * where there is nothing to read from: `a?.b.c` is undefined where `a` is, and `a.b?.c` throws.
 *
 * The accesses are rebuilt from the tree rather than sliced out of the source, because the source
 * may put what they are read from in parentheses of its own -- `(T[k])?.icon` -- and a slice taken
 * from where that ends would carry the closing one with it.
 */
function peel(whole: Node): { node: Node; read: string; short: boolean } {
	let node: Node = whole;
	const reads: { name: string; optional: boolean }[] = [];
	for (;;) {
		if (node['type'] !== 'MemberExpression' || node['computed'] === true) break;
		const named = node['property'];
		const inner = bare(node['object']);
		if (!isNode(named) || named['type'] !== 'Identifier' || typeof named['name'] !== 'string')
			break;
		if (inner === null) break;
		reads.unshift({ name: named['name'], optional: node['optional'] === true });
		node = inner;
	}
	const read = reads.map((one) => `${one.optional ? '?.' : '.'}${one.name}`).join('');
	return { node, read, short: reads[0]?.optional === true };
}

/**
 * A `?:` with what is read off it pushed into both branches, or null where that is not what it is.
 *
 * **A read off a choice is part of the choice.** `(summary ? T[summary.provider] : undefined)?.icon`
 * picks a component, and until the read is inside the branches the expression is a member access
 * over a ternary rather than a ternary -- so `settle` looks at a value where a choice is written
 * and nothing asks the render which branch is taken. Distributing it is exact: the test is
 * evaluated once either way, and each branch keeps whatever the read would have done to it.
 */
function distributed(whole: Node, source: string): string | null {
	const { node, read } = peel(whole);
	if (read === '' || node['type'] !== 'ConditionalExpression') return null;
	const slice = (part: unknown): string | null => {
		if (!isNode(part)) return null;
		const at = spanOf(part);
		return at === null ? null : source.slice(at[0], at[1]);
	};
	const test = slice(node['test']);
	const yes = slice(node['consequent']);
	const no = slice(node['alternate']);
	if (test === null || yes === null || no === null) return null;
	return `((${test}) ? (${yes})${read} : (${no})${read})`;
}

/**
 * A lookup in a table of components, as the chain of `?:` it is, or null where it is not one.
 *
 * `T[k]` with `T` an object literal chooses among the table's own keys, so its domain is in the
 * source and the choice is enumerable: it is written out as `k === "a" ? (Ay) : k === "b" ? (Bee)
 * : undefined`, and settled the way any structural ternary is.
 *
 * **What is read off the entry is part of the lookup.** `T[k].icon` and `T[k]?.icon` pick a
 * component out of an entry holding more than one thing, which is what a table of icons beside
 * their names is; the access goes into each arm and the domain is still the table's keys.
 *
 * The arm for a key the table lacks keeps whatever the access would have done to `undefined`: an
 * optional one short-circuits and is `undefined`, and a plain one throws, which is what the
 * expression as written does and is not this function's to soften.
 */
function tabled(whole: Node, source: string): string | null {
	const { node, read, short } = peel(whole);
	if (node['type'] !== 'MemberExpression' || node['computed'] !== true) return null;
	const object = bare(node['object']);
	const property = bare(node['property']);
	if (object === null || object['type'] !== 'ObjectExpression' || property === null) return null;
	const slice = (part: Node): string | null => {
		const at = spanOf(part);
		return at === null ? null : source.slice(at[0], at[1]);
	};
	const key = slice(property);
	if (key === null) return null;
	const arms: string[] = [];
	for (const one of Array.isArray(object['properties']) ? object['properties'] : []) {
		if (!isNode(one) || one['type'] !== 'Property' || one['computed'] === true) return null;
		if (one['kind'] !== 'init') return null;
		const name = one['key'];
		const value = one['value'];
		if (!isNode(name) || !isNode(value)) return null;
		let text: string;
		if (name['type'] === 'Identifier' && typeof name['name'] === 'string') text = name['name'];
		else if (name['type'] === 'Literal' && typeof name['value'] === 'string') text = name['value'];
		else return null;
		const chosen = slice(value);
		if (chosen === null) return null;
		arms.push(`(${key}) === ${JSON.stringify(text)} ? (${chosen})${read}`);
	}
	if (arms.length === 0) return null;
	const missing = read === '' || short ? 'undefined' : `(undefined)${read}`;
	return `(${arms.join(' : ')} : ${missing})`;
}

/** What is being called, where a rewrite of it would take the call away from its receiver. */
const CALLED: Readonly<Record<string, string>> = {
	CallExpression: 'callee',
	NewExpression: 'callee',
	TaggedTemplateExpression: 'tag',
};

/**
 * The first choice written anywhere in an expression, as where it sits and what it becomes.
 *
 * **Anywhere, not at the top.** A guard is written `{#if Icon && provider}`, and the choice is
 * inside one side of the `&&`; read only at the top, the expression is a logical operator and
 * nothing looks further. Outermost first, so the rewrite is the largest one available there.
 *
 * **Never what is being called.** Both rewrites move a read off the thing it is read from, and a
 * read that is then called is a method: `(a ?? []).slice(5)` and `(a === undefined ? [].slice :
 * a.slice)(5)` are not the same call, because the second has lost what it was called on. So the
 * callee itself is passed over, and what is inside it is not -- a choice deeper in stays attached
 * to whatever it becomes. press's article found this, its footnotes calling `slice` on a default.
 */
function choiceIn(text: string): { at: [number, number]; text: string } | null {
	let ast: Node;
	try {
		ast = parsed(text);
	} catch {
		return null;
	}
	let found: { at: [number, number]; text: string } | null = null;
	const visit = (node: unknown, called: boolean): void => {
		if (found !== null) return;
		if (Array.isArray(node)) {
			for (const one of node) visit(one, false);
			return;
		}
		if (!isNode(node)) return;
		// A chain and what it holds cover the same characters, so either span replaces both.
		const whole = bare(node['type'] === 'ChainExpression' ? node['expression'] : node);
		const at = spanOf(node);
		if (!called && whole !== null && at !== null) {
			const rewritten = tabled(whole, text) ?? distributed(whole, text);
			if (rewritten !== null) {
				found = { at, text: rewritten };
				return;
			}
		}
		const receiver = typeof node['type'] === 'string' ? CALLED[node['type']] : undefined;
		for (const [name, one] of Object.entries(node)) visit(one, name === receiver);
	};
	visit(ast['fragment'], false);
	return found;
}

/**
 * How many rewrites one expression is given before it is left as written, which is a bound on a
 * loop rather than a limit anybody should meet: press's article takes four.
 */
const DEEP = 32;

/**
 * The expression written as the choices it holds, or null where it holds none.
 *
 * Two rewrites, applied to the innermost thing each fits until neither fits anywhere. A table
 * lookup becomes the chain of `?:` its keys make; a read off a `?:` goes inside both branches, and
 * what that leaves is a rewrite again.
 *
 * **Neither is enough alone, and the order falls out of repeating them.** press's article writes
 * `(summary ? T[summary.provider] : undefined)?.icon`. Expand the table first and there is no table
 * to see, because the top of the expression is a member access. Push the read in first and the
 * branch still reads the request, so `chooses` finds nothing it can enumerate. Repeated, the branch
 * the render takes is a lookup and the lookup's keys are the domain -- which was in the source the
 * whole time.
 */
export function unfolded(expression: string): string | null {
	let text = expression;
	let changed = false;
	for (let round = 0; round < DEEP; round += 1) {
		const found = choiceIn(text);
		if (found === null) break;
		text = apply(text, [[found.at[0], found.at[1], found.text]]);
		changed = true;
	}
	return changed ? text : null;
}

/**
 * Whether an expression reads any of these names, free of anything that binds them inside it.
 *
 * Asked of an expression that has already been expanded, to decide whether a marker belongs where
 * it stands. A marker stands where request-varying data goes; an expression that reaches none of
 * the payload's names is the same every request, and the render writes it as bytes.
 */
export function mentions(expression: string, names: ReadonlySet<string>): boolean {
	if (names.size === 0) return false;
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		// Unreadable here is not a reason to write it out as bytes: keep the marker, and let the
		// pass that reads names report whatever is wrong with it.
		return true;
	}
	let found = false;
	const walk = (node: unknown): void => {
		if (found) return;
		if (Array.isArray(node)) {
			for (const one of node) walk(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'ExpressionTag') {
			reads(node['expression'], new Set(), (at) => {
				if (typeof at['name'] === 'string' && names.has(at['name'])) found = true;
			});
			return;
		}
		for (const one of Object.values(node)) walk(one);
	};
	walk(ast['fragment']);
	return found;
}

/**
 * The dotted name an expression spells, or null where it spells none.
 *
 * `data.locale.code` and `((data)).locale.code` are the same path: the parser keeps no
 * parentheses, so substitution's own wrapping falls away without anything having to strip it. A
 * call, an index or anything computed is not a path and gets null.
 */
export function pathOf(expression: string): string | null {
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return null;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return null;

	const names: string[] = [];
	let at: unknown = only['expression'];
	while (isNode(at) && at['type'] === 'MemberExpression') {
		const property = at['property'];
		if (at['computed'] === true || !isNode(property) || typeof property['name'] !== 'string') {
			return null;
		}
		names.unshift(property['name']);
		at = at['object'];
	}
	if (!isNode(at) || at['type'] !== 'Identifier' || typeof at['name'] !== 'string') return null;
	names.unshift(at['name']);
	return names.join('.');
}

/**
 * The value an expression is, as JSON, where it is a literal and nothing else.
 *
 * Substitution parenthesises what it writes, so a prop handed a fixed path arrives as `("en")` and
 * comparing the text against the literal it came from finds nothing. The parser keeps no
 * parentheses, so asking the AST is asking the question that was meant.
 */
export function literalOf(expression: string): string | undefined {
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return undefined;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return undefined;
	const inner = only['expression'];
	if (!isNode(inner) || inner['type'] !== 'Literal') return undefined;
	const value = inner['value'];
	if (typeof value === 'object' && value !== null) return undefined;
	return JSON.stringify(value ?? null);
}

/** What `parsed` wraps an expression in, so a position in its AST maps back to the expression. */
const WRAPPED = '<script lang="ts"></script>{'.length;

/**
 * Every `?:` a marker cannot stand for, written as the branch it was decided for, outermost first.
 *
 * Asked of a value handed to code the compiler cannot read. A marker stands where a value is
 * written into bytes; the branches of a ternary handed over may instead be things the component
 * *uses* -- the one that made this necessary chose between two message functions, and a string
 * where a function was expected stopped the render inside the package. Such a ternary chooses
 * what is handed, which is a decision with two outcomes, and it is compiled the way every other
 * decision is: the build renders once per branch and keeps both, and in each render the ternary
 * is written as its branch. See spec/refusals.md.
 *
 * **Which ternaries, and it is narrower than all of them.** A branch the request decides has to
 * be a marker whatever it is, and a literal is a value that can only be written, so a ternary
 * between those is a value like any other and the marker stands for the whole of it -- `tone ===
 * 'dark' ? 'text-black' : 'text-white'` on a package's icon is that, and it is written per item
 * inside an each, which enumeration could not have done. What forces a branch is a value the
 * request does not decide that is not a literal: a name, a member, a call, a function, an object
 * -- the same things `inert` leaves for Svelte to evaluate, met one level in. A ternary in a
 * branch is asked the same question, so a choice between two choices is enumerated as a tree.
 *
 * `decided` is keyed by the test's own source text, which is stable because the expression has
 * already been expanded: a name declared in a script is gone and a fixed path is its literal. The
 * first ternary nobody has decided comes back as `undecided`, and the caller asks the build for
 * both renders. Outermost first and one at a time, so a ternary inside the branch that is not
 * taken is never asked about, and nesting costs a tree of renders rather than a product.
 *
 * A ternary inside a function is left alone. It runs per call, inside the component, and decides
 * nothing about which bytes the page has.
 */
export function settle(
	expression: string,
	decided: ReadonlyMap<string, boolean>,
	/** The names the request decides, in the scope the expression was written in. */
	dynamic: ReadonlySet<string>,
	/**
	 * Names that hold a string the render writes rather than something a marker cannot stand for:
	 * an id from `$props.id()`, evaluated by the render and read back as a marker. A branch that is
	 * one of these is a value, not a choice of structure.
	 */
	plain: ReadonlySet<string> = new Set(),
): { text: string; undecided: string | null } {
	let text = expression;
	for (;;) {
		let ast: Node;
		try {
			ast = parsed(text);
		} catch {
			return { text, undecided: null };
		}
		const found = conditional(ast['fragment'], dynamic, plain);
		if (found === null) return { text, undecided: null };
		const [whole, test, consequent, alternate] = found;
		const at = (range: [number, number]): string =>
			text.slice(range[0] - WRAPPED, range[1] - WRAPPED);
		const taken = decided.get(at(test));
		if (taken === undefined) return { text, undecided: at(test) };
		text = apply(text, [
			[whole[0] - WRAPPED, whole[1] - WRAPPED, `(${at(taken ? consequent : alternate)})`],
		]);
	}
}

type Spans = [[number, number], [number, number], [number, number], [number, number]];

/**
 * The first `?:` met in document order that a marker cannot stand for, as four spans. One a
 * marker can stand for is a value, and nothing inside it is looked at: the whole of it is written.
 */
function conditional(
	node: unknown,
	dynamic: ReadonlySet<string>,
	plain: ReadonlySet<string>,
): Spans | null {
	if (Array.isArray(node)) {
		for (const one of node) {
			const found = conditional(one, dynamic, plain);
			if (found !== null) return found;
		}
		return null;
	}
	if (!isNode(node)) return null;
	const type = node['type'];
	if (type === 'ArrowFunctionExpression' || type === 'FunctionExpression') return null;
	if (type === 'ConditionalExpression' && chooses(node, dynamic, plain)) {
		// A test the request does not decide is a value the render can evaluate, so the whole
		// ternary is left to Svelte the way any inert expression is, and only what is inside its
		// branches is looked at. Enumerating it cost a structure per constant choice -- press's
		// switcher had one on every route -- and the second structure was the first again.
		if (varies(node['test'], dynamic)) {
			const spans = [node, node['test'], node['consequent'], node['alternate']].map(where);
			const [whole, test, consequent, alternate] = spans;
			if (whole && test && consequent && alternate) return [whole, test, consequent, alternate];
			return null;
		}
	}
	for (const value of Object.values(node)) {
		const found = conditional(value, dynamic, plain);
		if (found !== null) return found;
	}
	return null;
}

/** Whether a ternary has a branch a marker cannot stand for, looking through nested ones. */
function chooses(node: Node, dynamic: ReadonlySet<string>, plain: ReadonlySet<string>): boolean {
	return [node['consequent'], node['alternate']].some((branch) => {
		if (!isNode(branch)) return false;
		if (branch['type'] === 'ConditionalExpression') return chooses(branch, dynamic, plain);
		if (isLiteral(branch)) return false;
		// A branch that names nothing and holds no function is a value like a literal:
		// `(undefined).entries`, which is what state with no value expands to, chooses no
		// component. What a marker cannot stand for names something -- a component, a function --
		// or is one, and reads nothing the request decides.
		let structural = false;
		reads(branch, new Set(), (at) => {
			const name = at['name'];
			if (name !== 'undefined' && !(typeof name === 'string' && plain.has(name))) structural = true;
		});
		const functions = (part: unknown): void => {
			if (structural) return;
			if (Array.isArray(part)) {
				for (const one of part) functions(one);
				return;
			}
			if (!isNode(part)) return;
			if (part['type'] === 'ArrowFunctionExpression' || part['type'] === 'FunctionExpression') {
				structural = true;
				return;
			}
			for (const one of Object.values(part)) functions(one);
		};
		functions(branch);
		return structural && !varies(branch, dynamic);
	});
}

/** Whether an expression reads a name the request decides. */
function varies(node: unknown, dynamic: ReadonlySet<string>): boolean {
	let found = false;
	reads(node, new Set(), (at) => {
		if (typeof at['name'] === 'string' && dynamic.has(at['name'])) found = true;
	});
	return found;
}

/**
 * A value that can only be written: a literal, a template, a sign in front of a number, or
 * `undefined`, which the parser keeps as a name rather than a literal and which is one anyway.
 */
function isLiteral(node: Node): boolean {
	const type = node['type'];
	if (type === 'Literal' || type === 'TemplateLiteral') return true;
	if (type === 'Identifier' && node['name'] === 'undefined') return true;
	if (type === 'UnaryExpression' && (node['operator'] === '-' || node['operator'] === '+')) {
		return isNode(node['argument']) && node['argument']['type'] === 'Literal';
	}
	return false;
}

function where(node: unknown): [number, number] | null {
	if (!isNode(node)) return null;
	const { start, end } = node;
	return typeof start === 'number' && typeof end === 'number' ? [start, end] : null;
}

/**
 * Whether every read of one of `names` in the expression sits inside the arguments of a call
 * whose callee is rooted at one of `callees`, arrow functions among the arguments included.
 *
 * What it is for: a runes module -- `reads.svelte.ts`, compiled by Svelte and legal nowhere
 * else -- called with a value the request decides, `createReadsQuery(() => data.slug)`. The
 * expression mentions the payload, and what it evaluates to on the server is decided inside a
 * render by the library and nowhere else, so the runtime cannot hold it as a derivation and the
 * render is the only place it can be asked. Every other read of the request stays a hole.
 */
export function onlyWithin(
	expression: string,
	names: ReadonlySet<string>,
	callees: ReadonlySet<string>,
): boolean {
	if (names.size === 0 || callees.size === 0) return false;
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return false;
	}
	let outside = false;
	let called = false;
	const rootOf = (node: unknown): string | null => {
		let at = node;
		while (isNode(at) && (at['type'] === 'MemberExpression' || at['type'] === 'ChainExpression')) {
			at = at['type'] === 'ChainExpression' ? at['expression'] : at['object'];
		}
		return isNode(at) && at['type'] === 'Identifier' && typeof at['name'] === 'string'
			? at['name']
			: null;
	};
	const walk = (node: unknown, inside: boolean): void => {
		if (outside) return;
		if (Array.isArray(node)) {
			for (const one of node) walk(one, inside);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'CallExpression') {
			const root = rootOf(node['callee']);
			const shielding = root !== null && callees.has(root);
			if (shielding) called = true;
			walk(node['callee'], inside);
			walk(node['arguments'], inside || shielding);
			return;
		}
		if (node['type'] === 'Identifier') {
			if (!inside && typeof node['name'] === 'string' && names.has(node['name'])) outside = true;
			return;
		}
		if (node['type'] === 'MemberExpression') {
			walk(node['object'], inside);
			if (node['computed'] === true) walk(node['property'], inside);
			return;
		}
		if (node['type'] === 'Property') {
			if (node['computed'] === true) walk(node['key'], inside);
			walk(node['value'], inside);
			return;
		}
		for (const one of Object.values(node)) walk(one, inside);
	};
	walk(ast['fragment'], false);
	return called && !outside;
}

/**
 * Whether an expression is a literal and nothing else, once substitution has had its way with it.
 *
 * `<Badge tone="x" />` becomes `("x")` where the child writes `{tone}`, and a marker planted there
 * is a hole whose value nothing decides. Svelte renders a literal into the bytes and escapes it
 * the way it escapes everything else, so leaving it to do that is fewer moving parts than carrying
 * the value through the protocol and putting it back -- and it is what the other lowering path
 * already did, which is where the two came apart.
 *
 * Deliberately only a literal. An expression that merely reaches no payload name is not the same
 * thing: it may read something ambient, and a compile-time render would bake in whatever that was.
 */
export function constant(expression: string): boolean {
	let ast: Node;
	try {
		ast = parsed(expression);
	} catch {
		return false;
	}
	const fragment = ast['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [only] = nodes;
	if (nodes.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') return false;
	const inner = only['expression'];
	if (!isNode(inner)) return false;
	// A negative number is a unary operator over one, which the parser keeps as two nodes.
	const value =
		inner['type'] === 'UnaryExpression' && (inner['operator'] === '-' || inner['operator'] === '+')
			? inner['argument']
			: inner;
	return isNode(value) && value['type'] === 'Literal';
}

/**
 * Every name the two scripts declare, with what each stands for and where each was written.
 *
 * `fixed` names payload paths whose value this render is being made for -- a locale, a role, any
 * field whose domain the build declared and which the compiler is enumerating over. A path in it
 * is not a hole: it is a literal in this render, in the expressions the markup carries and in the
 * script that computed it, so both say the same thing. See spec/pipeline.md.
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
): Locals {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const carried = requested(ast['instance']);
	const found = declared(ast, source, carried, fresh, props) as Map<
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
	const moved = [...assigned(ast['module'], names), ...assigned(ast['instance'], names)];
	if (moved.length > 0) {
		const list = [...new Set(moved)].map((one) => `\`${one}\``).join(', ');
		throw new Error(
			`${list} ${moved.length > 1 ? 'are' : 'is'} assigned after being declared, and the markup ` +
				'reads a name by the expression it was declared to be, which stops being what the name ' +
				'holds. Compute the value in one expression, or move the assignment into a function, ' +
				'which does not run while the bytes are written. See spec/derivation.md',
		);
	}
	losing(ast, found as Map<string, Declared & { node: Node; free: Set<string> }>, names);

	const expanded = new Map<string, string>();

	function slice(
		node: unknown,
		open: ReadonlySet<string>,
		extra?: ReadonlyMap<string, string>,
	): string {
		if (!isNode(node)) return '';
		const { start, end } = node;
		if (typeof start !== 'number' || typeof end !== 'number') return '';

		const edits: Edit[] = [];
		// A path this render is being made for is written out as the value it holds. Whole chains
		// first, and an identifier inside one is left alone afterwards, because two edits over the
		// same characters is a mistake upstream rather than a case to resolve.
		const taken = new Set<number>();
		if (fixed.size > 0) {
			chains(node, (at, base, rest) => {
				const name = base['name'];
				if (typeof name !== 'string') return false;
				const root = extra?.get(name) ?? (found.has(name) ? expand(name, open, extra) : name);
				const head = pathOf(root);
				if (head === null) return false;
				const literal = fixed.get([head, ...rest].join('.'));
				if (literal === undefined) return false;
				const from = base['start'];
				if (typeof from === 'number') taken.add(from);
				edits.push([at[0], at[1], literal]);
				return true;
			});
		}
		reads(node, new Set(), (at, shorthand) => {
			const name = at['name'];
			if (typeof name !== 'string' || open.has(name)) return;
			// A name bound by something other than a script, which the caller knows about and this
			// does not: a snippet's parameter, whose value is the argument at the one `{@render}`
			// that calls it. It wins over a script declaration of the same name, being the inner
			// scope.
			const given = extra?.get(name);
			if (given === undefined && !found.has(name)) return;
			const from = at['start'];
			const to = at['end'];
			if (typeof from !== 'number' || typeof to !== 'number') return;
			// Already written out as part of a bound path.
			if (taken.has(from)) return;
			const held = `(${given ?? expand(name, open, extra)})`;
			edits.push([from, to, shorthand === true ? `${name}: ${held}` : held]);
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
		const cached = expanded.get(name);
		if (cached !== undefined && open.size === 0 && extra === undefined) return cached;
		const one = found.get(name);
		if (one === undefined) return name;
		if (one.literal !== undefined) return one.literal;
		// A name cannot stand in for itself. A cycle among declarations is the author's, and
		// leaving the name in place lets the pass that resolves names report it.
		const inner = new Set(open).add(name);
		// Carried down, so a declaration that reads a prop reaches the value the caller passed
		// rather than the name it was written with.
		const body = slice(one.node, inner, extra);
		// Parenthesised because what follows it is a member access, and because a function or a
		// class only reads as an expression that way.
		const written = one.access === '' ? body : `(${body})${one.access}`;
		// A name declared to be one of the bound paths holds that path's value in this render.
		const path = fixed.size === 0 ? null : pathOf(written);
		const text = (path === null ? undefined : fixed.get(path)) ?? written;
		if (open.size === 0 && extra === undefined) expanded.set(name, text);
		return text;
	}

	return {
		has: (name) => found.has(name),
		rune: (name) => found.get(name)?.rune,
		ids: new Set(
			[...found.values()].filter((one) => one.rune === '$props.id').map((one) => one.name),
		),
		rewrite: (node, extra) => slice(node, new Set(), extra),
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
		// children read, from props the caller gave it as constants. A destructuring is not
		// substituted this way, since one initialiser stands for several names and the expansion
		// is only ever one of them.
		reading: [
			...reactive(ast, found, new Set([...carried, ...props, ...(bound?.keys() ?? [])])),
			...new Map(
				[...found.values()]
					.filter((one) => one.reads)
					.map((one): [string, Neutral] => {
						const text = one.access === '' ? expand(one.name, new Set(), bound) : null;
						const settled =
							text !== null && !mentions(text, dynamic ?? carried) ? text : EMPTY[one.holds];
						if (process.env['SEAM_TRACE'] !== undefined && text !== null && settled !== text) {
							const mentioned = [...(dynamic ?? carried)].filter((each) =>
								mentions(text, new Set([each])),
							);
							console.error(
								`[seam] neutralised \`${one.name}\` mentioning ${mentioned.join(', ') || '(unparsable)'}: ` +
									text.replace(/\s+/g, ' ').slice(0, 240),
							);
						}
						return [one.at.join(':'), [one.at, settled]];
					}),
			).values(),
		],
	};
}

/** How many trees the two memos above hold, which is what a compile trades memory for. */
export function remembered(): { expressions: number; components: number } {
	return { expressions: trees.size, components: 0 };
}
