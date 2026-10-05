/**
 * An expression with every name it reads from outside itself written as what that name means, decided
 * when the program is written rather than looked up while it runs. See spec/derivation.md, "A name
 * is resolved when the program is written".
 */
import { parseExpressionAt } from 'acorn';

type Node = Record<string, unknown> & { type: string; start: number; end: number };

const isNode = (value: unknown): value is Node =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as { type?: unknown }).type === 'string';

/** What a name read at one place is written as, or null to leave it as the author wrote it. */
export type Resolve = (name: string, bound: ReadonlySet<string>) => string | null;

/** What `typeof name` is written as, whole, or null to leave it as the author wrote it. */
export type ResolveTypeOf = (name: string, bound: ReadonlySet<string>) => string | null;

/**
 * A call the caller writes whole, rather than having its parts rewritten: `$$within(...)`, whose
 * code is a string literal naming another file's names. Null to rewrite it as any call.
 */
export type Whole = (call: Node, bound: ReadonlySet<string>, source: string) => string | null;

/** The expression parsed, with what it reads rewritten. Throws where it does not parse. */
export function rewritten(
	source: string,
	resolve: Resolve,
	whole: Whole = () => null,
	typeOf?: ResolveTypeOf,
): string {
	return rewrittenWithin(source, parsedExpression(source), new Set(), resolve, whole, typeOf);
}

/** The text of a node of `source`, its own names rewritten, for a caller writing a call whole. */
export function rewrittenWithin(
	source: string,
	node: Node,
	bound: ReadonlySet<string>,
	resolve: Resolve,
	whole: Whole = () => null,
	typeOf?: ResolveTypeOf,
): string {
	const edits: [number, number, string][] = [];
	visit(node, bound, {
		name: (at, inner, shorthand) => {
			const name = at['name'] as string;
			const written = resolve(name, inner);
			if (written === null) return;
			edits.push([at.start, at.end, shorthand ? `${name}: ${written}` : written]);
		},
		typeOf: (at, inner) => {
			// `typeof window` over a name nothing holds is `'undefined'`, where any other read of it
			// throws, so the caller may write the whole of it rather than the name alone.
			const argument = at['argument'] as Node;
			const name = argument['name'] as string;
			if (typeOf !== undefined) {
				const written = typeOf(name, inner);
				if (written !== null) edits.push([at.start, at.end, written]);
				return;
			}
			const written = resolve(name, inner);
			if (written === null) return;
			edits.push([argument.start, argument.end, `(${written})`]);
		},
		whole: (call, inner) => {
			const written = whole(call, inner, source);
			if (written === null) return false;
			edits.push([call.start, call.end, written]);
			return true;
		},
	});
	return applied(source.slice(node.start, node.end), edits, node.start);
}

/** Parsed as one expression, a top-level `await` allowed: a derivation in async mode holds one. */
export function parsedExpression(source: string): Node {
	const tree = parseExpressionAt(source, 0, {
		ecmaVersion: 'latest',
		sourceType: 'script',
		allowAwaitOutsideFunction: true,
		// A parenthesised expression keeps its parentheses, so the tree ends where the text does.
		preserveParens: true,
	}) as unknown as Node;
	const rest = source.slice(tree.end);
	// A block comment ends at its first `*/` and cannot reach past it, so the text has one reading;
	// a lazy `[\s\S]*?` could, and comments run together took exponential time.
	if (!/^(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*(?:\n|$))*$/.test(rest)) {
		throw new SyntaxError(`more than one expression in \`${source}\``);
	}
	return tree;
}

function applied(source: string, edits: [number, number, string][], offset = 0): string {
	let out = '';
	let at = offset;
	for (const [start, end, text] of edits.toSorted((a, b) => a[0] - b[0])) {
		out += source.slice(at - offset, start - offset) + text;
		at = end;
	}
	return out + source.slice(at - offset);
}

interface Visitor {
	/** A name read, with what is bound around it and whether it is a shorthand property too. */
	name: (at: Node, bound: ReadonlySet<string>, shorthand: boolean) => void;
	/** `typeof name`, which reads a name that may hold nothing without throwing. */
	typeOf: (at: Node, bound: ReadonlySet<string>) => void;
	/** A call the caller may write whole; true where it did, and the call is not descended into. */
	whole: (call: Node, bound: ReadonlySet<string>) => boolean;
}

