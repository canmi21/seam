import { escape } from './escape.ts';
import type { ComponentIR, Node } from './ir.ts';
import { resolve, type Scope, settle } from './resolve.ts';

/** Svelte's `replacements`, which has this one entry. */
const TRANSLATE: ReadonlyMap<unknown, string> = new Map<unknown, string>([
	[true, 'yes'],
	[false, 'no'],
]);

export type { Branch, ComponentIR, EscapeMode, Node, Presence } from './ir.ts';
export { resolve, SCOPED, type Scope, settle } from './resolve.ts';

/**
 * The ids one response counts out, for every `$props.id()` it meets.
 *
 * Svelte's server keeps one counter per render and spells the id `s1`, `s2`, ... in the order the
 * components are instantiated, which is the order their anchors are written; the client reads each
 * back from its anchor. Counting here in output order is the same sequence, so the bytes are the
 * ones Svelte would have written.
 */
interface Fresh {
	next: number;
	/** How many head blocks holding a title have started, which is what a title candidate ranks by. */
	block: number;
	/** The title winning so far under `set_title`'s rule. See the `title` node. */
	title?: { block: number; top: boolean; text: string };
	/** The component's fragments, which a `call` node walks. */
	fragments: Readonly<Record<string, Node[]>>;
}

function walk(nodes: readonly Node[], scopes: readonly Scope[], fresh: Fresh): string {
	let out = '';
	for (const node of nodes) {
		switch (node.t) {
			case 'static':
				out += node.s;
				break;
			case 'slot':
				if (node.fresh === true) {
					// Bound in the innermost scope, which is the item's inside an each, so every
					// item gets its own and the reads inside the body see it.
					const id = `s${String(fresh.next)}`;
					fresh.next += 1;
					const innermost = scopes[scopes.length - 1];
					if (innermost !== undefined) innermost[node.path] = id;
					out += escape(id, node.escape);
					break;
				}
				out += escape(settle(resolve(scopes, node.path), scopes), node.escape);
				break;
			case 'title': {
				// `set_title` keeps the title whose render path compares later, and a head block is
				// hoisted ahead of the fragment it sits in, so a later head block always compares
				// later and, within one block, every title shares the block's path and the first
				// one set is kept -- a top-level title runs at the block's init, before any block
				// inside it. So a later head block wins, and inside a block a top-level title beats
				// a nested one and an earlier one beats a later one of the same kind.
				if (node.role === 'open') {
					fresh.block += 1;
					break;
				}
				const text = walk(node.body, scopes, fresh);
				const top = node.role === 'top';
				const held = fresh.title;
				if (
					held === undefined ||
					fresh.block > held.block ||
					(fresh.block === held.block && top && !held.top)
				) {
					fresh.title = { block: fresh.block, top, text };
				}
				break;
			}
			case 'call': {
				// The fragment's body in a scope of its own, each parameter bound to the value at its
				// path where the call sits, the way an each binds its item per iteration. The depth
				// is the data's: a call inside the body is met again with the next value.
				const body = fresh.fragments[node.fragment];
				if (body === undefined)
					throw new Error(`a call of a fragment the IR does not hold: ${node.fragment}`);
				const bound: Scope = {};
				for (const [name, path] of node.binds) bound[name] = settle(resolve(scopes, path), scopes);
				out += walk(body, [...scopes, bound], fresh);
				break;
			}
			case 'if':
				for (const branch of node.branches) {
					if (branch.test === null || settle(resolve(scopes, branch.test), scopes)) {
						out += walk(branch.body, scopes, fresh);
						break;
					}
				}
				break;
			case 'attr': {
				// The one expression case keeps the value rather than its text, because both rules
				// below read the value: null and undefined take the attribute with them, and a
				// boolean one asks whether the value is falsy rather than what it prints as.
				const [only] = node.parts;
				const single = node.parts.length === 1 && only?.t === 'slot';
				const value = single
					? settle(resolve(scopes, only.path), scopes)
					: walk(node.parts, scopes, fresh);
				if (value === undefined || value === null) break;

				// `hidden` is boolean for every value but this one, which is Svelte's exception and
				// stays here because it is decided by the value rather than by the name.
				const bare =
					node.presence === 'boolean' && !(node.name === 'hidden' && value === 'until-found');
				if (bare) {
					// An empty string is a present boolean attribute, as it is in markup.
					if (!value && value !== '') break;
					out += ` ${node.name}=""`;
					break;
				}
				// The one entry in Svelte's replacement table, `internal/shared/attributes.js`: the
				// value `true` is written `"yes"` and `false` `"no"`, because `translate="false"` would
				// mean yes. The name is the whole of the rule, so it is carried here as the boolean
				// list is, rather than read off a render that cannot show it.
				const shown = node.name === 'translate' && single ? (TRANSLATE.get(value) ?? value) : value;
				const text = single ? escape(shown, 'attr') : String(value);
				// `class` and `style` come out of helpers that write nothing for an empty result,
				// so an element whose computed class is empty carries no class attribute at all.
				if (node.presence === 'nonempty' && text === '') break;
				out += ` ${node.name}="${text}"`;
				break;
			}
			case 'each': {
				// What `ensure_array_like` decides: nothing for a source that is nothing, the
				// source itself where it has a length, and `Array.from` of anything else -- a `Map`,
				// a `Set`, an iterator -- which the payload can carry, since devalue does.
				const held = settle(resolve(scopes, node.source), scopes);
				const source = arrayLike(held);
				if (source === null) break;
				// The counter is bound beside the item rather than reached through it, which is what
				// Svelte's server does: it is the `for` loop's own variable.
				for (const [at, item] of source.entries()) {
					// A destructuring binds names taken out of the element rather than the element
					// itself, which is what Svelte's `let [k, v] = each_array[i]` does.
					const bound: Scope = {};
					if (node.binds === undefined || node.binds.length === 0) {
						bound[node.item] = item;
					} else {
						for (const [name, access] of node.binds) bound[name] = reach(item, access);
					}
					if (node.index != null) bound[node.index] = at;
					out += walk(node.body, [...scopes, bound], fresh);
				}
				break;
			}
		}
	}
	return out;
}

