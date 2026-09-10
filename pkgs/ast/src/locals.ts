import { parse } from 'svelte/compiler';
import { type Edit, type Neutral, apply } from './edits.ts';
import {
	bound as namesBound,
	chains,
	destructure,
	free,
	emptyFor,
	INIT,
	SLOT,
	isNode,
	type Node,
	reads,
	requested,
	within,
	WRAPS,
} from './scope.ts';
import { GIVEN } from './runes.ts';

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
	/**
	 * The expression that reaches this name from the initialiser, as a template over `INIT`: `INIT`
	 * itself where the declaration named it directly, `INIT.a` out of an object, and a call around
	 * it where a rest gathers what the pattern did not name. A template rather than a suffix
	 * because `exclude_from_object` and `to_array` wrap the value rather than follow it, and a
	 * pattern may alternate the two.
	 */
	reach: string;
	/**
	 * The nodes the `SLOT(n)` places in `reach` stand for: a default's value, a computed key. They
	 * are expressions in the declaration's own scope, so they are expanded the way the initialiser
	 * is rather than written into the template as source.
	 */
	slots: readonly Node[];
	/**
	 * What a render is handed in its place, as source: `null` for a plain declaration, and a value
	 * shaped like the pattern where it destructured, at every level. See `emptyFor`.
	 */
	holds: string;
	/**
	 * The rune the declaration was written with, where it was: `$state`, `$derived`. Svelte's
	 * analysis reads a component tag naming such a declaration as dynamic and writes anchors
	 * around it, which a tag naming a plain `const` does not get. See `walk.ts`.
	 */
	rune?: string;
	/**
	 * Declared by a `$:` rather than by a declaration, which is a difference one rule cares about:
	 * the statement that declares it is also an assignment to it, and the rule that refuses an
	 * assignment after a declaration must not read it as one. See `reactives()`.
	 */
	reactive?: true;
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
 * Whether the file is in runes mode, which is the question `LabeledStatement.js` asks before it
 * treats a `$:` as anything: `2-analyze/index.js` sets `runes` where any reference is a rune, and
 * in that mode a `$:` is an ordinary label.
 */
