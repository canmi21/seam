/**
 * Svelte's own statements read the way Svelte reads them: which names are runes and what each
 * holds, what a `$:` declares, what a function the render calls changes, and what a body writes.
 * See spec/derivation.md.
 */
import {
	bound as namesBound,
	destructure,
	free,
	emptyFor,
	INIT,
	isNode,
	type Node,
	rootOf,
} from './scope.ts';
import { writes } from './declarations.ts';
import { type Declared } from './locals.ts';

/**
 * Whether the file is in runes mode, which is the question `LabeledStatement.js` asks before it
 * treats a `$:` as anything: `2-analyze/index.js` sets `runes` where any reference is a rune, and
 * in that mode a `$:` is an ordinary label.
 */
export function runic(ast: Node): boolean {
	let found = false;
	const step = (one: unknown): void => {
		if (found || one === null || one === undefined) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'Identifier' && typeof one['name'] === 'string') {
			if (RUNIC.has(one['name'])) found = true;
			return;
		}
		for (const value of Object.values(one)) step(value);
	};
	for (const block of [ast['module'], ast['instance']]) {
		if (isNode(block)) step(block['content']);
	}
	return found;
}

const RUNIC = new Set([
	'$state',
	'$derived',
	'$props',
	'$bindable',
	'$effect',
	'$inspect',
	'$host',
]);

/**
 * The reactive declarations a script makes: `$: name = value`, with the value's node.
 *
 * Only an assignment to a plain name, which is the shape `transform-server.js` declares a `let`
 * for -- it reads `node.body.expression.left` and takes the identifiers whose binding is
 * `legacy_reactive`. A `$:` that mutates something, or destructures, or is a bare statement, is
 * not a declaration and is left to the rules that already cover it.
 */
/** A name a `$:` declares, the right-hand side it stands for, and how it reaches into it. */
interface Reactive {
	name: string;
	value: Node;
	reach: string;
	slots: readonly Node[];
	holds: string;
	/** Written inside a block, for which `transform-server.js` unshifts no `let` of its own. */
	declared?: true;
}

/**
 * The assignment a `$:` statement is, where it is one, with a block holding one taken as that one.
 *
 * `$: { bar = foo * 2 }` runs before the template the way `$: bar = foo * 2` does. What differs is
 * upstream: `legacy_reactive_declarations` in `transform-server.js` is filled only for a body that
 * is an `ExpressionStatement` holding an `AssignmentExpression`, so Svelte unshifts a `let` for the
 * first shape and not for the second, which is why a name only a block assigns has to be declared
 * elsewhere. Returns the block flag beside the node so the callers can tell them apart.
 */
export function reactiveOf(statement: Node): { held: Node; inside: boolean } | null {
	const written = statement['body'];
	const inner =
		isNode(written) && written['type'] === 'BlockStatement' && Array.isArray(written['body'])
			? written['body']
			: null;
	const body = inner !== null && inner.length === 1 ? inner[0] : written;
	if (!isNode(body) || body['type'] !== 'ExpressionStatement') return null;
	const held = body['expression'];
	if (!isNode(held) || held['type'] !== 'AssignmentExpression') return null;
	return { held, inside: inner !== null };
}