/**
 * Svelte's `ensure_array_like`, read out of `internal/server/index.js`: a falsy source is an
 * empty list, one with a `length` is itself, and anything else goes through `Array.from`. Null is
 * returned for nothing to iterate, which is what the caller writes nothing for.
 */
function arrayLike(source: unknown): readonly unknown[] | null {
	if (!source) return null;
	if (typeof source === 'object' && 'length' in source) {
		return Array.isArray(source) ? source : Array.from(source as ArrayLike<unknown>);
	}
	if (typeof source === 'object' && Symbol.iterator in source) {
		return Array.from(source as Iterable<unknown>);
	}
	return null;
}

/**
 * The title, which reads as markup and behaves as a channel: a value that is either set or not,
 * appended after the head where Svelte appends its own. One decided by Svelte's render -- written
 * by a component the walk did not enter -- is the winner, as it was over everything the render
 * held; otherwise the one the `title` nodes decided while the head was walked.
 */
function title(nodes: readonly Node[], scopes: readonly Scope[], fresh: Fresh): string {
	const decided = walk(nodes, scopes, fresh);
	if (decided !== '') return decided;
	return fresh.title === undefined ? '' : `<title>${fresh.title.text}</title>`;
}

/** What Svelte's `render()` returns, produced without any of Svelte running. */
export interface Injected {
	body: string;
	head: string;
}

/**
 * One step into a value, the way a destructuring pattern reaches a name: `.key` or `[0]`.
 *
 * Written here rather than passed through `resolve`, which splits a dotted path and has no notion
 * of an index. What arrives is one access produced by `destructure`, never a chain.
 */
function reach(value: unknown, access: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined;
	const index = /^\[(\d+)\]$/.exec(access);
	if (index?.[1] !== undefined) return (value as Record<string, unknown>)[index[1]];
	return (value as Record<string, unknown>)[access.slice(1)];
}

export function inject(ir: ComponentIR, data: Scope): Injected {
	const scopes = [data];
	// One counter per response, starting where Svelte's does.
	const fresh: Fresh = { next: 1, block: 0, fragments: ir.fragments ?? {} };
	// The title goes after the head blocks, which is where Svelte's own renderer appends it.
	return {
		body: walk(ir.body, scopes, fresh),
		head: walk(ir.head, scopes, fresh) + title(ir.title, scopes, fresh),
	};
}
