import { escape } from './escape.ts';
import type { ComponentIR, Node } from './ir.ts';
import { resolve, type Scope, settle } from './resolve.ts';

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
				const text = single ? escape(value, 'attr') : String(value);
				// `class` and `style` come out of helpers that write nothing for an empty result,
				// so an element whose computed class is empty carries no class attribute at all.
				if (node.presence === 'nonempty' && text === '') break;
				out += ` ${node.name}="${text}"`;
				break;
			}
			case 'each': {
				// A source that is not an array renders nothing, matching what Svelte's
				// ensure_array_like does with undefined.
				const source = settle(resolve(scopes, node.source), scopes);
				if (!Array.isArray(source)) break;
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
 * The title, which reads as markup and behaves as a channel. It is written here rather than in
 * the head so that the difference has a name: the head is bytes in place, while this is a value
 * that is either set or not, and an unreached branch leaves it unset rather than empty. The walk
 * underneath is the same one.
 */
function title(nodes: readonly Node[], scopes: readonly Scope[], fresh: Fresh): string {
	return walk(nodes, scopes, fresh);
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
	const fresh: Fresh = { next: 1 };
	// The title goes after the head blocks, which is where Svelte's own renderer appends it.
	return {
		body: walk(ir.body, scopes, fresh),
		head: walk(ir.head, scopes, fresh) + title(ir.title, scopes, fresh),
	};
}
