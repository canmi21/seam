import { escape } from './escape.ts';
import type { ComponentIR, Node } from './ir.ts';
import { resolve, type Scope } from './resolve.ts';

export type { Branch, ComponentIR, EscapeMode, Node, Presence } from './ir.ts';
export { resolve, type Scope } from './resolve.ts';

function walk(nodes: readonly Node[], scopes: readonly Scope[]): string {
	let out = '';
	for (const node of nodes) {
		switch (node.t) {
			case 'static':
				out += node.s;
				break;
			case 'slot':
				out += escape(resolve(scopes, node.path), node.escape);
				break;
			case 'if':
				for (const branch of node.branches) {
					if (branch.test === null || resolve(scopes, branch.test)) {
						out += walk(branch.body, scopes);
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
				const value = single ? resolve(scopes, only.path) : walk(node.parts, scopes);
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
				const source = resolve(scopes, node.source);
				if (!Array.isArray(source)) break;
				// The counter is bound beside the item rather than reached through it, which is what
				// Svelte's server does: it is the `for` loop's own variable.
				for (const [at, item] of source.entries()) {
					const bound: Scope = { [node.item]: item };
					if (node.index != null) bound[node.index] = at;
					out += walk(node.body, [...scopes, bound]);
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
function title(nodes: readonly Node[], scopes: readonly Scope[]): string {
	return walk(nodes, scopes);
}

/** What Svelte's `render()` returns, produced without any of Svelte running. */
export interface Injected {
	body: string;
	head: string;
}

export function inject(ir: ComponentIR, data: Scope): Injected {
	const scopes = [data];
	// The title goes after the head blocks, which is where Svelte's own renderer appends it.
	return { body: walk(ir.body, scopes), head: walk(ir.head, scopes) + title(ir.title, scopes) };
}
