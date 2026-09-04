/**
 * Where every name in the markup comes from.
 *
 * The compiler used to decide by shape: an expression matching a dotted identifier was a data
 * path and anything else became a derivation, and nothing asked where the names in either came
 * from. A local variable and a payload key look the same, so `{total}` was looked up in the data,
 * found nothing, and rendered an empty string. That is the failure this exists to stop, and it is
 * the worst of the three it stops because it is the silent one.
 *
 * See spec/derivation.md, which this implements.
 */
import { parse } from 'svelte/compiler';

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
	return typeof value === 'object' && value !== null;
}

/**
 * Names that resolve to the same value everywhere, so an expression using one cannot make the
 * server and the browser disagree. Deliberately short: this is a list of things nobody has to
 * think about, and anything that reads a clock, a locale or an environment is not on it.
 */
const GLOBALS = new Set([
	'Array',
	'BigInt',
	'Boolean',
	'Infinity',
	'JSON',
	'Map',
	'Math',
	'NaN',
	'Number',
	'Object',
	'RegExp',
	'Set',
	'String',
	'URL',
	'URLSearchParams',
	'decodeURI',
	'decodeURIComponent',
	'encodeURI',
	'encodeURIComponent',
	'isFinite',
	'isNaN',
	'parseFloat',
	'parseInt',
	'undefined',
]);

/** Members of an allowed global that are not themselves deterministic. */
const AMBIENT_MEMBERS: Record<string, ReadonlySet<string>> = {
	Math: new Set(['random']),
};

export interface Unresolved {
	name: string;
	/** The expression it was written in, so the report says where to look. */
	expression: string;
	reason: 'unknown' | 'ambient';
}

/** One name an expression uses that came from an import, and how to ask for it again. */
export interface Carried {
	/** The name as the markup writes it. */
	local: string;
	from: string;
	/** What the module calls it: the export's name, `default`, or the whole module. */
	kind: 'named' | 'default' | 'namespace';
	/** For a named import, the exported name, which a rename makes different from `local`. */
	exported?: string;
}

export interface Bindings {
	unresolved: Unresolved[];
	/**
	 * The imported names the markup actually uses. They are legal, and they are the list of what
	 * has to be bundled with the expressions that call them. Not analysed: see spec/derivation.md
	 * for why a purity check over library code was measured and abandoned.
	 */
	carried: Carried[];
}

interface Context {
	known: ReadonlyMap<string, Carried>;
	used: Set<string>;
	declares: (name: string) => boolean;
}

const KINDS: Record<string, Carried['kind']> = {
	ImportSpecifier: 'named',
	ImportDefaultSpecifier: 'default',
	ImportNamespaceSpecifier: 'namespace',
};

/** Every name the instance script imports, and enough about each to import it again. */
function imported(instance: unknown): Map<string, Carried> {
	const found = new Map<string, Carried>();
	if (!isNode(instance)) return found;
	const content = instance['content'];
	if (!isNode(content)) return found;
	const body = content['body'];
	if (!Array.isArray(body)) return found;

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		const from = statement['source'];
		if (!isNode(from) || typeof from['value'] !== 'string') continue;
		for (const specifier of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
			if (!isNode(specifier)) continue;
			const local = specifier['local'];
			const kind = KINDS[String(specifier['type'])];
			if (!isNode(local) || typeof local['name'] !== 'string' || kind === undefined) continue;
			const named = specifier['imported'];
			found.set(local['name'], {
				local: local['name'],
				from: from['value'],
				kind,
				...(isNode(named) && typeof named['name'] === 'string' ? { exported: named['name'] } : {}),
			});
		}
	}
	return found;
}

/** Every name a binding pattern introduces: `{ a, b: c }`, `[d]`, `...rest`, `e = 1`. */
function bound(pattern: unknown, into: Set<string>): void {
	if (!isNode(pattern)) return;
	switch (pattern['type']) {
		case 'Identifier': {
			const name = pattern['name'];
			if (typeof name === 'string') into.add(name);
			return;
		}
		case 'ObjectPattern': {
			const properties = pattern['properties'];
			if (Array.isArray(properties)) {
				for (const property of properties) {
					if (!isNode(property)) continue;
					bound(
						property['type'] === 'RestElement' ? property['argument'] : property['value'],
						into,
					);
				}
			}
			return;
		}
		case 'ArrayPattern': {
			const elements = pattern['elements'];
			if (Array.isArray(elements)) for (const element of elements) bound(element, into);
			return;
		}
		case 'AssignmentPattern':
			bound(pattern['left'], into);
			return;
		case 'RestElement':
			bound(pattern['argument'], into);
			return;
		default:
			return;
	}
}