export function reactives(block: unknown): Reactive[] {
	const found: Reactive[] = [];
	if (!isNode(block)) return found;
	const content = block['content'];
	if (!isNode(content) || !Array.isArray(content['body'])) return found;
	for (const statement of content['body']) {
		if (!isNode(statement) || statement['type'] !== 'LabeledStatement') continue;
		const label = statement['label'];
		if (!isNode(label) || label['name'] !== '$') continue;
		const written = reactiveOf(statement);
		if (written === null || written.held['operator'] !== '=') continue;
		const { held, inside } = written;
		const left = held['left'];
		const right = held['right'];
		if (!isNode(left) || !isNode(right)) continue;
		// `transform-server.js` takes **every identifier the left binds**, not only a plain name:
		// `for (const id of extract_identifiers(node.body.expression.left))`, each declared where
		// its binding is `legacy_reactive`. So `$: ({ store } = container)` and `$: [x, y] = coords`
		// declare what they destructure, and each name reaches the right the way any pattern does.
		//
		// `$: $count = n` writes the store `count` and declares nothing: a subscription's binding is
		// `store_sub` rather than `legacy_reactive`.
		if (left['type'] === 'Identifier') {
			if (typeof left['name'] !== 'string' || left['name'].startsWith('$')) continue;
			found.push({
				name: left['name'],
				value: right,
				reach: INIT,
				holds: 'null',
				slots: [],
				...(inside ? { declared: true as const } : {}),
			});
			continue;
		}
		if (left['type'] !== 'ObjectPattern' && left['type'] !== 'ArrayPattern') continue;
		// The stand-in replaces the right-hand expression and the left destructures it, so it has to
		// be shaped like the left at every level.
		const holds = emptyFor(left);
		for (const { name, reach, slots } of destructure(left)) {
			if (name.startsWith('$')) continue;
			found.push({ name, value: right, reach, holds, slots });
		}
	}
	return found;
}

/**
 * The rune a call names, as the dotted keypath Svelte itself builds: `$state`, `$derived.by`,
 * `$props.id`. Null when the callee is not one.
 */
