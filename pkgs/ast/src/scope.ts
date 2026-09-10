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

	// A class field's or method's name is not a read: `class Foo { y = 1 }` names the field, and a
	// substitution written over it -- `class Foo { (2) = 1 }` -- is not JavaScript at all. Only a
	// computed key is an expression, the way it is on an object's property.
	if (type === 'PropertyDefinition' || type === 'MethodDefinition') {
		if (node['computed'] === true) reads(node['key'], scope, visit);
		reads(node['value'], scope, visit);
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

	// A block is a scope. What it declares shadows the same name outside it for every statement in
	// it, the ones above the declaration included, because `let` and `const` bind for the whole
	// block and a function declaration is hoisted to the top of it.
	//
	// Found by a substitution writing the wrong function body: `array.map((item) => { const bar =
	// baz; const foo = (item) => item * bar; return foo(item) })` beside a `const foo = (item) =>
	// item` in the script. Only a function's parameters were scoped, so `foo` in the return reached
	// past the block's own and the render wrote the script's.
	if (type === 'BlockStatement' || type === 'StaticBlock') {
		const body = Array.isArray(node['body']) ? node['body'] : [];
		const inner = new Set(scope);
		for (const one of body) declares(one, inner);
		for (const one of body) reads(one, inner, visit);
		return;
	}

	// A loop's head is a scope of its own, holding for the test, the update and the body.
	if (type === 'ForStatement' || type === 'ForInStatement' || type === 'ForOfStatement') {
		const inner = new Set(scope);
		declares(node['init'], inner);
		declares(node['left'], inner);
		for (const key of ['init', 'left', 'right', 'test', 'update', 'body']) {
			reads(node[key], inner, visit);
		}
		return;
	}

	// `catch (e)` binds its parameter for the block it holds and nowhere else.
	if (type === 'CatchClause') {
		const inner = new Set(scope);
		bound(node['param'], inner);
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
export const WRAPS: ReadonlySet<string> = new Set([
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
 * Whether a markup node declares rather than writes: `{@const}`, and `{const}`/`{let}`.
 *
 * `clean_nodes` in `3-transform/utils.js` lifts both out of a fragment's nodes into `hoisted`, and
 * their visitors push what they declare into the block's `init`, ahead of the template. So neither
 * writes bytes and both bind for the whole fragment.
 */
/** What one statement introduces into the scope of the block it sits in. */
function declares(statement: unknown, into: Set<string>): void {
	if (!isNode(statement)) return;
	const type = statement['type'];
	if (type === 'VariableDeclaration') {
		const declarations = statement['declarations'];
		if (!Array.isArray(declarations)) return;
		for (const one of declarations) if (isNode(one)) bound(one['id'], into);
		return;
	}
	if (type === 'FunctionDeclaration' || type === 'ClassDeclaration') bound(statement['id'], into);
}

export function declaring(node: unknown): boolean {
	if (!isNode(node)) return false;
	const type = node['type'];
	return type === 'ConstTag' || type === 'DeclarationTag';
}

/**
 * What such a tag binds, as id and initialiser pairs.
 *
 * `ConstTag.js` reads `node.declaration.declarations[0]` and the parser gives it exactly one.
 * `DeclarationTag.js` pushes the whole `VariableDeclaration` through, so it may declare several at
 * once. Empty where the node is not one this can read, which the caller reports in its own words.
 */
export function declaredBy(node: unknown): [unknown, unknown][] {
	if (!isNode(node)) return [];
	const declaration = node['declaration'];
	if (!isNode(declaration)) return [];
	const declarations = declaration['declarations'];
	if (!Array.isArray(declarations)) return [];
	const found: [unknown, unknown][] = [];
	for (const one of declarations) {
		if (!isNode(one)) return [];
		found.push([one['id'], one['init']]);
	}
	return found;
}

/**
 * Where the initialiser goes in the expression a destructured name reaches its value by. It stands
 * for the initialiser already parenthesised, so a template may follow it with a member or wrap it
 * in a call and neither has to know what the other did.
 */
export const INIT = '$$init$$';

/** One template with another put where its initialiser goes. */
export function within(template: string, inner: string): string {
	return template.split(INIT).join(inner);
}

/** Where an expression in the pattern's own scope goes, by its place in `slots`. */
export function SLOT(at: number): string {
	return `$$slot${String(at)}$$`;
}

/** A name a pattern binds, the expression that reaches it, and the nodes its slots stand for. */
export interface Destructured {
	name: string;
	/** A template over `INIT` and `SLOT(n)`. */
	reach: string;
	/** The nodes the slots stand for, which the caller expands as it expands the initialiser. */
	slots: readonly Node[];
}

/**
 * Every name a declaration's pattern binds, and the expression that reaches each one, written as a
 * template over `INIT`.
 *
 * Read forward out of `_extract_paths` in `compiler/utils/ast.js`, which answers the same question
 * for the client transform: a key is a member, a nesting is one way in after another, an object's
 * rest is `exclude_from_object(v, keys)` over every key the pattern named, and an array's rest is
 * `to_array(v).slice(n)`.
 *
 * **An array is read through `to_array` and not by index.** Destructuring uses the iterator
 * protocol -- Svelte's server writes plain JavaScript and lets the engine do it -- and `value[0]`
 * is the same answer for an array and no answer at all for anything else. `let [a, b] = src` over a
 * `Set` wrote nothing where Svelte wrote its two members, silently, which is what this is here to
 * stop. The count `_extract_paths` passes is left off, for the reason `takenApart` in `walk.ts`
 * gives: it caps an unbounded iterator through a `Symbol.iterator in value` test that throws on a
 * primitive.
 *
 * **A default and a computed key are expressions in the declaration's own scope**, and this template
 * is raw source that nothing expands names inside. So each goes in a slot: the template carries
 * `SLOT(n)` where it belongs and `slots[n]` is the node, which the caller expands the way it
 * expands the initialiser. `takenApart` writes them inline instead, because it is given the
 * expansion.
 */
/**
 * What a render is handed in place of an initialiser it cannot evaluate, shaped so the pattern
 * still comes apart at every level.
 *
 * `{}` is enough for `{ a }` and not for `{ o: { x } }`: the second level then destructures
 * `undefined` and the render throws where it used to be handed a value. A rest gathers nothing
 * from what this builds, which is what it should gather from a value nobody has.
 */
export function emptyFor(pattern: unknown): string {
	if (!isNode(pattern)) return 'null';
	const type = pattern['type'];
	if (type === 'AssignmentPattern') return emptyFor(pattern['left']);
	if (type === 'RestElement') return emptyFor(pattern['argument']);
	if (type === 'ObjectPattern') {
		const parts: string[] = [];
		for (const property of Array.isArray(pattern['properties']) ? pattern['properties'] : []) {
			if (!isNode(property) || property['type'] !== 'Property') continue;
			if (property['computed'] === true) continue;
			const key = property['key'];
			if (!isNode(key)) continue;
			const name =
				key['type'] === 'Identifier' && typeof key['name'] === 'string'
					? key['name']
					: key['type'] === 'Literal'
						? String(key['value'])
						: null;
			if (name === null) continue;
			parts.push(`${JSON.stringify(name)}: ${emptyFor(property['value'])}`);
		}
		return `{ ${parts.join(', ')} }`;
	}
	if (type === 'ArrayPattern') {
		const parts: string[] = [];
		for (const element of Array.isArray(pattern['elements']) ? pattern['elements'] : []) {
			if (isNode(element) && element['type'] === 'RestElement') break;
			parts.push(emptyFor(element));
		}
		return `[${parts.join(', ')}]`;
	}
	return 'null';
}

export function destructure(pattern: Node): Destructured[] {
	const found: Destructured[] = [];
	const slots: Node[] = [];
	const slot = (node: unknown): string => {
		if (!isNode(node)) return 'undefined';
		slots.push(node);
		return SLOT(slots.length - 1);
	};
	const one = (target: unknown, reached: string): void => {
		if (!isNode(target)) return;
		const type = target['type'];
		if (type === 'Identifier' && typeof target['name'] === 'string') {
			found.push({ name: target['name'], reach: reached, slots });
			return;
		}
		// A default is JavaScript's own choice, which `build_fallback` writes the same way: the
		// member where it is not `undefined`, and the default where it is. `null` is not defaulted.
		if (type === 'AssignmentPattern') {
			one(target['left'], `(${reached} === undefined ? (${slot(target['right'])}) : ${reached})`);
			return;
		}
		if (type === 'ObjectPattern') {
			// The keys a rest leaves out, in the order Svelte writes them: a plain name as itself, a
			// literal as its value read as a string, and a computed key as `String(...)` of the
			// expression, which evaluates it a second time.
			const taken: string[] = [];
			for (const property of Array.isArray(target['properties']) ? target['properties'] : []) {
				if (!isNode(property)) continue;
				if (property['type'] === 'RestElement') {
					one(property['argument'], `$$exclude_from_object(${reached}, [${taken.join(', ')}])`);
					continue;
				}
				if (property['type'] !== 'Property') continue;
				const key = property['key'];
				if (!isNode(key)) return;
				if (property['computed'] === true) {
					const held = slot(key);
					taken.push(`String(${held})`);
					one(property['value'], `${reached}[${held}]`);
					continue;
				}
				if (key['type'] === 'Identifier' && typeof key['name'] === 'string') {
					taken.push(JSON.stringify(key['name']));
					one(property['value'], `${reached}.${key['name']}`);
					continue;
				}
				if (key['type'] !== 'Literal') return;
				taken.push(JSON.stringify(String(key['value'])));
				one(property['value'], `${reached}[${JSON.stringify(String(key['value']))}]`);
			}
			return;
		}
		if (type === 'ArrayPattern') {
			const elements = Array.isArray(target['elements']) ? target['elements'] : [];
			// The count `_extract_paths` passes, and what it is for: `to_array` caps an unbounded
			// iterable at `n` rather than exhausting it, and `let [one, two] = infinite()` is a
			// declaration a real component writes. It is passed only where the pattern has no rest,
			// which is the same test `_extract_paths` makes -- a rest wants everything, so there is
			// no count to cap at.
			const rest = elements.some((each) => isNode(each) && each['type'] === 'RestElement');
			const listed = rest
				? `$$to_array(${reached})`
				: `$$to_array(${reached}, ${String(elements.length)})`;
			for (const [at, element] of elements.entries()) {
				if (!isNode(element)) continue;
				if (element['type'] === 'RestElement') {
					one(element['argument'], `${listed}.slice(${String(at)})`);
					continue;
				}
				one(element, `${listed}[${String(at)}]`);
			}
			return;
		}
		// Anything else: the name goes unrecorded and the pass that resolves names reports it rather
		// than this pass guessing at it.
	};
	one(pattern, INIT);
	return found;
}

/**
 * The props the component takes, which are the names the data has to carry: what `$props()`
 * destructures, and Svelte 4's `export let` and `export { x as y }`.
 *
 * The legacy spellings were missing, and what depends on this is whether a declaration reading one
 * is neutralised for the render. `export let n; const twice = n.v * 2` was not, so the render --
 * which is given no props -- evaluated `undefined.v` and threw a `TypeError` naming nothing, which
 * is the crash the neutralisation exists to prevent.
 */
export function props(instance: unknown): Set<string> {
	const found = new Set<string>();
	if (!isNode(instance)) return found;
	const content = instance['content'];
	if (!isNode(content)) return found;
	const body = content['body'];
	if (!Array.isArray(body)) return found;

	for (const statement of body) {
		if (!isNode(statement)) continue;
		// Svelte 4's spelling: `export let x` and `export var x` are props, and `export { x as y }`
		// makes one of a `let` declared above. `export const` is not -- it is a readonly export,
		// which `transform-server.js` sends up to a caller rather than takes from one. The names
		// wanted here are the locals, because that is what an expression in this file reads.
		if (statement['type'] === 'ExportNamedDeclaration') {
			const declaration = statement['declaration'];
			if (
				isNode(declaration) &&
				declaration['type'] === 'VariableDeclaration' &&
				declaration['kind'] !== 'const'
			) {
				for (const one of Array.isArray(declaration['declarations'])
					? declaration['declarations']
					: []) {
					if (isNode(one)) bound(one['id'], found);
				}
			}
			for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
				if (!isNode(one)) continue;
				const local = one['local'];
				if (isNode(local) && typeof local['name'] === 'string') found.add(local['name']);
			}
			continue;
		}
		if (statement['type'] !== 'VariableDeclaration') continue;
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

/** Kit's module a component reads the request's `page` from. */
export const APP_STATE = '$app/state';

/**
 * What the two constants of `$app/state` hold on a server, spelled as Kit's server module spells
 * them: nothing is navigating and nothing has updated while the bytes are written.
 */
export const STATE_ON_SERVER: Readonly<Record<string, string>> = {
	navigating:
		'({ from: null, to: null, type: null, willUnload: null, delta: null, complete: null })',
	updated: '({ current: false })',
};

/**
 * What the instance script imports from `$app/state`, by the local name, with the export each is.
 *
 * `page` is the request's: Kit's server module reads it out of the component context, where
 * `render_response` put the one object it built for the request, and the root component takes the
 * same object as a prop. So a component reading `page` reads the payload, whichever level of the
 * tree it sits at, and the walk binds it to the root's prop of that name. See spec/framework.md.
 */
export function stateImports(instance: unknown): Map<string, string> {
	const found = new Map<string, string>();
	if (!isNode(instance)) return found;
	const content = instance['content'];
	if (!isNode(content)) return found;
	const body = content['body'];
	if (!Array.isArray(body)) return found;
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		const from = statement['source'];
		if (!isNode(from) || from['value'] !== APP_STATE) continue;
		for (const specifier of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
			if (!isNode(specifier) || specifier['type'] !== 'ImportSpecifier') continue;
			const local = specifier['local'];
			const imported = specifier['imported'];
			if (!isNode(local) || typeof local['name'] !== 'string') continue;
			if (!isNode(imported) || typeof imported['name'] !== 'string') continue;
			found.set(local['name'], imported['name']);
		}
	}
	return found;
}

/**
 * The names the request decides in a component: what its `$props()` destructures, and the `page`
 * it imports from `$app/state`, which is a prop of the root by another route.
 */
export function requested(instance: unknown): Set<string> {
	const found = props(instance);
	for (const [local, exported] of stateImports(instance)) {
		if (exported === 'page') found.add(local);
	}
	return found;
}