/**
 * The names an expression reads from outside itself.
 *
 * A property name is not a read: `a.b` reads `a`. A key is not a read either, unless it was
 * written in brackets. A function's parameters and its own declarations are bound within it, so
 * they are subtracted rather than reported.
 */
function reads(node: unknown, scope: ReadonlySet<string>, visit: (at: Node) => void): void {
	if (!isNode(node)) return;
	const type = node['type'];

	if (type === 'Identifier') {
		const name = node['name'];
		if (typeof name === 'string' && !scope.has(name)) visit(node);
		return;
	}

	if (type === 'MemberExpression') {
		reads(node['object'], scope, visit);
		if (node['computed'] === true) reads(node['property'], scope, visit);
		return;
	}

	if (type === 'Property') {
		if (node['computed'] === true) reads(node['key'], scope, visit);
		reads(node['value'], scope, visit);
		return;
	}

	if (
		type === 'ArrowFunctionExpression' ||
		type === 'FunctionExpression' ||
		type === 'FunctionDeclaration'
	) {
		const inner = new Set(scope);
		const params = node['params'];
		if (Array.isArray(params)) for (const param of params) bound(param, inner);
		reads(node['body'], inner, visit);
		return;
	}

	if (type === 'VariableDeclarator') {
		// The name is introduced here rather than read, but its initialiser is read in the scope
		// that existed before it.
		reads(node['init'], scope, visit);
		return;
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) reads(child, scope, visit);
		} else if (isNode(value)) {
			reads(value, scope, visit);
		}
	}
}

/** The names an expression reads from outside itself. */
function free(node: unknown, scope: ReadonlySet<string>, into: Set<string>): void {
	reads(node, scope, (at) => {
		const name = at['name'];
		if (typeof name === 'string') into.add(name);
	});
}

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
 * What each script declares, in either block, with the initialiser kept as source.
 *
 * Both blocks are read the same way and the difference between them falls out rather than being
 * enforced: a module script has no props to read, so what it declares is constant, and an
 * instance script may read them, so what it declares is a derivation. Neither is evaluated here.
 */
/**
 * How a destructured name is reached from the value it was taken out of.
 *
 * Exported because a snippet's parameter is destructured the same way a declaration is, and the
 * value it comes apart from is the argument at the `{@render}` that calls it rather than an
 * initialiser. A default or a rest is left out: neither is a member nor an index, so there is no
 * way in to write down. See spec/derivation.md.
 */