export function runeCalled(callee: unknown): string | null {
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
export const SUBSTITUTED: Readonly<Record<string, string>> = {
	$state: '',
	'$state.raw': '',
	// No branch of its own in the server's `VariableDeclaration.js`, so the general one's first
	// argument; the client dropped the declaration until 5.57.1, which is why no sample had one.
	'$state.eager': '',
	// `VariableDeclaration.js` writes `args.length > 0 ? visit(args[0]) : b.void0` for every rune it
	// does not let through, so a declaration holding a snapshot holds what was snapshotted. In an
	// expression the same call is `$.snapshot(v)`, which clones; the two visitors differ and this
	// list is the declaration's.
	'$state.snapshot': '',
	$derived: '',
	'$derived.by': '()',
};

/**
 * What follows a rune's first argument to reach the value the declaration holds, or undefined for
 * a rune that is not a substitution. The same answer a `{let}` in markup needs: `DeclarationTag.js`
 * pushes the declaration into the block's `init` unchanged, so its initialiser is transformed by
 * the same `CallExpression` visitor a script's is.
 */
export function runeHolds(rune: string): string | undefined {
	return SUBSTITUTED[rune];
}

export function reactive(
	ast: Node,
	found: Map<string, Declared & { node: Node }>,
	/** What the render is not given: the request's names, and the props of this component -- the
	 * entry's own, and a child's, which its call site bound and the render is handed a literal
	 * for. */
	given: ReadonlySet<string>,
	/** Names a `$:` declares. One of those is neutralised as the declaration it is, over its
	 * initialiser, and writing over the whole statement too would be two edits on one span. */
	declares: ReadonlySet<string>,
	/** Filled with the names a neutralised statement binds: the render no longer computes them. */
	gone: Set<string> = new Set(),
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
		// A block holding one assignment is that assignment, the reading `reactives()` makes.
		const written = reactiveOf(statement);
		const held = written?.held ?? null;
		const left = held === null ? null : held['left'];
		// Every name the left binds, not only a plain one: `$: ({ store } = container)` declares
		// `store` the same way `$: doubled = n * 2` declares `doubled`, and that declaration is
		// neutralised over its initialiser. Writing over the whole statement as well is two edits
		// on one span.
		const bound = new Set<string>();
		if (isNode(left)) namesBound(left, bound);
		if (bound.size > 0 && [...bound].every((one) => declares.has(one))) continue;
		const reads = new Set<string>();
		free(body, new Set(), reads);
		const wanting = [...reads].some((one) => given.has(one) || found.get(one)?.reads === true);
		if (!wanting) continue;
		// Every name the statement assigns, not only the one a single assignment binds: a block that
		// does two things is neutralised whole, and both names stop being computed. `$: { c = a + b;
		// count = count + 1 }` is that, and reading only the first left `count` looking like a name
		// the render still holds.
		for (const name of bound) gone.add(name);
		writes(body, gone);
		const { start, end } = body;
		// With its own semicolon: the statement's span takes the author's with it, and two written
		// over on one line were `$: undefined $: undefined`, which is not JavaScript.
		if (typeof start === 'number' && typeof end === 'number')
			out.push([[start, end], 'undefined;']);
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

/**
 * The language's own methods that call what they are handed before they return, by name.
 *
 * The same kind of list as `CALLS` and for the same reason: nothing in the shape of a member call
 * says whether the function is run now or later, and `then`, `setTimeout` and `addEventListener`
 * are the other side. These are ECMAScript's, and every one of them is synchronous whatever the
 * receiver is -- `$: keys.forEach((key) => { object[key] = [] })` is a mutation nothing here could
 * see without them.
 */
const ITERATORS: ReadonlySet<string> = new Set([
	'every',
	'filter',
	'find',
	'findIndex',
	'findLast',
	'findLastIndex',
	'flatMap',
	'forEach',
	'map',
	'reduce',
	'reduceRight',
	'some',
	'sort',
]);

/**
 * What the server answers a rune call with, read out of `3-transform/server/visitors/
 * CallExpression.js`.
 *
 * A rune is compiled away and exists nowhere at run time, so an expression holding one has to be
 * written as what Svelte writes there. `null` marks the ones that are the argument itself --
 * `$state(v)`, `$state.raw(v)`, `$state.eager(v)` -- which keep the argument and lose the call.
 *
 * The ones not here are the ones that need a helper or a declaration to stand in: `$derived` and
 * `$state.snapshot` call into Svelte's runtime, and `$props` and `$bindable` are a declaration's
 * business rather than an expression's.
 */
export const ANSWERED: Record<string, string | null> = {
	$effect: 'undefined',
	'$effect.pre': 'undefined',
	'$effect.tracking': 'false',
	'$effect.root': '(() => {})',
	'$effect.pending': '0',
	$host: 'undefined',
	$inspect: 'undefined',
	'$inspect.trace': 'undefined',
	$state: null,
	'$state.raw': null,
	'$state.eager': null,
};

/**
 * The runes a declaration lets through to the `CallExpression` visitor that answers them.
 *
 * `VariableDeclaration.js` names these three and no others; every other rune in a declaration is
 * its first argument, or `void 0` where it has none. So `$effect.pending()` is `0` in an expression
 * and `undefined` in a declaration, which is one rule read in two places rather than two rules.
 */
export const FALLS_THROUGH: ReadonlySet<string> = new Set([
	'$effect.tracking',
	'$inspect',
	'$effect.root',
]);

/**
 * Every class field written `$derived(e)` or `$derived.by(fn)`, with the spans a getter replaces.
 *
 * `at` is the whole field, `argument` the rune's one argument, and `called` says which rune it was:
 * `$derived.by` takes the function rather than the value, so reading it is a call.
 */
export function derived(
	node: unknown,
	at: (one: Node, whole: [number, number], argument: [number, number], called: boolean) => void,
): void {
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		for (const value of Object.values(one)) step(value);
		if (one['type'] !== 'PropertyDefinition') return;
		const value = one['value'];
		if (!isNode(value) || value['type'] !== 'CallExpression') return;
		const rune = runeCalled(value['callee']);
		if (rune !== '$derived' && rune !== '$derived.by') return;
		const args = Array.isArray(value['arguments']) ? value['arguments'] : [];
		const [only] = args;
		if (!isNode(only)) return;
		const whole = [one['start'], one['end']];
		const argument = [only['start'], only['end']];
		if (whole.some((each) => typeof each !== 'number')) return;
		if (argument.some((each) => typeof each !== 'number')) return;
		at(one, whole as [number, number], argument as [number, number], rune === '$derived.by');
	};
	step(node);
}

/** Every rune call in a node, innermost last, with the rune it names. */
export function answered(node: unknown, at: (one: Node, rune: string) => void): void {
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		for (const value of Object.values(one)) step(value);
		if (one['type'] !== 'CallExpression') return;
		const rune = runeCalled(one['callee']);
		if (rune !== null && rune in ANSWERED) at(one, rune);
	};
	step(node);
}

