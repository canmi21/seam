import { basename } from 'node:path';
import { type Locals, mentions, reduce } from 'ast';
import { type AstNode, isNode, span } from './node.ts';
import { type Snippet, snippetsIn } from './snippets.ts';
import type { Given, Walk } from './walk.ts';

/**
 * Everything composition needs except the descent itself.
 *
 * A component compiles to a plain call, so entering one is a matter of reading what its `$props()`
 * declares, binding each name to what the call site passes, and pointing the tag at the copy the
 * walk rewrites. Those readings are here; `descend` in `walk.ts` is what puts them together, and
 * it is there because it and the walk call each other.
 */

/**
 * What a component's `$props()` binds: the name the markup uses, the prop it arrives as, and what
 * it holds when the call site passes nothing.
 *
 * A prop the caller leaves out is its default, and where there is no default it is `undefined` --
 * which is what Svelte's own output does, since `$props()` destructures the props object. Missing
 * this wrote the wrong bytes rather than refusing, and only the comparison against Svelte said so.
 *
 * Null where the pattern is one this cannot read: a rest element gathers whatever was not named,
 * and what that is at the call site is a set of keys rather than a value.
 */
export function propsOf(
	ast: AstNode,
	source: string,
): { local: string; prop: string; fallback: string }[] | null {
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const found: { local: string; prop: string; fallback: string }[] = [];

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'VariableDeclaration') continue;
		const declarations = Array.isArray(statement['declarations']) ? statement['declarations'] : [];
		for (const one of declarations) {
			if (!isNode(one)) continue;
			const init = one['init'];
			const callee = isNode(init) ? init['callee'] : undefined;
			if (!isNode(callee) || callee['name'] !== '$props') continue;
			const id = one['id'];
			if (!isNode(id) || id['type'] !== 'ObjectPattern') return null;
			for (const property of Array.isArray(id['properties']) ? id['properties'] : []) {
				if (!isNode(property) || property['type'] !== 'Property') return null;
				const key = property['key'];
				const value = property['value'];
				if (!isNode(key) || typeof key['name'] !== 'string' || !isNode(value)) return null;
				if (value['type'] === 'Identifier' && typeof value['name'] === 'string') {
					found.push({ local: value['name'], prop: key['name'], fallback: 'undefined' });
					continue;
				}
				// `p = 1`, which is the default, and it is the only other shape this reads.
				const left = value['type'] === 'AssignmentPattern' ? value['left'] : undefined;
				const right = value['type'] === 'AssignmentPattern' ? span(value['right']) : null;
				if (!isNode(left) || typeof left['name'] !== 'string' || right === null) return null;
				found.push({
					local: left['name'],
					prop: key['name'],
					fallback: source.slice(right[0], right[1]),
				});
			}
		}
	}
	return found;
}

/**
 * Whether a prop's value is the same every request, so that nothing has to stand in for it.
 *
 * Only asked of a component the walk did not enter. Inside one, an expression is walked and its
 * value is a marker like any other; outside, the value is handed to somebody else's code, and a
 * marker is a string wherever that code expected something else.
 */
export function inert(
	attr: unknown,
	expand: Locals['rewrite'],
	dynamic: ReadonlySet<string>,
): boolean {
	if (!isNode(attr) || attr['type'] !== 'Attribute') return false;
	const value = attr['value'];
	if (value === true) return false;
	const parts = Array.isArray(value) ? value : [value];
	return parts.every((part) => {
		if (!isNode(part)) return false;
		if (part['type'] === 'Text') return true;
		if (part['type'] !== 'ExpressionTag') return false;
		return !mentions(expand(part['expression']), dynamic);
	});
}

/** Every import a file declares, by the name it binds, read the way `reduce` reads them. */
export function importsOf(source: string): Record<string, string> {
	return reduce(source).imports;
}

/**
 * A name for one place in one file, stable however the walk reaches it.
 *
 * Short and hexadecimal, because it is written into markup and has to survive being rendered.
 */
export function identity(file: string, at: number): string {
	let hash = 0x811c9dc5;
	for (const c of `${file}:${String(at)}`) {
		hash = Math.imul(hash ^ c.codePointAt(0)!, 0x01000193) >>> 0;
	}
	return hash.toString(16);
}

/**
 * What the caller hands the child: its markup, under the name Svelte gives it.
 *
 * `children`, and only that. Svelte builds it as an arrow function and passes it under that name
 * unless the caller wrote a `children` prop of its own, in which case the markup goes to
 * `$$slots` and this is not it.
 */
export function hands(walk: Walk, nodes: readonly unknown[]): ReadonlyMap<string, Given> {
	if (nodes.length === 0) return new Map();
	const here = new Map<string, Snippet>();
	snippetsIn(nodes, here);
	return new Map([
		[
			'children',
			{
				source: walk.source,
				nodes: [...nodes],
				expand: walk.expand,
				edits: walk.edits,
				snippets: here,
				site: walk.site,
			},
		],
	]);
}

/** Puts back what a walk that did not finish appended, and says it did not take the component. */
export function rolled(walk: Walk, mark: Record<string, number>): false {
	walk.holes.length = mark['holes'] ?? 0;
	walk.blocks.length = mark['blocks'] ?? 0;
	walk.edits.length = mark['edits'] ?? 0;
	walk.pending.length = mark['pending'] ?? 0;
	walk.site.copies.length = mark['copies'] ?? 0;
	return false;
}

/**
 * The imports a rewritten source needs that its author did not write, put where imports go.
 *
 * Into the instance script, or into one made for the purpose. A module script would not do: what
 * it declares is shared by every instance, and these are per call site.
 */
export function withPrelude(
	source: string,
	ast: AstNode,
	prelude: readonly string[],
	edits: [number, number, string][],
): void {
	if (prelude.length === 0) return;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const at = isNode(content) ? content['start'] : undefined;
	if (typeof at === 'number') {
		edits.push([at, at, `\n${prelude.join('\n')}\n`]);
		return;
	}
	edits.push([0, 0, `<script>\n${prelude.join('\n')}\n</script>\n`]);
}

/**
 * Points one component tag at a copy of its own: the name where it opens and closes, and an import.
 */
export function rename(walk: Walk, node: AstNode, tag: string, at: string, ordinal: number): void {
	const [from, to] = [node['start'], node['end']];
	if (typeof from !== 'number' || typeof to !== 'number') return;
	const fresh = `${tag}$${String(ordinal)}`;
	const text = walk.source.slice(from, to);
	walk.edits.push([from + 1, from + 1 + tag.length, fresh]);
	if (text.endsWith(`</${tag}>`)) {
		walk.edits.push([to - 1 - tag.length, to - 1, fresh]);
	}
	const relative = `./${basename(at)}`;
	walk.site.prelude.push(`import ${fresh} from '${relative}';`);
}