function runic(ast: Node): boolean {
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
function reactiveOf(statement: Node): { held: Node; inside: boolean } | null {
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

function reactives(block: unknown): Reactive[] {
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
const SUBSTITUTED: Readonly<Record<string, string>> = {
	$state: '',
	'$state.raw': '',
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

export interface Locals {
	/**
	 * The names substitution cannot follow, each with the sentence that says why.
	 *
	 * A read of one is left as the author wrote it: the render runs the instance script and has the
	 * value, so an expression the render evaluates is right without anything being done to it. What
	 * cannot follow the change is writing the initialiser at each read, so the name survives into
	 * any expression this compiler has to write itself and the refusal is made there.
	 */
	changed: ReadonlyMap<string, string>;
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
	rewrite: (
		node: unknown,
		extra?: ReadonlyMap<string, string>,
		/**
		 * Names that stand for something **only where the expression itself reads them**, never
		 * inside a declaration this pass expands on the way. A component `bind:` is what this is
		 * for: `transform-server.js` wraps only `template.body` in the settling loop, so the
		 * template's own reads see what the child sent back and a `const y = x * 2` above keeps the
		 * value `x` had before it. One name, two values, told apart by where the read is.
		 */
		sent?: ReadonlyMap<string, string>,
	) => string;
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
function assigned(
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
function losing(
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
		for (const target of written) if (read.has(target) && !declares.has(target)) lost.add(target);
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
		for (const target of changed) {
			if (!elsewhere.has(target)) continue;
			lost.add(target);
			// The function itself, so that an expression this compiler writes out is refused for
			// calling it. `{count}` left as the author wrote it is the render's to evaluate and comes
			// out right; a derivation that calls `default_arg` runs the change once per read, where
			// the render runs it once, and the two disagree about a name neither expression names.
			lost.add(name);
		}
	}
	if (lost.size === 0) return new Map();
	const list = [...lost].map((one) => `\`${one}\``).join(', ');
	const why =
		`${list} ${lost.size > 1 ? 'are' : 'is'} changed by a function this render calls, and the ` +
		'markup reads a name by the expression it was declared to be -- so every read evaluates ' +
		'that expression again and the change is made to a value nothing else holds. Compute the ' +
		'value in one expression, or move what changes it out of the render. See spec/derivation.md';
	return new Map([...lost].map((one) => [one, why]));
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
function writes(node: unknown, into: Set<string>): void {
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

function reactive(
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
const ANSWERED: Record<string, string | null> = {
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
const FALLS_THROUGH: ReadonlySet<string> = new Set([
	'$effect.tracking',
	'$inspect',
	'$effect.root',
]);

/** Every rune call in a node, innermost last, with the rune it names. */
function answered(node: unknown, at: (one: Node, rune: string) => void): void {
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
const RESERVED = new Set(['$$props', '$$restProps', '$$slots']);

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
/** The initialisers whose two evaluations are two values. See spec/derivation.md. */
const MAKES: ReadonlySet<string> = new Set([
	'ObjectExpression',
	'ArrayExpression',
	'NewExpression',
	'CallExpression',
]);

/**
 * The part of a reach template every name of one pattern shares, as a template over `INIT`.
 *
 * `destructure()` writes an array's reach as `$$to_array(INIT, n)[0]`, so the call is the shared
 * part and the index is the name's own. Everything else reaches by member, where the initialiser is
 * what is shared and one accessor is the name's.
 */
function shared(reach: string): string | null {
	if (reach.startsWith('$$to_array(')) {
		let depth = 0;
		for (const [at, c] of [...reach].entries()) {
			if (c === '(') depth += 1;
			else if (c === ')') {
				depth -= 1;
				if (depth > 0) continue;
				const call = reach.slice(0, at + 1);
				return call.includes(INIT) ? call : null;
			}
		}
		return null;
	}
	return reach.startsWith(INIT) ? INIT : null;
}

/** The index this expression has in a walk's held list, appending it where it is new. */
function kept(expression: string, held: { expression: string; files?: string[] }[]): number {
	const at = held.findIndex((one) => one.expression === expression);
	if (at >= 0) return at;
	held.push({ expression });
	return held.length - 1;
}

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
): Locals {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const carried = requested(ast['instance']);
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

	// Svelte's own names for the object a caller passed are rebuilt at every read here -- the
	// entry's out of the payload, a child's out of what its call site wrote -- so a script that
	// writes into one has changed a value nothing else holds. `$: $$restProps.c = $$restProps.c ??
	// 'c'` beside `{$$restProps.c}` wrote nothing where Svelte wrote `c`: the same rule an
	// assignment after a declaration falls under, on a name that is not a declaration.
	const written = [
		...assigned(ast['module'], RESERVED, false, declares),
		...assigned(ast['instance'], RESERVED, false, declares),
	];
	if (written.length > 0) {
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
		const gone: [number, number][] = [];
		answered(node, (one, rune) => {
			const at = [one['start'], one['end']];
			if (typeof at[0] !== 'number' || typeof at[1] !== 'number') return;
			const held = ANSWERED[rune];
			if (held !== null && held !== undefined) {
				edits.push([at[0], at[1], held]);
				gone.push([at[0], at[1]]);
				return;
			}
			// The argument itself, with the call around it taken off so the argument's own names are
			// still rewritten where they stand.
			const args = Array.isArray(one['arguments']) ? one['arguments'] : [];
			const [only] = args;
			if (!isNode(only) || typeof only['start'] !== 'number' || typeof only['end'] !== 'number') {
				edits.push([at[0], at[1], 'undefined']);
				gone.push([at[0], at[1]]);
				return;
			}
			edits.push([at[0], only['start'], '(']);
			edits.push([only['end'], at[1], ')']);
		});
		const written = (from: number): boolean => gone.some(([a, b]) => from >= a && from < b);
		if (fixed.size > 0) {
			chains(node, (at, base, rest) => {
				const name = base['name'];
				if (typeof name !== 'string') return false;
				const root = extra?.get(name) ?? (found.has(name) ? expand(name, open, extra) : name);
				const head = pathOf(root);
				if (head === null) return false;
				if (typeof base['start'] === 'number' && written(base['start'])) return false;
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
			// Inside a rune call already written out as a constant, where nothing is left to name.
			if (typeof at['start'] === 'number' && written(at['start'])) return;
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
				// A child's object is written out rather than named, and it never carries `children`
				// or `$$slots`, so `sanitize_props` has nothing to drop and is left off. Which slots
				// the caller filled is known by name, so `sanitize_slots` is written out too.
				const object = passing === undefined ? `${GIVEN}` : passing.object;
				const slots =
					passing === undefined
						? `($$sanitize_slots(${GIVEN}))`
						: `({ ${passing.slots.map((one) => `${JSON.stringify(one)}: true`).join(', ')} })`;
				const rest =
					passing === undefined
						? `($$rest_props($$sanitize_props(${GIVEN}), [${listed}]))`
						: `($$rest_props(${object}, [${listed}]))`;
				const held = name === '$$props' ? `(${object})` : name === '$$slots' ? slots : rest;
				edits.push([from, to, shorthand === true ? `${name}: ${held}` : held]);
				return;
			}
			const store = name.startsWith('$') && !RESERVED.has(name) ? name.slice(1) : null;
			if (given === undefined && !found.has(name)) {
				if (store === null || !found.has(store) || settled.has(store)) return;
				const from = at['start'];
				const to = at['end'];
				if (typeof from !== 'number' || typeof to !== 'number') return;
				if (taken.has(from)) return;
				// What the caller bound it to first, the way the branch below reads a name: a child's
				// `export let items;` is a declaration holding `undefined` here and a prop bound at
				// the call site there, and reading the declaration gave `$$get_store(undefined)`.
				const inner = extra?.get(store) ?? expand(store, open, extra);
				if (inner === 'undefined') return;
				const read = `($$get_store(${inner}))`;
				edits.push([from, to, shorthand === true ? `${name}: ${read}` : read]);
				return;
			}
			const from = at['start'];
			const to = at['end'];
			if (typeof from !== 'number' || typeof to !== 'number') return;
			// Already written out as part of a bound path.
			if (taken.has(from)) return;
			// A name substitution cannot follow is left as the author wrote it. The render runs the
			// instance script and has the value; what cannot follow the change is writing the
			// initialiser at each read. Where the expression is one the render evaluates that is the
			// whole answer, and where it is one this compiler has to write itself the name survives
			// into it and the refusal is made there. See `changed` and spec/derivation.md.
			if (given === undefined && changed.has(name)) return;
			const inner = given ?? expand(name, open, extra);
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
		let written = one.reach === INIT ? body : within(one.reach, `(${body})`);
		// And only where the initialiser **makes** something: an object or array literal, a `new`, or
		// a call, whose two evaluations are two values. A pattern over a name or a member read takes
		// the same value apart however many times it is written out, so holding it would buy nothing
		// and cost a derivation where the render used to evaluate the expression itself.
		const makes = MAKES.has(String(one.node['type']));
		if (one.reach !== INIT && held !== undefined && makes) {
			// What every name of this pattern shares, which is what has to be one value: the whole
			// `$$to_array(...)` call for an array, and the initialiser itself for an object. Holding
			// the initialiser alone is not enough for an array -- `to_array` would be called once per
			// name, and a second call over a generator reads an exhausted one, which is
			// `derived-destructured-iterator` written as `[a, b, c]` and coming out `1`, empty,
			// empty.
			const cut = shared(one.reach);
			if (cut !== null) {
				const at = kept(within(cut, `(${body})`), held);
				written = `$$hold(${String(at)})${one.reach.slice(cut.length)}`;
			}
		}
		for (const [at, node] of one.slots.entries()) {
			written = written.split(SLOT(at)).join(`(${slice(node, inner, extra)})`);
		}
		// A name declared to be one of the bound paths holds that path's value in this render.
		const path = fixed.size === 0 ? null : pathOf(written);
		const text = (path === null ? undefined : fixed.get(path)) ?? written;
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
					const text = one.literal ?? slice(one.node, new Set([one.name]), bound);
					// `GIVEN` is the payload object, which the render is not given any more than it
					// is given a payload name. A declaration standing for it is neutralised for the
					// same reason one reading a prop is, and Svelte refuses a `$$` name outright.
					const held = new Set([...(dynamic ?? carried), GIVEN]);
					const settled = !mentions(text, held) ? text : one.holds;
					// The render no longer computes this one either, so a read of it left as the
					// author wrote it reads the placeholder. `function foo() { b = c }` neutralised
					// over a `c` that reads a prop left `foo` as `null`, and the script's own
					// `foo()` failed inside Svelte's renderer.
					if (settled !== text) gone.add(one.name);
					if (process.env['SEAM_TRACE'] !== undefined && settled !== text) {
						const mentioned = [...held].filter((each) => mentions(text, new Set([each])));
						console.error(
							`[seam] neutralised \`${one.name}\` mentioning ${mentioned.join(', ') || '(unparsable)'}: ` +
								text.replace(/\s+/g, ' ').slice(0, 240),
						);
					}
					return [one.at.join(':'), [one.at, settled]];
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
	if (given !== undefined) {
		throw new Error(
			`\`${given[0]}\` is a prop this component changes, and a value handed to a component is ` +
				'written out as a marker standing for it, so the change is made to the marker rather ' +
				'than to the value. Compute the value in one expression, or move what changes it out ' +
				'of the render. See spec/derivation.md',
		);
	}
	const eager = [...changed].find(([name]) => bound !== undefined || gone.has(name));
	if (eager !== undefined) throw new Error(eager[1]);

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

/** How many trees the two memos above hold, which is what a compile trades memory for. */
export function remembered(): { expressions: number; components: number } {
	return { expressions: trees.size, components: 0 };
}
