/**
 * Reading a script's scope: what a pattern binds, and which names an expression reaches out for.
 *
 * Shared by the two passes over a component's scripts, which ask opposite questions of the same
 * shapes. `locals.ts` asks what each declared name stands for so it can be substituted; the report
 * in `bindings.ts` asks which names are left over once everything declared is accounted for. Both
 * need one answer to "what does this pattern bind" and one to "what does this expression read",
 * and having two would be two chances to disagree.
 */

export type Node = Record<string, unknown>;

export function isNode(value: unknown): value is Node {
	return typeof value === 'object' && value !== null;
}

/** Every name a binding pattern introduces: `{ a, b: c }`, `[d]`, `...rest`, `e = 1`. */
export function bound(pattern: unknown, into: Set<string>): void {
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
export function reads(
	node: unknown,
	scope: ReadonlySet<string>,
	/**
	 * Called with each name read, and with whether it is a shorthand property's key and value at
	 * once -- which decides whether writing over it takes the key with it.
	 */
	visit: (at: Node, shorthand?: boolean) => void,
): void {
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
		// A shorthand property is one node standing as both key and value, so writing over it in
		// place takes the key with it: `{ locale }` became `{ (data.locale.code) }`, which is not
		// JavaScript at all. The third time this shape has been met -- an attribute's `{n}` and a
		// `{@const}` were the others -- and the answer is the same one: write the name back out.
		if (node['shorthand'] === true) {
			reads(node['value'], scope, (at) => {
				visit(at, true);
			});
			return;
		}
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

	// A name written to is not read: `open = false` in a handler holds nothing of `open`, and a
	// substitution written over it -- `(false) = false` -- is not JavaScript at all. The value
	// assigned is read; a member written to reads its object.
	if (type === 'AssignmentExpression') {
		const left = node['left'];
		if (isNode(left) && left['type'] !== 'Identifier') reads(left, scope, visit);
		reads(node['right'], scope, visit);
		return;
	}
	if (type === 'UpdateExpression') {
		const argument = node['argument'];
		if (isNode(argument) && argument['type'] !== 'Identifier') reads(argument, scope, visit);
		return;
	}

	// A type is not a read. `x as keyof typeof T` reads `x` and names `T` in a position that
	// only the type checker looks at -- and a substitution written there is not TypeScript at
	// all, which is how `SUMMARY_PROVIDERS[p as keyof typeof SUMMARY_PROVIDERS]` came to expand
	// into `typeof ({ ... })` and stop parsing. The wrappers keep their expression; a type
	// annotation, argument or parameter keeps nothing.
	if (typeof type === 'string' && type.startsWith('TS')) {
		if (WRAPS.has(type)) reads(node['expression'], scope, visit);
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

/** The TypeScript nodes that wrap an expression, as against the ones that are types. */
const WRAPS: ReadonlySet<string> = new Set([
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSTypeAssertion',
	'TSInstantiationExpression',
]);

/**
 * Every member chain of plain names in an expression, with where it sits and what it spells.
 *
 * `data.locale.code` is one chain of three names. A computed member or a call anywhere in it stops
 * the chain, because what it reads is then not a name -- `a[i].b` spells nothing this can compare.
 * The visitor is given the base identifier separately, since what the base stands for depends on
 * the scope the expression is being read in and only the caller knows that.
 *
 * A chain that matches is not descended into, so the base identifier inside it is not also
 * reported: two edits over the same characters is a mistake upstream rather than a case to resolve.
 */
export function chains(
	node: unknown,
	visit: (at: [number, number], base: Node, rest: readonly string[]) => boolean,
): void {
	if (Array.isArray(node)) {
		for (const one of node) chains(one, visit);
		return;
	}
	if (!isNode(node)) return;
	// A type is not a chain either. See `reads`.
	const type = node['type'];
	if (typeof type === 'string' && type.startsWith('TS')) {
		if (WRAPS.has(type)) chains(node['expression'], visit);
		return;
	}

	if (node['type'] === 'MemberExpression') {
		const rest: string[] = [];
		let at: unknown = node;
		while (isNode(at) && at['type'] === 'MemberExpression') {
			const property = at['property'];
			if (at['computed'] === true || !isNode(property) || typeof property['name'] !== 'string') {
				at = null;
				break;
			}
			rest.unshift(property['name']);
			at = at['object'];
		}
		if (isNode(at) && at['type'] === 'Identifier') {
			const start = node['start'];
			const end = node['end'];
			if (typeof start === 'number' && typeof end === 'number' && visit([start, end], at, rest)) {
				return;
			}
		}
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) chains(child, visit);
		} else if (isNode(value)) {
			chains(value, visit);
		}
	}
}

/** The names an expression reads from outside itself. */
export function free(node: unknown, scope: ReadonlySet<string>, into: Set<string>): void {
	reads(node, scope, (at) => {
		const name = at['name'];
		if (typeof name === 'string') into.add(name);
	});
}

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

/** The props the component destructures, which are the names the data has to carry. */
export function props(instance: unknown): Set<string> {
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