export function destructure(pattern: Node): [string, string][] {
	const found: [string, string][] = [];
	if (pattern['type'] === 'ObjectPattern') {
		for (const property of Array.isArray(pattern['properties']) ? pattern['properties'] : []) {
			if (!isNode(property) || property['type'] !== 'Property') continue;
			const key = property['key'];
			const value = property['value'];
			if (!isNode(key) || !isNode(value) || value['type'] !== 'Identifier') continue;
			const from = property['computed'] === true ? undefined : key['name'];
			if (typeof from !== 'string' || typeof value['name'] !== 'string') continue;
			found.push([value['name'], `.${from}`]);
		}
		return found;
	}
	if (pattern['type'] === 'ArrayPattern') {
		const elements = Array.isArray(pattern['elements']) ? pattern['elements'] : [];
		for (const [at, element] of elements.entries()) {
			if (!isNode(element) || element['type'] !== 'Identifier') continue;
			if (typeof element['name'] !== 'string') continue;
			found.push([element['name'], `[${at}]`]);
		}
	}
	return found;
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

/**
 * A component's scripts, ready to be substituted into the expressions that use them.
 *
 * Substituting rather than evaluating is what makes a module constant and a constant reading
 * props one mechanism rather than two: `LIMIT` becomes `10` and `total` becomes `data.x * 2`,
 * and the second is a derivation for exactly the reason any other expression is. Nothing is run
 * at build time and nothing has to be serialisable. See spec/derivation.md.
 */
/** Where to write, and what to write there, so a render given no data does not evaluate it. */
export type Neutral = [[number, number], string];

/** One replacement in a source file: where it goes, and what goes there. */
export type Edit = [number, number, string];

/**
 * Applies replacements to source text, back to front so the offsets ahead stay valid.
 *
 * **Two edits over the same characters is not a case to resolve, it is a mistake upstream.** It
 * means one place in the file was recorded twice, and applying both writes the second into the
 * middle of the first; what comes out is a file nobody wrote, reported on by Svelte's compiler in
 * terms of the wreckage. That happened once, a destructuring declaring several names being
 * recorded once per name rather than once per place, and it surfaced as an undefined variable
 * naming nothing anybody could act on. So it is refused here instead.
 */
export function apply(text: string, edits: readonly Edit[], offset = 0): string {
	const ordered = [...edits].toSorted((a, b) => b[0] - a[0]);
	for (const [at, [start]] of ordered.entries()) {
		const next = ordered[at + 1];
		if (next !== undefined && next[1] > start) {
			throw new Error(`two edits cover ${next[0]}..${next[1]}, so one place was recorded twice`);
		}
	}

	let out = text;
	for (const [start, end, replacement] of ordered) {
		out = out.slice(0, start - offset) + replacement + out.slice(end - offset);
	}
	return out;
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
		reads(node, new Set(), (at) => {
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
			edits.push([from, to, `(${given ?? expand(name, open)})`]);
		});

		return apply(source.slice(start, end), edits, start);
	}

	function expand(name: string, open: ReadonlySet<string>): string {
		const cached = expanded.get(name);
		if (cached !== undefined && open.size === 0) return cached;
		const one = found.get(name);
		if (one === undefined) return name;
		if (one.literal !== undefined) return one.literal;
		// A name cannot stand in for itself. A cycle among declarations is the author's, and
		// leaving the name in place lets the pass that resolves names report it.
		const inner = new Set(open).add(name);
		const body = slice(one.node, inner);
		// Parenthesised because what follows it is a member access, and because a function or a
		// class only reads as an expression that way.
		const text = one.access === '' ? body : `(${body})${one.access}`;
		if (open.size === 0) expanded.set(name, text);
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

/** The props the component destructures, which are the names the data has to carry. */
function props(instance: unknown): Set<string> {
	const found = new Set<string>();
	if (!isNode(instance)) return found;
	const content = instance['content'];
	if (!isNode(content)) return found;
	const body = content['body'];
	if (!Array.isArray(body)) return found;

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		const declarations = statement['declarations'];
		if (!Array.isArray(declarations)) continue;
		for (const declaration of declarations) {
			if (!isNode(declaration)) continue;
			const init = declaration['init'];
			if (!isNode(init) || init['type'] !== 'CallExpression') continue;
			const callee = init['callee'];
			if (!isNode(callee) || callee['name'] !== '$props') continue;
			bound(declaration['id'], found);
		}
	}
	return found;
}

/**
 * An attribute the client owns and the server never writes. Its expression reads whatever the
 * component's own scope holds and none of it reaches the output, so it is not this pass's
 * business. Measured: a component carrying these renders bytes indistinguishable from one
 * without them. See spec/ir.md.
 */
function clientOnly(name: unknown): boolean {
	if (typeof name !== 'string') return false;
	return /^on[A-Z:a-z]/.test(name) && name.length > 2;
}

function report(
	expression: unknown,
	source: string,
	scope: ReadonlySet<string>,
	into: Unresolved[],
	carried?: Context,
): void {
	if (!isNode(expression)) return;
	const names = new Set<string>();
	free(expression, scope, names);

	const { start, end } = expression;
	const text = typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';

	for (const name of names) {
		if (GLOBALS.has(name)) continue;
		// An imported name is legal and gets bundled rather than looked up in the data. A
		// component is not one of these: it is composed at compile time and never a value here.
		if (carried?.known.get(name)?.from.endsWith('.svelte') === false) {
			carried.used.add(name);
			continue;
		}
		// A name the scripts declare is substituted rather than looked up, so by the time an
		// expression reaches the compiler it is gone. What is checked is what it expanded into.
		if (carried?.declares(name) === true) continue;
		into.push({ name, expression: text, reason: 'unknown' });
	}

	// A global on the list can still hold something that is not: `Math` is fine and
	// `Math.random` is a clock by another name.
	walkMembers(expression, (object, property) => {
		if (AMBIENT_MEMBERS[object]?.has(property) === true) {
			into.push({ name: `${object}.${property}`, expression: text, reason: 'ambient' });
		}
	});
}

function walkMembers(node: unknown, found: (object: string, property: string) => void): void {
	if (!isNode(node)) return;
	if (node['type'] === 'MemberExpression' && node['computed'] !== true) {
		const object = node['object'];
		const property = node['property'];
		if (
			isNode(object) &&
			object['type'] === 'Identifier' &&
			typeof object['name'] === 'string' &&
			isNode(property) &&
			typeof property['name'] === 'string'
		) {
			found(object['name'], property['name']);
		}
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) walkMembers(child, found);
		} else if (isNode(value)) {
			walkMembers(value, found);
		}
	}
}

