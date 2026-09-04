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

			const dropped =
				name === 'this' ||
				OMITTED_IN_SSR.has(name) ||
				(onElement && name === 'value' && (tag === 'select' || fileInput(inside)));

			if (dropped) {
				if (at !== null) edits.push([at[0], at[1], '']);
			} else if (onElement && CONTENT_BINDINGS.has(name)) {
				refuse(
					`\`bind:${name}\` is not handled yet: the server writes the value as the element's ` +
						'content rather than as an attribute, so it replaces the children rather than ' +
						'standing among them',
				);
			} else if (onElement && name === 'value' && tag === 'textarea') {
				refuse(
					'`bind:value` on a `<textarea>` is not handled yet: the server writes the value as ' +
						"the element's content rather than as an attribute",
				);
			} else if (onElement && name === 'group') {
				refuse(
					'`bind:group` is not handled yet: the server writes `checked`, computed from this ' +
						"value together with the element's own `value` attribute rather than from either " +
						'alone',
				);
			} else if (at !== null && value !== null) {
				edits.push([at[0], at[1], `${name}={${source.slice(value[0], value[1])}}`]);
			}
		}

		for (const one of Object.values(node)) walk(one, inside);
	};
	walk(ast['fragment'], null);

	return edits.length === 0 ? source : apply(source, edits);
}

/** Svelte's `CONTENT_EDITABLE_BINDINGS`, which the server writes as content rather than markup. */
const CONTENT_BINDINGS: ReadonlySet<string> = new Set(['textContent', 'innerHTML', 'innerText']);

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
