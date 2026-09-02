import { escape } from './escape.ts';
import type { ComponentIR, Node } from './ir.ts';
import { resolve, type Scope } from './resolve.ts';

export type { Branch, ComponentIR, EscapeMode, Node } from './ir.ts';
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
				// Absent only when the whole value is one expression that resolves to nothing.
				// An empty string, false and 0 are all written; see spec/ir.md.
				const [only] = node.parts;
				if (node.parts.length === 1 && only?.t === 'slot') {
					const value = resolve(scopes, only.path);
					if (value === undefined || value === null) break;
				}
				out += ` ${node.name}="${walk(node.parts, scopes)}"`;
				break;
			}
			case 'each': {
				// A source that is not an array renders nothing, matching what Svelte's
				// ensure_array_like does with undefined.
				const source = resolve(scopes, node.source);
				if (!Array.isArray(source)) break;
				for (const item of source) {
					out += walk(node.body, [...scopes, { [node.item]: item }]);
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