function markup(
	node: unknown,
	source: string,
	scope: Set<string>,
	into: Unresolved[],
	carried: Context,
): void {
	if (!isNode(node)) return;
	const type = node['type'];

	if (type === 'ExpressionTag' || type === 'HtmlTag') {
		report(node['expression'], source, scope, into, carried);
		return;
	}

	// A `{@const}` binds for the rest of the block it sits in, so a fragment holding one is walked
	// with those names in scope. Its own initialiser is read in the scope before it, which is what
	// lets `{@const b = a + 1}` reach an `a` declared above and refuses one that reaches below.
	if (type === 'Fragment') {
		const nodes = Array.isArray(node['nodes']) ? node['nodes'] : [];
		const inner = new Set(scope);
		for (const child of nodes) {
			if (!isNode(child) || child['type'] !== 'ConstTag') {
				markup(child, source, inner, into, carried);
				continue;
			}
			const declaration = child['declaration'];
			const declarations = isNode(declaration) ? declaration['declarations'] : undefined;
			const one = Array.isArray(declarations) ? declarations[0] : undefined;
			if (!isNode(one)) continue;
			report(one['init'], source, inner, into, carried);
			bound(one['id'], inner);
		}
		return;
	}

	if (type === 'Attribute') {
		if (clientOnly(node['name'])) return;
		const value = node['value'];
		for (const part of Array.isArray(value) ? value : [value]) {
			markup(part, source, scope, into, carried);
		}
		return;
	}

	// Directives the client owns write nothing, so what they read is not this pass's business.
	if (
		type === 'OnDirective' ||
		type === 'UseDirective' ||
		type === 'TransitionDirective' ||
		type === 'AnimateDirective'
	) {
		return;
	}

	if (type === 'IfBlock') {
		report(node['test'], source, scope, into, carried);
		markup(node['consequent'], source, scope, into, carried);
		markup(node['alternate'], source, scope, into, carried);
		return;
	}

	if (type === 'SnippetBlock') {
		// The parameters are the block's own, bound for the extent of its body, which is the same
		// arrangement an each block has.
		const inner = new Set(scope);
		for (const parameter of Array.isArray(node['parameters']) ? node['parameters'] : []) {
			bound(parameter, inner);
		}
		markup(node['body'], source, inner, into, carried);
		return;
	}

	if (type === 'EachBlock') {
		report(node['expression'], source, scope, into, carried);
		const inner = new Set(scope);
		bound(node['context'], inner);
		const index = node['index'];
		if (typeof index === 'string') inner.add(index);
		markup(node['body'], source, inner, into, carried);
		markup(node['fallback'], source, scope, into, carried);
		return;
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) markup(child, source, scope, into, carried);
		} else if (isNode(value)) {
			markup(value, source, scope, into, carried);
		}
	}
}

/**
 * Where every name in the markup comes from: the ones that resolve to nothing, and the imported
 * ones that have to be bundled with it.
 *
 * An empty `unresolved` means each name is a prop, an each binding, an import, something the
 * expression bound itself, or one of the globals that reads the same everywhere.
 */
/**
 * Every snippet the markup declares, by name.
 *
 * A snippet is a name the component binds, and `{@render}` reads it, so it belongs in scope like
 * an each block's item. It is collected before the walk rather than during it, because a render
 * tag may be written above the snippet it names.
 */
function snippetNames(node: unknown, into: Set<string>): void {
	if (Array.isArray(node)) {
		for (const one of node) snippetNames(one, into);
		return;
	}
	if (!isNode(node)) return;
	if (node['type'] === 'SnippetBlock') {
		const id = node['expression'];
		if (isNode(id) && typeof id['name'] === 'string') into.add(id['name']);
	}
	for (const value of Object.values(node)) snippetNames(value, into);
}

export function bindings(source: string): Bindings {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const found: Unresolved[] = [];
	const declares = locals(source);
	const carried: Context = {
		known: imported(ast['instance']),
		used: new Set<string>(),
		declares: declares.has,
	};
	// A snippet's own name, and the names its parameters bind, are the component's rather than the
	// payload's. See spec/refusals.md.
	const scope = new Set(props(ast['instance']));
	snippetNames(ast['fragment'], scope);
	markup(ast['fragment'], source, scope, found, carried);
	const used = [...carried.used]
		.toSorted()
		.map((name) => carried.known.get(name))
		.filter((one): one is Carried => one !== undefined);
	return { unresolved: found, carried: used };
}
