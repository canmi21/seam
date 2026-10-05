/**
 * A component whose script throws at its top, every time it renders: not entered, and standing at
 * its call site as a hole that throws the same thing per request. See spec/ir.md, "A component
 * that throws whatever the request is a hole that throws".
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse } from 'svelte/compiler';
import { bound as namesBound, projectDevelopment, reads } from '@seam-js/ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { sentinel } from './sentinel.ts';
import { type Walk } from './walk-types.ts';

/**
 * The argument of the first `throw` standing directly in a component's instance script, as source
 * -- the statement runs whenever the component renders, whatever it is handed -- or null where
 * there is none. A `throw` inside an `if`, a function or a block is the request's question and is
 * not this.
 */
export function throwsAtTop(file: string): { argument: string } | null {
	let source: string;
	let ast: AstNode;
	try {
		source = readFileSync(file, 'utf8');
		ast = parse(source, { modern: true }) as unknown as AstNode;
	} catch {
		return null;
	}
	const content = isNode(ast['instance']) ? ast['instance']['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const known = kitConstants(body);
	const statement = body
		.map((one) => (isNode(one) ? taken(one, known) : null))
		.find((one) => isNode(one) && one['type'] === 'ThrowStatement');
	if (!isNode(statement)) return null;
	const argument = statement['argument'];
	const at = span(argument);
	if (at === null) return null;

	// The argument is evaluated at the call site, where the component's own names are not: one it
	// reads is refused rather than read wrongly. `new Error('...')` reads none.
	const own = new Set<string>();
	for (const block of [ast['module'], ast['instance']]) {
		const inner = isNode(block) ? block['content'] : undefined;
		const statements = isNode(inner) && Array.isArray(inner['body']) ? inner['body'] : [];
		for (const one of statements) declaredIn(one, own);
	}
	const named: string[] = [];
	reads(argument, new Set(), (one) => {
		const name = one['name'];
		if (typeof name === 'string' && own.has(name)) named.push(name);
	});
	if (named.length > 0) {
		refuse(
			`${basename(file)} throws at the top of its script, whatever it is handed, with a value ` +
				`that reads ${named.map((one) => `\`${one}\``).join(', ')} from its own script. The ` +
				'throw is made again per request where the component is called, and its own names are ' +
				'not there. Throw a value that reads none of them. See spec/ir.md',
		);
	}
	return { argument: source.slice(at[0], at[1]) };
}

/**
 * Kit's constants a script imports, by the local name, with the value the compile knows them to
 * have: `dev` is whether the dev server is compiling, and `browser` is false on a server. See
 * spec/build.md, "The dev server compiles a route when it is asked for".
 */
function kitConstants(body: readonly unknown[]): Map<string, boolean> {
	const found = new Map<string, boolean>();
	for (const one of body) {
		if (!isNode(one) || one['type'] !== 'ImportDeclaration') continue;
		const from = isNode(one['source']) ? one['source']['value'] : undefined;
		if (from !== '$app/environment' && from !== '$app/env') continue;
		for (const specifier of Array.isArray(one['specifiers']) ? one['specifiers'] : []) {
			if (!isNode(specifier) || specifier['type'] !== 'ImportSpecifier') continue;
			const imported = isNode(specifier['imported']) ? specifier['imported']['name'] : undefined;
			const local = isNode(specifier['local']) ? specifier['local']['name'] : undefined;
			if (typeof local !== 'string') continue;
			if (imported === 'dev') found.set(local, projectDevelopment() !== null);
			else if (imported === 'browser') found.set(local, false);
		}
	}
	return found;
}

/**
 * A top-level statement as it runs: an `if` whose test is one of those constants, or its negation,
 * is the branch that test takes -- the statement itself where the branch is a single one, or the
 * only statement of its block -- and any other statement is itself.
 */
function taken(statement: AstNode, known: ReadonlyMap<string, boolean>): unknown {
	if (statement['type'] !== 'IfStatement') return statement;
	let test = statement['test'];
	let negated = false;
	if (isNode(test) && test['type'] === 'UnaryExpression' && test['operator'] === '!') {
		negated = true;
		test = test['argument'];
	}
	const name = isNode(test) && test['type'] === 'Identifier' ? test['name'] : undefined;
	const value = typeof name === 'string' ? known.get(name) : undefined;
	if (value === undefined) return statement;
	const branch = value !== negated ? statement['consequent'] : statement['alternate'];
	if (!isNode(branch)) return null;
	if (branch['type'] !== 'BlockStatement') return branch;
	const inner = Array.isArray(branch['body']) ? branch['body'] : [];
	return inner.length === 1 ? inner[0] : null;
}

/** What one top-level statement binds: an import's locals, a declaration's names. */
function declaredIn(statement: unknown, into: Set<string>): void {
	if (!isNode(statement)) return;
	const type = statement['type'];
	if (type === 'ImportDeclaration') {
		for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
			const local = isNode(one) ? one['local'] : undefined;
			if (isNode(local) && typeof local['name'] === 'string') into.add(local['name']);
		}
		return;
	}
	if (type === 'ExportNamedDeclaration') {
		declaredIn(statement['declaration'], into);
		return;
	}
	if (type === 'VariableDeclaration') {
		const declarations = Array.isArray(statement['declarations']) ? statement['declarations'] : [];
		for (const one of declarations) if (isNode(one)) namesBound(one['id'], into);
		return;
	}
	if (type === 'FunctionDeclaration' || type === 'ClassDeclaration') {
		namesBound(statement['id'], into);
	}
}

/**
 * The call site of a component that throws, as one hole whose value throws what the component
 * throws. It writes nothing that reaches the bytes: Kit's root puts every level inside a boundary,
 * whose run reads the hole inside its catch and takes the `failed` branch every request, which is
 * what the component's render does in Svelte. Guarded where the walk guards, so that the branch
 * written for nothing having thrown, which no request takes, evaluates nothing.
 */
export function plantThrow(node: AstNode, walk: Walk, argument: string): void {
	const at = span(node);
	if (at === null) return;
	const index = walk.holes.length;
	const text = `$$rethrow(() => (${argument}))`;
	walk.holes.push({
		index,
		expression: walk.trying === undefined ? text : walk.trying(text),
		raw: false,
	});
	walk.edits.push([at[0], at[1], `{${JSON.stringify(sentinel(index))}}`]);
}
