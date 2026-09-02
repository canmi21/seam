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

export function inject(ir: ComponentIR, data: Scope): string {
	return walk(ir.nodes, [data]);
}
