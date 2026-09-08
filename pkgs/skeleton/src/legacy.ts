import { parse } from 'svelte/compiler';
import { apply, bySource } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';

/**
 * A legacy-mode prop, written the way runes mode writes it -- for a **child**, and no longer for
 * the entry.
 *
 * **`$props()` puts the file in runes mode, and `analysis.runes` decides more than how props are
 * declared.** Measured: `2-analyze/visitors/Component.js` gates `metadata.dynamic` on it, so a
 * namespaced tag is a dynamic component in runes mode and not in legacy, and the server writes
 * `<!--[-->` and `<!--]-->` around a dynamic one; `LabeledStatement.js` collects `$:` into
 * `legacy_reactive_statements` and orders them topologically only in legacy; and 63 of the corpus's
 * refusals are Svelte's own errors against files the author wrote as valid legacy Svelte --
 * `beforeUpdate` in runes mode, `bind:` to an each argument, a store read as `$state is not
 * defined`. None of those is a construct this compiler turned away.
 *
 * So the entry is read where it is written: `propsOf` takes `export let` and `export { a as b }`
 * as props, and `locals` is told which names those are so it leaves them free rather than
 * substituting their initialisers. A child still comes through here, because taking the rewrite
 * off children as well was measured and is worse -- 1163 identical against 1155 -- and why is not
 * yet read out. See spec/roadmap.md.
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
export const runed: (given: string) => string = bySource((source) => {
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
		// A readonly export -- `export const`, `export function`, `export class` -- which is not a
		// prop: a caller cannot pass one, and it reaches a caller only through `bind:this`. The
		// declaration is an ordinary one and the markup reads it like any other name, so what has to
		// go is the keyword rather than the component. It used to be refused outright, which turned
		// away every component that happened to export a helper beside its props.
		//
		// They are in `analysis.exports`, which `transform-server.js` passes to `$.bind_props`
		// alongside the bindable props, so a caller that binds one does get it back. That is the
		// `bind:` question and is refused where the walk can see it; nothing here writes it.
		const kind = isNode(declaration) ? declaration['type'] : '';
		const held = isNode(declaration) ? declaration['kind'] : undefined;
		const readonly =
			kind === 'FunctionDeclaration' ||
			kind === 'ClassDeclaration' ||
			(kind === 'VariableDeclaration' && held !== 'let' && held !== 'var');
		// Left exactly as written: `export const`, `export function` and `export class` are legal in
		// runes mode, so the rewrite has nothing to do to them, and leaving them keeps the one thing
		// that says they are exports -- which `descend()` reads when a caller binds one.
		if (readonly) continue;
		if (!isNode(declaration) || declaration['type'] !== 'VariableDeclaration') {
			refuse(
				'`export` of something other than a declaration in a component script is not a prop ' +
					'this compiler can name: a prop is `export let`, and a renaming export is not ' +
					'written yet. See spec/refusals.md',
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
			// `$bindable`, because `export let` is one. `transform-server.js` ends a component with
			// `$.bind_props($$props, { ... })` over its `bindable_prop` declarations, and
			// `internal/server`'s `bind_props` assigns each back to the parent where the parent
			// passed `undefined` and its props object has a setter for the key -- which is what a
			// parent's `bind:` writes. In legacy mode every `export let` is a `bindable_prop`; in
			// runes mode only a `$bindable()` one is. So the plain rewrite silently dropped the
			// propagation, and this restores it: measured, `export let x` and
			// `let { x = $bindable() } = $props()` produce the same `$.bind_props` call, with a
			// default and without, and a child nobody binds is unaffected because the check for a
			// setter fails.
			const held = init === null ? '' : source.slice(init[0], init[1]);
			props.push(`${id['name']} = $bindable(${held})`);
		}
		first ??= at[0];
		edits.push([at[0], at[1], '']);
	}
	if (first === null) return source;
	edits.push([first, first, `let { ${props.join(', ')} } = $props();`]);
	return apply(source, edits);
});
