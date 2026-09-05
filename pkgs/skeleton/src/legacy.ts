import { parse } from 'svelte/compiler';
import { apply } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';

/**
 * A legacy-mode prop, written the way runes mode writes it.
 *
 * `export let n; export let label = 'x'` declares props in Svelte 4's spelling, and Svelte 5 still
 * compiles it. Measured: the server output of a component written that way is byte for byte the
 * output of the same component with `let { n, label = 'x' } = $props()` -- a default fires on
 * `undefined` in both, and nothing about the props reaches the markup. So the spelling is changed
 * before anything reads the file, and every pass after this one knows one shape of prop. Done
 * here rather than in `propsOf`, because the render is handed the rewritten source too, and a
 * component that is runes mode in one and legacy in the other would compile two ways.
 *
 * Only `export let` and `export var` are props. `export const` and `export function` are a
 * component's readonly exports, which a caller reaches through `bind:this` and a render never
 * writes, and they are refused rather than guessed at. The type annotation on a declaration is
 * dropped: the pattern this writes has none, and the render strips types anyway.
 *
 * What this does not touch is also measured. `$store` reads render the same bytes in either mode,
 * so they are not a legacy question; `$:` statements run once on the server as plain statements,
 * which is the per-request script spec/derivation.md decided against; and `<slot>` writes anchors
 * `{@render}` does not, so it is not a spelling and stays refused in the walk. See spec/roadmap.md.
 */
export function runed(source: string): string {
	const ast = parse(source, { modern: true }) as unknown as AstNode;
	const instance = ast['instance'];
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const edits: [number, number, string][] = [];
	const props: string[] = [];
	let first: number | null = null;

	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const declaration = statement['declaration'];
		const at = span(statement);
		if (at === null) continue;
		if (!isNode(declaration) || declaration['type'] !== 'VariableDeclaration') {
			refuse(
				'`export` of something other than a `let` in a component script is a readonly export, ' +
					'which a render never writes and this compiler does not follow',
			);
		}
		if (declaration['kind'] === 'const') {
			refuse(
				'`export const` in a component script is a readonly export, which a render never ' +
					'writes and this compiler does not follow',
			);
		}
		for (const one of Array.isArray(declaration['declarations'])
			? declaration['declarations']
			: []) {
			if (!isNode(one)) continue;
			const id = one['id'];
			if (!isNode(id) || id['type'] !== 'Identifier' || typeof id['name'] !== 'string') {
				refuse('`export let` of a pattern is not a prop this compiler can name');
			}
			const init = span(one['init']);
			props.push(init === null ? id['name'] : `${id['name']} = ${source.slice(init[0], init[1])}`);
		}
		first ??= at[0];
		edits.push([at[0], at[1], '']);
	}
	if (first === null) return source;
	edits.push([first, first, `let { ${props.join(', ')} } = $props();`]);
	return apply(source, edits);
}
