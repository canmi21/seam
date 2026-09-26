/**
 * Components the request chooses: `<svelte:component>` and a `this` the run or the payload decides.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case } from './case.ts';

export const cases: Case[] = [
	{
		// A component the request hands in that the source names none of: nothing for a value that is
		// nothing, as Svelte writes, and a throw per request for anything else -- see below.
		name: 'a dynamic component chosen by the request',
		source: '<script>let { data } = $props(); const Pick = $derived(data.c);</script><Pick />',
		data: [{ c: null }, {}],
	},
	{
		// A tag naming a `$derived`, which Svelte's analysis reads as a dynamic component and
		// writes anchors around. The declaration reads a fixed path, so the render was handed a
		// literal for it and rendered nothing; the tag is rewritten to `<svelte:component>` with
		// the expression expanded, which is the same dynamic call. See spec/refusals.md.
		name: 'a dynamic component from a derived declaration',
		beside: {
			Ay: '<script>let { v } = $props();</script><i>A{v}</i>',
			Bee: '<script>let { v } = $props();</script><b>B{v}</b>',
		},
		source:
			"<script>import Ay from './Ay.svelte'; import Bee from './Bee.svelte'; let { data } = $props();" +
			" const Pick = $derived(data.k === 'a' ? Ay : Bee);</script><Pick v={data.x} /><p>{data.x}</p>",
		fixed: { 'data.k': '"a"' },
		data: [
			{ k: 'a', x: '1' },
			{ k: 'a', x: '<&' },
		],
	},
	{
		// The payload carries data and no function -- spec/payload.md -- so a component never comes
		// off the wire, and the only component a `this` the request decides can hold is the one the
		// source itself names. That bounds the choice to two outcomes, the component and nothing,
		// which is what Svelte's server writes: `build_inline_component` compiles the tag to
		// `if (X) { BLOCK_OPEN; X(...); } else { BLOCK_OPEN_ELSE; }`. The `&&` is what makes the
		// truthy side exactly the import. See spec/roadmap.md.
		name: 'a dynamic component the request decides, named beside an `&&`',
		beside: { Wid: '<script>export let v;</script><i>W{v}</i>' },
		source:
			"<script>import Wid from './Wid.svelte'; export let flag = true; export let n = 1;</script>" +
			'<svelte:component this={flag && Wid} v={n} /><p>after</p>',
		props: [{ flag: true, n: 2 }, { flag: false, n: 3 }, {}],
	},
	{
		// The candidate through a prop's default rather than out of the expression. A default is the
		// value the request did not send, and the request cannot send a component, so a default
		// naming one is the only component that name can hold. The default is then not in the
		// derivation scope either -- the carried bundle drops a component on purpose -- so it stands
		// there for the one thing a derivation can ask of a component: that it exists.
		name: 'a dynamic component the request decides, named by a default',
		beside: { Eff: '<p>F</p>' },
		source:
			"<script>import Eff from './Eff.svelte'; export let x = Eff;</script>" +
			'<svelte:component this={x} /><p>{x ? "y" : "n"}</p>',
		props: [{}, { x: null }],
	},
	{
		// `build_inline_component` builds the props object **inside** the `if`, so a `this` the source
		// has already settled to nothing renders `<!--[!--><!--]-->` and evaluates neither the
		// attributes nor the children. A spread whose keys this compiler cannot list never has to be
		// listed there.
		name: 'a `<svelte:component>` whose `this` is nothing',
		source:
			'<script>let { data, extra } = $props();</script>' +
			'<svelte:component this={undefined} {...extra}><p>{nowhere}</p></svelte:component>' +
			'<p>{data.a}</p>',
		props: [{ data: { a: 'x' }, extra: { k: 1 } }, { data: { a: '<&' } }],
	},
];
