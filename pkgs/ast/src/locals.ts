import { parse } from 'svelte/compiler';
import { type Edit, type Neutral, apply } from './edits.ts';
import { chains, destructure, free, isNode, type Node, props, reads } from './scope.ts';

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
	fresh: string,
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
							record(id['name'], id, { literal: fresh, reads: false });
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
): { text: string; undecided: string | null } {
	let text = expression;
	for (;;) {
		let ast: Node;
		try {
			ast = parsed(text);
		} catch {
			return { text, undecided: null };
		}
		const found = conditional(ast['fragment'], dynamic);
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
function conditional(node: unknown, dynamic: ReadonlySet<string>): Spans | null {
	if (Array.isArray(node)) {
		for (const one of node) {
			const found = conditional(one, dynamic);
			if (found !== null) return found;
		}
		return null;
	}
	if (!isNode(node)) return null;
	const type = node['type'];
	if (type === 'ArrowFunctionExpression' || type === 'FunctionExpression') return null;
	if (type === 'ConditionalExpression') {
		if (!chooses(node, dynamic)) return null;
		const spans = [node, node['test'], node['consequent'], node['alternate']].map(where);
		const [whole, test, consequent, alternate] = spans;
		if (whole && test && consequent && alternate) return [whole, test, consequent, alternate];
		return null;
	}
	for (const value of Object.values(node)) {
		const found = conditional(value, dynamic);
		if (found !== null) return found;
	}
	return null;
}

/** Whether a ternary has a branch a marker cannot stand for, looking through nested ones. */
function chooses(node: Node, dynamic: ReadonlySet<string>): boolean {
	return [node['consequent'], node['alternate']].some((branch) => {
		if (!isNode(branch)) return false;
		if (branch['type'] === 'ConditionalExpression') return chooses(branch, dynamic);
		if (isLiteral(branch)) return false;
		let varies = false;
		reads(branch, new Set(), (at) => {
			if (typeof at['name'] === 'string' && dynamic.has(at['name'])) varies = true;
		});
		return !varies;
	});
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
	fresh = '__i',
): Locals {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const carried = props(ast['instance']);
	const found = declared(ast, source, carried, fresh) as Map<string, Declared & { node: Node }>;

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
		// with the expression the walk carried. A destructuring is not substituted this way, since
		// one initialiser stands for several names and the expansion is only ever one of them.
		reading: [
			...new Map(
				[...found.values()]
					.filter((one) => one.reads)
					.map((one): [string, Neutral] => {
						const text = one.access === '' ? expand(one.name, new Set()) : null;
						const settled = text !== null && !mentions(text, carried) ? text : EMPTY[one.holds];
						return [one.at.join(':'), [one.at, settled]];
					}),
			).values(),
		],
	};
}