/** Svelte's own `$$`-prefixed names, which are not a subscription to a store called `$props`. */
export const RESERVED = new Set(['$$props', '$$restProps', '$$slots']);

/** The three shapes a function is written in, whose body does not run where it is written. */
export const FUNCTIONS = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
]);

/**
 * Walks the part of a node the render runs, which is not all of it.
 *
 * A function written inside an expression does not run where it is written: `on:change={() =>
 * handler(bar)}` names a call and makes none, and `factory` returning `{ onclick: () => { v = 1 } }`
 * assigns nothing while the bytes are written. So the walk stops at every function it meets --
 * except the one it was given, whose body is the thing being asked about, and one written as the
 * argument of a call, which that call runs.
 */
export function running(node: unknown, at: (one: Node) => void): void {
	const step = (one: unknown): void => {
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		// A getter is run by a property read, which is not something the reader wrote as a call.
		// `const obj = { get promise() { return fn() } }` runs `fn` on `obj.promise`, so its body is
		// walked where a plain function property's is not: what a function property does is decided
		// by whoever calls it, and nobody here does.
		if (isNode(one) && one['type'] === 'Property' && one['kind'] === 'get') {
			const held = one['value'];
			if (isNode(held)) step(held['body']);
			return;
		}
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
			const named =
				isNode(callee) && callee['type'] === 'Identifier' ? String(callee['name']) : null;
			// A member whose name is one of the language's own synchronous iterators. `then`,
			// `setTimeout` and `addEventListener` are the other side and are why this is a list
			// rather than a rule -- but `xs.forEach(fn)` calls `fn` before it returns, whatever `xs`
			// is, and a `$:` written that way was a mutation nothing here could see.
			const method =
				isNode(callee) &&
				callee['type'] === 'MemberExpression' &&
				callee['computed'] !== true &&
				isNode(callee['property']) &&
				callee['property']['type'] === 'Identifier'
					? String(callee['property']['name'])
					: null;
			if ((named !== null && CALLS.has(named)) || (method !== null && ITERATORS.has(method))) {
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
export function calling(node: unknown, names: ReadonlySet<string>, run: boolean): Set<string> {
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

/**
 * The script's names a node assigns or updates as bare names while it runs -- `n += 1`, `num++` --
 * which is what a derivation written out has nowhere to write. A member written through, `o.a = 1`,
 * changes the value the name holds, and a derivation holding that value changes it as the render
 * does. What a function the node declares binds for itself is its own.
 */
export function bareWrites(node: unknown, names: ReadonlySet<string>): Set<string> {
	const found = new Set<string>();
	const mine = shadows(node);
	const body = isNode(node) && FUNCTIONS.has(String(node['type'])) ? node['body'] : node;
	running(body, (one) => {
		const type = one['type'];
		const target =
			type === 'AssignmentExpression'
				? one['left']
				: type === 'UpdateExpression'
					? one['argument']
					: undefined;
		if (!isNode(target) || target['type'] !== 'Identifier') return;
		const name = target['name'];
		if (typeof name === 'string' && names.has(name) && !mine.has(name)) found.add(name);
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
export function changing(
	node: unknown,
	names: ReadonlySet<string>,
	/** What the node declares for itself, which shadows the script's. Empty for the script's own
	 * statements, whose declarations are the ones being asked about. */
	mine: ReadonlySet<string> = shadows(node),
): { written: Set<string>; called: Set<string> } {
	const written = new Set<string>();
	const called = new Set<string>();
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
