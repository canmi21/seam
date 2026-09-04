import { parse } from 'svelte/compiler';
import { type Edit, type Neutral, apply } from './edits.ts';
import { destructure, free, isNode, type Node, props, reads } from './scope.ts';

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
 * nothing and does not run, and `$props.id()` is a value the server and the client each generate,
 * which is the shape spec/derivation.md refuses as ambient.
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
function declared(ast: Node, source: string, names: ReadonlySet<string>): Map<string, Declared> {
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
							record(id['name'], argument, { access: reach });
							continue;
						}
						const holds = id['type'] === 'ArrayPattern' ? 'array' : 'object';
						for (const [name, into] of destructure(id)) {
							record(name, argument, { access: `${reach}${into}`, holds });
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
 * **Function bodies are not walked.** A handler that assigns to a name does not run during a
 * render, so `let n = 0; function buy() { n += 1 }` still holds `0` when the bytes are written, and
 * refusing it would refuse the ordinary way an event handler is written.
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
 * One expression, parsed as the component it would be the whole of.
 *
 * The empty script is what makes TypeScript readable. An expression in the markup of a
 * `lang="ts"` component may carry an annotation or an `as`, and Svelte chooses its parser from the
 * script tag rather than from the expression -- so without one, `(q: { s: string }) => q.s` is a
 * syntax error. That was not a parse failure anyone saw: `mentions` reads a failure as "assume it
 * reaches the payload", which is the safe answer and the wrong one here, and a value that was the
 * same every request got a marker planted in it and was handed to a package as a string.
 */
function parsed(expression: string): Node {
	return parse(`<script lang="ts"></script>{${expression}}`, {
		modern: true,
	}) as unknown as Node;
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

/** Every name the two scripts declare, with what each stands for and where each was written. */
export function locals(source: string): Locals {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const found = declared(ast, source, props(ast['instance'])) as Map<
		string,
		Declared & { node: Node }
	>;

	// Refused rather than substituted wrongly. Two of these compiled and wrote the wrong bytes with
	// nothing to say so, which is the shape this compiler keeps finding: a model narrower than its
	// input, and no error where they part.
	const names = new Set(found.keys());
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
		const text = one.access === '' ? body : `(${body})${one.access}`;
		if (open.size === 0 && extra === undefined) expanded.set(name, text);
		return text;
	}

	return {
		has: (name) => found.has(name),
		rewrite: (node, extra) => slice(node, new Set(), extra),
		// By span rather than by name: one destructuring declares several names and is one place
		// in the source, and writing over it twice would take the file apart.
		reading: [
			...new Map(
				[...found.values()]
					.filter((one) => one.reads)
					.map((one): [string, Neutral] => [one.at.join(':'), [one.at, EMPTY[one.holds]]]),
			).values(),
		],
	};
}