/** Every name a binding pattern introduces. */
function bind(pattern: unknown, into: Set<string>): void {
	if (!isNode(pattern)) return;
	switch (pattern.type) {
		case 'Identifier':
			into.add(pattern['name'] as string);
			return;
		case 'ObjectPattern':
			for (const one of pattern['properties'] as Node[]) {
				bind(one.type === 'RestElement' ? one['argument'] : one['value'], into);
			}
			return;
		case 'ArrayPattern':
			for (const one of pattern['elements'] as unknown[]) bind(one, into);
			return;
		case 'AssignmentPattern':
			bind(pattern['left'], into);
			return;
		case 'RestElement':
			bind(pattern['argument'], into);
			return;
		default:
			return;
	}
}

/** What a pattern reads: a default's value and a computed key, and nothing it binds. */
function patternReads(pattern: unknown, bound: ReadonlySet<string>, visitor: Visitor): void {
	if (!isNode(pattern)) return;
	switch (pattern.type) {
		case 'ObjectPattern':
			for (const one of pattern['properties'] as Node[]) {
				if (one.type === 'RestElement') {
					patternReads(one['argument'], bound, visitor);
					continue;
				}
				if (one['computed'] === true) visit(one['key'], bound, visitor);
				patternReads(one['value'], bound, visitor);
			}
			return;
		case 'ArrayPattern':
			for (const one of pattern['elements'] as unknown[]) patternReads(one, bound, visitor);
			return;
		case 'AssignmentPattern':
			patternReads(pattern['left'], bound, visitor);
			visit(pattern['right'], bound, visitor);
			return;
		case 'RestElement':
			patternReads(pattern['argument'], bound, visitor);
			return;
		case 'MemberExpression':
			// A destructuring assignment may write into a member, whose object is read.
			visit(pattern, bound, visitor);
			return;
		default:
			return;
	}
}

/** What one statement declares into the block it sits in, hoisted to the block's top. */
function declares(statement: unknown, into: Set<string>): void {
	if (!isNode(statement)) return;
	if (statement.type === 'VariableDeclaration') {
		for (const one of statement['declarations'] as Node[]) bind(one['id'], into);
		return;
	}
	if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
		bind(statement['id'], into);
		return;
	}
	if (
		(statement.type === 'ExportNamedDeclaration' || statement.type === 'LabeledStatement') &&
		isNode(statement['declaration'] ?? statement['body'])
	) {
		declares(statement['declaration'] ?? statement['body'], into);
	}
}

const SKIPPED = new Set(['type', 'start', 'end', 'loc', 'range']);

function children(node: Node, bound: ReadonlySet<string>, visitor: Visitor): void {
	for (const [key, value] of Object.entries(node)) {
		if (SKIPPED.has(key)) continue;
		if (Array.isArray(value)) {
			for (const one of value) visit(one, bound, visitor);
		} else if (isNode(value)) {
			visit(value, bound, visitor);
		}
	}
}

function functionBody(node: Node, bound: ReadonlySet<string>, visitor: Visitor): void {
	const inner = new Set(bound);
	// A named function expression's name is bound inside it, for a call of itself.
	if (node.type === 'FunctionExpression') bind(node['id'], inner);
	for (const param of node['params'] as unknown[]) bind(param, inner);
	if (node.type !== 'ArrowFunctionExpression') inner.add('arguments');
	for (const param of node['params'] as unknown[]) patternReads(param, inner, visitor);
	visit(node['body'], inner, visitor);
}

