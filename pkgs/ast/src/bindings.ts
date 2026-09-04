import { parse } from 'svelte/compiler';
import { locals } from './locals.ts';
import { bound, free, isNode, type Node, props } from './scope.ts';

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
