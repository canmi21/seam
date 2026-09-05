import { parse } from 'svelte/compiler';
import { apply } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { OMITTED_IN_SSR } from './omitted.ts';

/**
 * Every `bind:` the server writes, written the way it writes it: as an ordinary attribute.
 *
 * Read out of `visitors/shared/element.js` and `visitors/shared/component.js`. A binding is not a
 * separate kind of output. On an element the visitor ends at
 * `attributes.push({ type: 'transformed', name, expression })`, so `bind:value={v}` writes what
 * `value={v}` writes; on a component it becomes a getter and a setter for the same prop, and only
 * the getter runs while the bytes are written. The refusal used to say a marker cannot stand where
 * the value goes because `bind:` takes a name rather than an expression. **The syntax does; the
 * output does not.** Rewriting the syntax is enough, and nothing downstream then knows there was a
 * binding at all.
 *
 * The ones that are not an attribute are refused here, each saying what it is rather than what it
 * is not. Everything the visitor drops is dropped: `bind:this`, the forty the table marks
 * `omit_in_ssr`, and `bind:value` on a `<select>` or a file input.
 */
export function unbound(source: string): string {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const edits: [number, number, string][] = [];

	const walk = (node: unknown, host: AstNode | null): void => {
		if (Array.isArray(node)) {
			for (const one of node) walk(one, host);
			return;
		}
		if (!isNode(node)) return;
		const type = node['type'];
		const element = type === 'RegularElement' || type === 'SvelteElement';
		const component = type === 'Component' || type === 'SvelteComponent' || type === 'SvelteSelf';
		const inside = element || component ? node : host;

		if (type === 'BindDirective' && isNode(inside)) {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			const at = span(node);
			const value = span(node['expression']);
			const tag = typeof inside['name'] === 'string' ? inside['name'] : '';
			const onElement = inside['type'] === 'RegularElement' || inside['type'] === 'SvelteElement';

			// A get/set pair. The server calls the getter and writes what it returns, which is a
			// rewrite this has not been taught.
			if (isNode(node['expression']) && node['expression']['type'] === 'SequenceExpression') {
				refuse(
					`\`bind:${name}\` with a getter and a setter is not handled yet: the server calls ` +
						'the getter and writes what it returns',
				);
			}

			// A select's `bind:value` is not dropped: the visitor skips it as an attribute, but the
			// renderer still reads it as what the options compare themselves against, so it is
			// written as `value={...}` for the walk to read the same way. See `selection()` in walk.ts.
			const dropped =
				name === 'this' ||
				OMITTED_IN_SSR.has(name) ||
				(onElement && name === 'value' && fileInput(inside));
			const expression = value === null ? '' : source.slice(value[0], value[1]);

			if (dropped) {
				if (at !== null) edits.push([at[0], at[1], '']);
			} else if (onElement && name === 'innerHTML') {
				// Left as written. The server writes the value unescaped as the element's content,
				// which is a raw hole with no anchors around it, and only the walk can plant one.
			} else if (
				onElement &&
				(CONTENT_BINDINGS.has(name) || (name === 'value' && tag === 'textarea'))
			) {
				// The server writes `$.escape(value)` as the content, and the children only where that
				// comes out empty. With no children the two are one thing, `{value}` as the content,
				// and an element with children is a decision this does not take.
				const opened = opening(source, inside);
				if (opened === null) {
					refuse(`\`bind:${name}\` on an element this compiler cannot read the tag of`);
				}
				if (hasChildren(inside)) {
					refuse(
						`\`bind:${name}\` on an element with children is not handled yet: the server writes ` +
							'the children only where the value comes out empty, which is a decision per request',
					);
				}
				if (at !== null) edits.push([at[0], at[1], '']);
				edits.push([opened, opened, `{${expression}}`]);
			} else if (onElement && name === 'group') {
				// What `element.js` writes for a group: `checked`, computed from the bound value together
				// with the element's own `value` -- `includes` for a checkbox, `===` for a radio -- and
				// nothing at all when the element has no `value` attribute.
				const own = valueOf(source, inside);
				if (at === null) return;
				if (own === null) {
					edits.push([at[0], at[1], '']);
				} else {
					const test = checkbox(inside)
						? `(${expression}).includes(${own})`
						: `(${expression}) === (${own})`;
					edits.push([at[0], at[1], `checked={${test}}`]);
				}
			} else if (at !== null && value !== null) {
				edits.push([at[0], at[1], `${name}={${expression}}`]);
			}
		}

		for (const one of Object.values(node)) walk(one, inside);
	};
	walk(ast['fragment'], null);

	return edits.length === 0 ? source : apply(source, edits);
}

/** Svelte's `CONTENT_EDITABLE_BINDINGS`, which the server writes as content rather than markup. */
const CONTENT_BINDINGS: ReadonlySet<string> = new Set(['textContent', 'innerText']);

/** Where an element's opening tag ends, or null for one written self-closing. */
function opening(source: string, node: AstNode): number | null {
	const at = span(node);
	if (at === null) return null;
	let last = at[0];
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		const where = span(one);
		if (where !== null) last = Math.max(last, where[1]);
	}
	const close = source.indexOf('>', last);
	if (close < 0 || source[close - 1] === '/') return null;
	return close + 1;
}

function hasChildren(node: AstNode): boolean {
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	return nodes.length > 0;
}

/** The element's own `value` as source text, a string literal for text, or null for none. */
function valueOf(source: string, node: AstNode): string | null {
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== 'value') continue;
		const value = one['value'];
		if (value === true) return 'true';
		const parts = Array.isArray(value) ? value : [value];
		if (parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			return JSON.stringify(parts.map((part) => String((part as AstNode)['data'] ?? '')).join(''));
		}
		const [only] = parts;
		if (parts.length === 1 && isNode(only) && only['type'] === 'ExpressionTag') {
			const at = span(only['expression']);
			if (at !== null) return `(${source.slice(at[0], at[1])})`;
		}
		refuse(
			'`bind:group` beside a `value` that mixes text and an expression is not handled yet: the ' +
				'server compares against the joined string',
		);
	}
	return null;
}

function checkbox(node: AstNode): boolean {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	return attributes.some((one) => {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== 'type') return false;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		return isNode(only) && only['type'] === 'Text' && only['data'] === 'checkbox';
	});
}

/** An input the visitor skips `bind:value` on, told by a literal `type="file"` the way it tells. */
function fileInput(node: AstNode): boolean {
	if (node['name'] !== 'input') return false;
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	return attributes.some((one) => {
		if (!isNode(one) || one['type'] !== 'Attribute' || one['name'] !== 'type') return false;
		const parts = Array.isArray(one['value']) ? one['value'] : [one['value']];
		const [only] = parts;
		return isNode(only) && only['type'] === 'Text' && only['data'] === 'file';
	});
}
