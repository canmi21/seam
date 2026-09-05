/**
 * The AST plumbing every pass in this package shares.
 *
 * Svelte's parser returns plain objects, so what is here is the small vocabulary for reading one
 * safely -- is it a node, where does it sit in the source -- plus the handful of readings that are
 * the parser's shape rather than any one pass's business: what a `{@render}` calls, which
 * alternate is an `{:else if}`, what names a pattern binds.
 */

export type AstNode = Record<string, unknown>;

export function isNode(value: unknown): value is AstNode {
	return typeof value === 'object' && value !== null;
}

export function span(node: unknown): [number, number] | null {
	if (!isNode(node)) return null;
	const { start, end } = node;
	if (typeof start !== 'number' || typeof end !== 'number') return null;
	return [start, end];
}

/** What a refusal says, in one shape, so the reader always learns where the question lives. */
export function refuse(what: string): never {
	throw new Error(`${what}. See spec/refusals.md`);
}

/**
 * Where a fragment sits in the source: from its first child to its last.
 *
 * A `Fragment` carries `nodes` and nothing else -- no `start`, no `end` -- so asking one for a span
 * gets a pair of `undefined` and every caller that took one did nothing at all, quietly. That is
 * what the probe render was doing: it planted no literal, so no component was ever measured to
 * write the markup it was given, and the fragment it did not replace it also did not walk, which
 * left the markup rendering with none of the rewriting the pass had done everywhere else.
 *
 * The children carry the whitespace between the tags, so first to last is the whole of what was
 * written inside them.
 */
export function extent(fragment: unknown): [number, number] | null {
	if (!isNode(fragment)) return null;
	const nodes = fragment['nodes'];
	if (!Array.isArray(nodes) || nodes.length === 0) return null;
	const first = span(nodes[0]);
	const last = span(nodes[nodes.length - 1]);
	return first === null || last === null ? null : [first[0], last[1]];
}

/**
 * The call a `{@render}` makes, with an optional chain unwrapped.
 *
 * `{@render children?.()}` parses as a `ChainExpression` around the call, so reading `callee`
 * straight off the expression finds nothing and the tag looks like a render of something this
 * component never declared. Svelte's own transform calls `unwrap_optional` here for the same
 * reason, and this is that function.
 */
export function called(expression: unknown): AstNode | null {
	if (!isNode(expression)) return null;
	const inner = expression['type'] === 'ChainExpression' ? expression['expression'] : expression;
	return isNode(inner) ? inner : null;
}

/** The name a `{@render}` calls, where it calls one by name rather than through a member. */
export function renders(node: AstNode): string | null {
	const callee = called(node['expression'])?.['callee'];
	return isNode(callee) && typeof callee['name'] === 'string' ? callee['name'] : null;
}

/**
 * The `{:else if}` this alternate is, or null where it is an ordinary `{:else}` or nothing.
 *
 * The parser puts the continuation in the alternate as a fragment holding one `IfBlock` marked
 * `elseif`. Svelte's own transform reads the same thing to flatten the chain.
 */
export function elseIf(alternate: unknown): AstNode | null {
	if (!isNode(alternate) || alternate['type'] !== 'Fragment') return null;
	const nodes = alternate['nodes'];
	if (!Array.isArray(nodes) || nodes.length !== 1) return null;
	const [only] = nodes;
	if (!isNode(only) || only['type'] !== 'IfBlock' || only['elseif'] !== true) return null;
	return only;
}

/**
 * How many titles the source writes, and whether any sits inside a block.
 *
 * A second title overwrites the first by a precedence rule read off the render tree, and two
 * readings of that rule each disagreed with what it actually does, so it is not reproduced: one
 * title, or none. A title inside a block is a separate problem: the title is not part of the
 * block on either side, so the block renders empty and the title is appended regardless, and
 * nothing in the bytes ties the one to the other. See spec/ir.md.
 */
export function titles(node: unknown, guarded = false): { found: number; conditional: boolean } {
	if (!isNode(node)) return { found: 0, conditional: false };
	if (node['type'] === 'TitleElement') return { found: 1, conditional: guarded };
	const inside = guarded || node['type'] === 'IfBlock' || node['type'] === 'EachBlock';
	let found = 0;
	let conditional = false;
	const visit = (child: unknown) => {
		const seen = titles(child, inside);
		found += seen.found;
		conditional ||= seen.conditional;
	};
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
		} else if (isNode(value)) {
			visit(value);
		}
	}
	return { found, conditional };
}

/** The id and initialiser of a `{@const}`, or null when it is not the one declaration it must be. */
export function declarationOf(node: AstNode): [unknown, unknown] | null {
	const declaration = node['declaration'];
	if (!isNode(declaration)) return null;
	const declarations = declaration['declarations'];
	const one = Array.isArray(declarations) ? declarations[0] : undefined;
	if (!isNode(one)) return null;
	return [one['id'], one['init']];
}

/** What a render is handed in place of a value it cannot compute, shaped so it still comes apart. */
export function holdsFor(id: unknown): string {
	if (!isNode(id)) return 'null';
	if (id['type'] === 'ObjectPattern') return '{}';
	if (id['type'] === 'ArrayPattern') return '[]';
	return 'null';
}

/** Every name a parameter pattern binds, so one it cannot be taken apart by is not left silent. */
export function namesIn(pattern: unknown, into: Set<string>): void {
	if (Array.isArray(pattern)) {
		for (const one of pattern) namesIn(one, into);
		return;
	}
	if (!isNode(pattern)) return;
	if (pattern['type'] === 'Identifier' && typeof pattern['name'] === 'string') {
		into.add(pattern['name']);
		return;
	}
	// A property's key is not a binding: `{ a: b }` binds `b`.
	if (pattern['type'] === 'Property') {
		namesIn(pattern['value'], into);
		return;
	}
	// A default is read, not bound: `{ a = data.d }` binds `a`.
	if (pattern['type'] === 'AssignmentPattern') {
		namesIn(pattern['left'], into);
		return;
	}
	for (const value of Object.values(pattern)) namesIn(value, into);
}

/**
 * Whether the instance script declares `$props.id()`.
 *
 * Svelte allows exactly one, as the initialiser of a plain declarator at the top of the instance
 * script -- `props_id_invalid_placement` and `props_duplicate` in its analysis -- so finding one is
 * finding the component's id.
 */
export function identified(ast: AstNode): boolean {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		for (const one of Array.isArray(statement['declarations']) ? statement['declarations'] : []) {
			const init = isNode(one) ? one['init'] : undefined;
			const callee = isNode(init) && init['type'] === 'CallExpression' ? init['callee'] : undefined;
			if (!isNode(callee) || callee['type'] !== 'MemberExpression') continue;
			const object = callee['object'];
			const property = callee['property'];
			if (
				isNode(object) &&
				object['name'] === '$props' &&
				isNode(property) &&
				property['name'] === 'id'
			) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Whether the component's stylesheet relates one element to a sibling, with `+` or `~`.
 *
 * Asked because a stamp that has to be an element -- inside a table, where text is refused -- is a
 * sibling, and Svelte's CSS analysis stops at the first one it meets. See `carrier()`.
 */
export function relatesSiblings(ast: AstNode): boolean {
	let found = false;
	const walk = (node: unknown): void => {
		if (found) return;
		if (Array.isArray(node)) {
			for (const one of node) walk(one);
			return;
		}
		if (!isNode(node)) return;
		if (node['type'] === 'Combinator' && (node['name'] === '+' || node['name'] === '~')) {
			found = true;
			return;
		}
		for (const value of Object.values(node)) walk(value);
	};
	walk(ast['css']);
	return found;
}
