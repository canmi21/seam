/**
 * What a walk keeps back from the render: the declarations it withholds and why, the memo of them,
 * and the callees a script reaches. See spec/derivation.md.
 */
import type { Neutral } from './edits.ts';
import { isNode, type Node } from './scope.ts';
import { writes } from './declarations.ts';
import { trees } from './expressions.ts';
import { type Declared } from './locals-types.ts';

/** How many trees the two memos above hold, which is what a compile trades memory for. */
export function remembered(): { expressions: number; components: number } {
	return { expressions: trees.size, components: 0 };
}

/** Why a name a withheld statement assigns cannot be substituted. See `withheld()`. */
function withheldBecause(name: string): string {
	return (
		`\`${name}\` is assigned by a statement that calls what the request decides, and the markup ` +
		'reads a name by the expression it was declared to be, which stops being what the name holds. ' +
		'Compute the value in one expression, or move the call out of the script. See spec/derivation.md'
	);
}

/**
 * The instance script's statements that call into what the render no longer computes, written over
 * for the render, and the names they assign added to what it no longer computes -- to a fixed point,
 * since each one withheld may stop another.
 *
 * A function is tainted where it reads a neutralised name or calls a tainted function, and a
 * statement is withheld where it calls one outside a function of its own: a declaration over its
 * initialiser, as a neutralised declaration is, and anything else whole. What is left runs as it
 * did, which is what keeps a `setContext` over a constant in the render that has the context.
 */
export function withheld(
	ast: Node,
	found: Map<string, Declared & { node: Node; free: Set<string> }>,
	reading: Neutral[],
	gone: Set<string>,
	changed: Map<string, string>,
): void {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const overlaps = (from: number, to: number): boolean =>
		reading.some(([[a, b]]) => from < b && a < to);
	for (let moved = true; moved;) {
		moved = false;
		const tainted = new Set(gone);
		for (let grew = true; grew;) {
			grew = false;
			for (const [name, one] of found) {
				if (tainted.has(name)) continue;
				const kind = one.node['type'];
				const callable =
					kind === 'FunctionDeclaration' ||
					kind === 'FunctionExpression' ||
					kind === 'ArrowFunctionExpression';
				if (callable && [...one.free].some((each) => tainted.has(each))) {
					tainted.add(name);
					grew = true;
				}
			}
		}
		const spans = reading.map(([at]) => at);
		for (const one of found.values()) {
			if (gone.has(one.name) || overlaps(one.at[0], one.at[1])) continue;
			const calls = callees(one.node, spans);
			if (![...calls].some((each) => tainted.has(each))) continue;
			reading.push([one.at, one.holds]);
			gone.add(one.name);
			if (!changed.has(one.name)) changed.set(one.name, withheldBecause(one.name));
			moved = true;
		}
		for (const statement of body) {
			if (!isNode(statement)) continue;
			const type = statement['type'];
			if (
				type === 'FunctionDeclaration' ||
				type === 'VariableDeclaration' ||
				type === 'ImportDeclaration' ||
				type === 'ExportNamedDeclaration' ||
				type === 'ClassDeclaration'
			) {
				continue;
			}
			// A `$:` is written over past its label, as `reactive()` writes it.
			const target =
				type === 'LabeledStatement' && isNode(statement['body']) ? statement['body'] : statement;
			const { start, end } = target;
			if (typeof start !== 'number' || typeof end !== 'number' || overlaps(start, end)) continue;
			const calls = callees(target, spans);
			if (![...calls].some((each) => tainted.has(each))) continue;
			// Opening with its own semicolon too: what precedes it may be a neutralised declaration
			// written as a bare `null` on the same line, which nothing else ends.
			reading.push([[start, end], ';undefined;']);
			const assigns = new Set<string>();
			writes(target, assigns);
			for (const name of assigns) {
				gone.add(name);
				if (!changed.has(name)) changed.set(name, withheldBecause(name));
			}
			moved = true;
		}
	}
}

/**
 * Every bare name a block calls as it runs: not inside a function, which runs when called, and not
 * inside one of `skipped`, the spans written over for the render.
 */
export function callees(
	node: unknown,
	skipped: readonly (readonly [number, number])[],
	into = new Set<string>(),
): Set<string> {
	if (Array.isArray(node)) {
		for (const one of node) callees(one, skipped, into);
		return into;
	}
	if (!isNode(node)) return into;
	const start = node['start'];
	if (typeof start === 'number' && skipped.some(([from, to]) => start >= from && start < to)) {
		return into;
	}
	const type = node['type'];
	if (
		type === 'FunctionDeclaration' ||
		type === 'FunctionExpression' ||
		type === 'ArrowFunctionExpression'
	) {
		return into;
	}
	if (node['type'] === 'CallExpression') {
		const callee = node['callee'];
		if (isNode(callee) && callee['type'] === 'Identifier' && typeof callee['name'] === 'string') {
			into.add(callee['name']);
		}
	}
	for (const value of Object.values(node)) callees(value, skipped, into);
	return into;
}
