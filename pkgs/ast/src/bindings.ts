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
function free(node: unknown, scope: ReadonlySet<string>, into: Set<string>): void {
	if (!isNode(node)) return;
	const type = node['type'];

	if (type === 'Identifier') {
		const name = node['name'];
		if (typeof name === 'string' && !scope.has(name)) into.add(name);
		return;
	}

	if (type === 'MemberExpression') {
		free(node['object'], scope, into);
		if (node['computed'] === true) free(node['property'], scope, into);
		return;
	}

	if (type === 'Property') {
		if (node['computed'] === true) free(node['key'], scope, into);
		free(node['value'], scope, into);
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
		free(node['body'], inner, into);
		return;
	}

	if (type === 'VariableDeclarator') {
		// The name is introduced here rather than read, but its initialiser is read in the scope
		// that existed before it.
		free(node['init'], scope, into);
		return;
	}

	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) free(child, scope, into);
		} else if (isNode(value)) {
			free(value, scope, into);
		}
	}
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
	carried?: { known: ReadonlyMap<string, Carried>; used: Set<string> },
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
	carried: { known: ReadonlyMap<string, Carried>; used: Set<string> },
): void {
	if (!isNode(node)) return;
	const type = node['type'];

	if (type === 'ExpressionTag' || type === 'HtmlTag') {
		report(node['expression'], source, scope, into, carried);
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
export function bindings(source: string): Bindings {
	const ast = parse(source, { modern: true }) as unknown as Node;
	const found: Unresolved[] = [];
	const carried = { known: imported(ast['instance']), used: new Set<string>() };
	markup(ast['fragment'], source, props(ast['instance']), found, carried);
	const used = [...carried.used]
		.toSorted()
		.map((name) => carried.known.get(name))
		.filter((one): one is Carried => one !== undefined);
	return { unresolved: found, carried: used };
}