function visit(node: unknown, bound: ReadonlySet<string>, visitor: Visitor): void {
	if (!isNode(node)) return;
	switch (node.type) {
		case 'Identifier': {
			const name = node['name'] as string;
			if (!bound.has(name)) visitor.name(node, bound, false);
			return;
		}
		case 'ThisExpression':
		case 'Super':
		case 'MetaProperty':
		case 'Literal':
		case 'TemplateElement':
		case 'PrivateIdentifier':
		case 'EmptyStatement':
		case 'DebuggerStatement':
			return;
		case 'MemberExpression':
			visit(node['object'], bound, visitor);
			if (node['computed'] === true) visit(node['property'], bound, visitor);
			return;
		case 'Property': {
			if (node['computed'] === true) visit(node['key'], bound, visitor);
			const value = node['value'];
			if (node['shorthand'] === true && isNode(value) && value.type === 'Identifier') {
				const name = value['name'] as string;
				if (!bound.has(name)) visitor.name(value, bound, true);
				return;
			}
			visit(value, bound, visitor);
			return;
		}
		case 'PropertyDefinition':
		case 'MethodDefinition':
			if (node['computed'] === true) visit(node['key'], bound, visitor);
			visit(node['value'], bound, visitor);
			return;
		case 'ArrowFunctionExpression':
		case 'FunctionExpression':
			functionBody(node, bound, visitor);
			return;
		case 'FunctionDeclaration':
			functionBody(node, bound, visitor);
			return;
		case 'ClassExpression':
		case 'ClassDeclaration': {
			const inner = new Set(bound);
			bind(node['id'], inner);
			visit(node['superClass'], bound, visitor);
			visit(node['body'], inner, visitor);
			return;
		}
		case 'BlockStatement':
		case 'StaticBlock':
		case 'Program': {
			const inner = new Set(bound);
			for (const one of node['body'] as unknown[]) declares(one, inner);
			for (const one of node['body'] as unknown[]) visit(one, inner, visitor);
			return;
		}
		case 'SwitchStatement': {
			visit(node['discriminant'], bound, visitor);
			const inner = new Set(bound);
			for (const one of node['cases'] as Node[]) {
				for (const statement of one['consequent'] as unknown[]) declares(statement, inner);
			}
			for (const one of node['cases'] as Node[]) {
				visit(one['test'], inner, visitor);
				for (const statement of one['consequent'] as unknown[]) visit(statement, inner, visitor);
			}
			return;
		}
		case 'ForStatement':
		case 'ForInStatement':
		case 'ForOfStatement': {
			const inner = new Set(bound);
			declares(node['init'], inner);
			declares(node['left'], inner);
			for (const key of ['init', 'left', 'right', 'test', 'update', 'body']) {
				const one = node[key];
				if (key === 'left' && isNode(one) && one.type !== 'VariableDeclaration') {
					patternReads(one, inner, visitor);
					continue;
				}
				visit(one, inner, visitor);
			}
			return;
		}
		case 'CatchClause': {
			const inner = new Set(bound);
			bind(node['param'], inner);
			patternReads(node['param'], inner, visitor);
			visit(node['body'], inner, visitor);
			return;
		}
		case 'VariableDeclaration':
			for (const one of node['declarations'] as Node[]) {
				patternReads(one['id'], bound, visitor);
				visit(one['init'], bound, visitor);
			}
			return;
		case 'AssignmentExpression': {
			const left = node['left'];
			// A name written is not read, and is left as the author wrote it.
			if (isNode(left) && left.type !== 'Identifier') {
				if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
					patternReads(left, bound, visitor);
				} else {
					visit(left, bound, visitor);
				}
			}
			visit(node['right'], bound, visitor);
			return;
		}
		case 'UpdateExpression': {
			const argument = node['argument'];
			if (isNode(argument) && argument.type !== 'Identifier') visit(argument, bound, visitor);
			return;
		}
		case 'UnaryExpression': {
			const argument = node['argument'];
			if (
				node['operator'] === 'typeof' &&
				isNode(argument) &&
				argument.type === 'Identifier' &&
				!bound.has(argument['name'] as string)
			) {
				visitor.typeOf(node, bound);
				return;
			}
			visit(argument, bound, visitor);
			return;
		}
		case 'LabeledStatement':
			visit(node['body'], bound, visitor);
			return;
		case 'BreakStatement':
		case 'ContinueStatement':
			return;
		case 'CallExpression':
			if (visitor.whole(node, bound)) return;
			children(node, bound, visitor);
			return;
		default:
			children(node, bound, visitor);
	}
}

/**
 * Whether an expression calls or constructs anything outside a function it defines: what makes
 * computing it at every read cost what computing it once does not.
 */
export function computes(source: string): boolean {
	let found = false;
	const look = (node: unknown): void => {
		if (found || !isNode(node)) return;
		if (node.type === 'CallExpression' || node.type === 'NewExpression') {
			found = true;
			return;
		}
		if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return;
		for (const [key, value] of Object.entries(node)) {
			if (SKIPPED.has(key)) continue;
			if (Array.isArray(value)) for (const one of value) look(one);
			else look(value);
		}
	};
	look(parsedExpression(source));
	return found;
}

export type { Node };
