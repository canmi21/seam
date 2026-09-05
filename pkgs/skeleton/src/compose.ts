import { basename } from 'node:path';
import { literalOf, type Locals, mentions, pathOf, reduce } from 'ast';
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
 * The values a render is fixed at, as the shape they sit in, for one name.
 *
 * A render is given no data, so a child's props are handed null and the entry's are handed
 * nothing. That is right for everything a marker stands for and wrong for the one thing a marker
 * does not: a path this render is fixed at is a value the compiler knows, and markup left for
 * Svelte to evaluate reads it out of the props like anything else. `<Modal title={m['x']({}, {
 * locale })}>` is that -- inert, because nothing in it varies per request once the locale is fixed,
 * and evaluated against a `data` that was null.
 *
 * So the render is given exactly those paths and nothing else. `data.locale.code` fixed at `"en"`
 * becomes `{ locale: { code: 'en' } }`, and every other field of `data` is still absent, which is
 * what keeps a marker the only way to read one.
 */
export function partial(fixed: ReadonlyMap<string, string>, root: string): unknown {
	let found: Record<string, unknown> | undefined;
	for (const [path, literal] of fixed) {
		const names = path.split('.');
		if (names[0] !== root) continue;
		const value: unknown = JSON.parse(literal);
		if (names.length === 1) return value;
		// Built without a prototype, so that a segment spelled `__proto__` is a key like any other
		// rather than the object's prototype: on an ordinary `{}`, `at[name] ??= {}` leaves the
		// inherited prototype where it is, the walk steps into `Object.prototype`, and the last
		// assignment writes onto every object in the process while `found` stays empty. The paths
		// come from the build's own configuration, so nobody hostile writes one, but a name that
		// is not a name is a wrong result rather than a refused one, and the render reads props off
		// this object exactly as it would off one with a prototype.
		found ??= Object.create(null) as Record<string, unknown>;
		let at = found;
		for (const name of names.slice(1, -1)) {
			at[name] ??= Object.create(null) as Record<string, unknown>;
			at = at[name] as Record<string, unknown>;
		}
		at[names[names.length - 1] as string] = value;
	}
	return found;
}

/**
 * The paths a render is fixed at, in both spellings a child needs.
 *
 * They are rooted at the payload, and there are two ways a child meets one. An expression that has
 * been expanded says it the payload's way, because substitution has already put the call site's
 * words in -- `locale.code` inside the child comes out as `((data)).locale.code`. A declaration
 * read before any of that says it the child's way, because its own props are still its own names.
 *
 * So both are carried. Each payload-rooted path is also translated through the props: a prop bound
 * to the whole of one *is* that path inside the child, and a prop bound to a prefix carries the
 * rest along. Keeping only the translation is what left `<LanguageSwitcher code={locale.code}>`
 * unbound on a real route -- the expansion spelled it `data.locale.code` and the map held only
 * `locale.code`.
 */
export function rebased(
	fixed: ReadonlyMap<string, string>,
	declares: readonly { local: string; prop: string }[],
	bindings: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
	const found = new Map<string, string>(fixed);
	for (const one of declares) {
		const given = bindings.get(one.prop);
		if (given === undefined) continue;
		// The call site may have handed over a value rather than a path -- expanding an expression
		// writes a fixed path out as its literal, so `locale={data.locale.code}` arrives as `"en"`
		// and the spelling that would have matched is gone. A literal is worth carrying whatever it
		// came from: it reads nothing, so the child can be handed it rather than the null every
		// other prop gets, and an inert expression over it evaluates to what it should.
		const value = literalOf(given);
		if (value !== undefined) {
			found.set(one.local, value);
			continue;
		}
		const base = pathOf(given);
		if (base === null) continue;
		for (const [path, literal] of fixed) {
			if (path === base) found.set(one.local, literal);
			else if (path.startsWith(`${base}.`)) found.set(one.local + path.slice(base.length), literal);
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

/**
 * How long every list the walk appends to was before a descent, so the descent can be undone.
 *
 * Named rather than a bag of counts, because two of these were missing and nothing said so. A
 * descent that stopped left its `handed` records and its spreads behind, pointing at holes that had
 * been rolled back -- so a group inside a component the walk never entered was still asked whether
 * its markup came back, over a range that by then belonged to somebody else. `missed` is the one
 * list that stays: it is the record of why the descent stopped, and it is wanted precisely because
 * the descent did not finish.
 */
interface Marks {
	holes: number;
	blocks: number;
	edits: number;
	pending: number;
	copies: number;
	handed: number;
	spreads: number;
}

/** Puts back what a walk that did not finish appended, and says it did not take the component. */
export function rolled(walk: Walk, mark: Marks): false {
	walk.holes.length = mark.holes;
	walk.blocks.length = mark.blocks;
	walk.edits.length = mark.edits;
	walk.pending.length = mark.pending;
	walk.site.copies.length = mark.copies;
	walk.site.handed.length = mark.handed;
	walk.site.spreads.length = mark.spreads;
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
