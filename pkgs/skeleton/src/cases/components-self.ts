/**
 * Components that render themselves, directly, through `<svelte:self>`, or around a cycle.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		// The same wrapper inside itself. Its copy is numbered when it is taken rather than when
		// the tag is renamed, because the walk between the two takes copies of its own.
		name: 'a wrapper inside itself',
		beside: {
			Nest: '<script>let { children } = $props();</script><div>{@render children()}</div>',
		},
		source:
			"<script>import Nest from './Nest.svelte'; let { data } = $props();</script>" +
			'<Nest><Nest><b>{data.a}</b></Nest></Nest>',
		data: [{ a: 'x' }],
	},
	{
		// A child the walk enters whose markup calls a function *it* imported. The expression
		// becomes a derivation in the entry's artifact, and what a derivation may call is whatever
		// the carried bundle holds -- which was read from the entry's own imports alone, so the
		// name resolved at compile time and threw `ReferenceError` at request time. Nothing in the
		// compile said so, because the render never evaluates a derivation.
		name: 'a child that calls a function it imported itself',
		// Named `Calls` on purpose: another case has a `Calls` too, and staging each case in its own
		// directory is what lets both exist. Renaming this one is how the collision was first dodged.
		beside: {
			Calls:
				"<script>import { shout } from './helper.ts'; let { word } = $props();</script>" +
				'<b>{shout(word)}</b>',
		},
		alongside: { 'helper.ts': 'export const shout = (v) => String(v).toUpperCase() + "!";' },
		source:
			"<script>import Calls from './Calls.svelte'; let { data } = $props();</script>" +
			'<Calls word={data.a} />',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// The same through a component importing its own file: `build_inline_component` calls the
		// component itself. The component is entered as the fragment it is, its props names bound
		// per call, and the call inside it stands in as a copy whose whole body is the marker.
		name: 'a component that imports itself',
		beside: {
			Tree:
				"<script>import Tree from './Tree.svelte'; let { node, depth = 0 } = $props();</script>" +
				'<li data-depth={depth}>{node.label}{#each node.children ?? [] as child}<ul><Tree node={child} depth={depth + 1} /></ul>{/each}</li>',
		},
		source: `<script>import Tree from './Tree.svelte'; let { data } = $props();</script><ul><Tree node={data.tree} /></ul>`,
		data: [
			{
				tree: {
					label: 'a',
					children: [
						{ label: 'b', children: [] },
						{ label: 'c', children: [{ label: 'd' }] },
					],
				},
			},
			{ tree: { label: 'only' } },
		],
	},
	{
		// And through `<svelte:self>`, which `SvelteSelf.js` compiles to the same call.
		name: 'a component that renders itself with svelte:self',
		beside: {
			Nest:
				'<script>let { node } = $props();</script>' +
				'<li>{node.label}{#each node.children ?? [] as child}<ul><svelte:self node={child} /></ul>{/each}</li>',
		},
		source: `<script>import Nest from './Nest.svelte'; let { data } = $props();</script><ul><Nest node={data.tree} /></ul>`,
		data: [
			{ tree: { label: 'a', children: [{ label: 'b', children: [{ label: 'c' }] }] } },
			{ tree: { label: '&', children: [] } },
		],
	},
	{
		// The entry itself, whose props are the payload: the first call binds them to the payload's
		// own paths, and every `<svelte:self>` inside binds them to what it passes.
		name: 'an entry that renders itself with svelte:self',
		source: `${PROPS}<li>{data.label}{#each data.children ?? [] as child}<ul><svelte:self data={child} /></ul>{/each}</li>`,
		data: [{ label: 'a', children: [{ label: 'b', children: [{ label: 'c' }] }] }, { label: '&' }],
	},
	{
		// A cycle through a second component: `Tree` renders `Branch` renders `Tree`. Both are on
		// the cycle, read off their imports before the walk goes in, so both are entered as
		// fragments, and `Tree` met again inside `Branch` is a call of the fragment it became.
		name: 'a cycle through a second component',
		beside: {
			Tree:
				"<script>import Branch from './Branch.svelte'; let { node } = $props();</script>" +
				'<li>{node.label}{#if node.children}<Branch items={node.children} />{/if}</li>',
			Branch:
				"<script>import Tree from './Tree.svelte'; let { items } = $props();</script>" +
				'<ul>{#each items as item}<Tree node={item} />{/each}</ul>',
		},
		source: `<script>import Tree from './Tree.svelte'; let { data } = $props();</script><ul><Tree node={data.tree} /></ul>`,
		data: [
			{
				tree: {
					label: 'a',
					children: [{ label: 'b' }, { label: 'c', children: [{ label: 'd' }] }],
				},
			},
			{ tree: { label: 'only' } },
		],
	},
	{
		// A slot group is a fragment of the caller's and Svelte reads `is_standalone` for it, so the
		// one node it holds is read there rather than inherited from the component the `<slot>`
		// sits in. `is_standalone` names `RenderTag` and `Component`; a `SvelteSelf` is neither, so
		// Svelte writes the anchor for one alone in a slot and the stand-in replacing it would not.
		name: 'a component rendering itself as the one node of a slot',
		beside: {
			Down: '<script>export let n;</script>{#if n > 0}<slot n={n - 1} />{/if}',
		},
		source:
			"<script>import Down from './Down.svelte'; let { data } = $props();</script>" +
			'{data.n}<Down n={data.n} let:n><svelte:self data={{ n }} /></Down>',
		data: [{ n: 3 }, { n: 0 }],
	},
];
