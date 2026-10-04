/**
 * A component whose script throws at its top, every time it renders: not entered, and standing at
 * its call site as a hole that throws the same thing per request. See spec/ir.md, "A component
 * that throws whatever the request is a hole that throws".
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parse } from 'svelte/compiler';
import { bound as namesBound, reads } from '@seam-js/ast';
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
	const statement = body.find((one) => isNode(one) && one['type'] === 'ThrowStatement');
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
