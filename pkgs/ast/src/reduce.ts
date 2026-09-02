import { parse } from 'svelte/compiler';
import { type Locals, locals } from './bindings.ts';
import type { MarkupAttr, MarkupNode, Module } from './markup.ts';

// Svelte's AST is typed against its own internal shapes, which change between releases and
// which this package deliberately does not model. It reads a handful of fields off each node
// and carries every expression across as source text, so the types stop here.
type AstNode = Record<string, unknown>;

function isNode(value: unknown): value is AstNode {
	return typeof value === 'object' && value !== null;
}

/**
 * An expression as the compiler will see it, which is not always as it was written. A name the
 * component's scripts declared is replaced by what it was declared to be, so `{total}` arrives as
 * the expression `total` stood for. See spec/derivation.md.
 */
let expand: Locals['rewrite'] = () => '';

function span(source: string, node: unknown): string {
	if (!isNode(node)) return '';
	const { start, end } = node;
	if (typeof start !== 'number' || typeof end !== 'number') return '';
	return source.slice(start, end);
}

function children(source: string, fragment: unknown): MarkupNode[] {
	if (!isNode(fragment)) return [];
	const nodes = fragment['nodes'];
	if (!Array.isArray(nodes)) return [];
	return nodes.map((node) => reduceNode(source, node));
}

function reduceAttr(source: string, attr: unknown): MarkupAttr {
	const type = isNode(attr) && typeof attr['type'] === 'string' ? attr['type'] : 'unknown';
	// Everything that is not a plain attribute -- class:, style:, use:, {...rest}, an event
	// handler -- is carried across whole. Deciding which of them are escapes is lowering's job,
	// and doing it here would put that rule in two places.
	if (type !== 'Attribute' || !isNode(attr)) {
		return { k: 'unsupported', type, src: span(source, attr) };
	}
	const name = typeof attr['name'] === 'string' ? attr['name'] : '';
	const value = attr['value'];
	if (value === true) return { k: 'attr', name, value: true };
	const parts = Array.isArray(value) ? value : [value];
	return { k: 'attr', name, value: parts.map((part) => reduceNode(source, part)) };
}

function reduceNode(source: string, node: unknown): MarkupNode {
	const type = isNode(node) && typeof node['type'] === 'string' ? node['type'] : 'unknown';
	if (!isNode(node)) return { k: 'unsupported', type, src: '' };

	switch (type) {
		case 'Text':
			return { k: 'text', v: typeof node['data'] === 'string' ? node['data'] : '' };
		case 'ExpressionTag':
			return { k: 'expr', src: expand(node['expression']) };
		case 'HtmlTag':
			return { k: 'html', src: expand(node['expression']) };
		case 'RegularElement': {
			const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
			return {
				k: 'element',
				name: typeof node['name'] === 'string' ? node['name'] : '',
				attrs: attributes.map((attr) => reduceAttr(source, attr)),
				body: children(source, node['fragment']),
			};
		}
		case 'IfBlock':
			return {
				k: 'if',
				test: expand(node['test']),
				consequent: children(source, node['consequent']),
				alternate: node['alternate'] === null ? null : children(source, node['alternate']),
			};
		case 'EachBlock':
			// index, key and fallback are carried even though the protocol has no use for them
			// yet. Reading only the fields that happen to be supported is how `{:else}` on an
			// each block would disappear between here and lowering instead of being refused.
			return {
				k: 'each',
				source: expand(node['expression']),
				item: node['context'] === undefined ? null : span(source, node['context']),
				index: typeof node['index'] === 'string' ? node['index'] : null,
				key: node['key'] === null || node['key'] === undefined ? null : span(source, node['key']),
				body: children(source, node['body']),
				fallback:
					node['fallback'] === null || node['fallback'] === undefined
						? null
						: children(source, node['fallback']),
			};
		case 'Component': {
			const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
			return {
				k: 'component',
				name: typeof node['name'] === 'string' ? node['name'] : '',
				props: attributes.map((attr) => reduceAttr(source, attr)),
				body: children(source, node['fragment']),
			};
		}
		default:
			// Passed through rather than dropped, so a Svelte feature this does not know about
			// reaches lowering as something to refuse rather than as silence.
			return { k: 'unsupported', type, src: span(source, node) };
	}
}

// Every import the component declares, unfiltered: which of them are components is decided by
// whoever resolves them, not here.
function imports(instance: unknown): Record<string, string> {
	const found: Record<string, string> = {};
	if (!isNode(instance)) return found;
	const content = instance['content'];
	if (!isNode(content)) return found;
	const body = content['body'];
	if (!Array.isArray(body)) return found;

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		const from = statement['source'];
		if (!isNode(from) || typeof from['value'] !== 'string') continue;
		const specifiers = Array.isArray(statement['specifiers']) ? statement['specifiers'] : [];
		for (const specifier of specifiers) {
			if (!isNode(specifier)) continue;
			const local = specifier['local'];
			if (isNode(local) && typeof local['name'] === 'string') {
				found[local['name']] = from['value'];
			}
		}
	}
	return found;
}

export function reduce(source: string): Module {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	expand = locals(source).rewrite;
	return { markup: children(source, ast['fragment']), imports: imports(ast['instance']) };
}
