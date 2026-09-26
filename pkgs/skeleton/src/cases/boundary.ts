/**
 * Boundaries: what a `<svelte:boundary>` renders per request, and errors the render answers.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		name: 'a block on each side of the boundary',
		beside: {
			Half:
				'<script>let { children, f } = $props();</script>' +
				'{#if f}<div>{@render children()}</div>{:else}<p>n</p>{/if}',
		},
		source:
			"<script>import Half from './Half.svelte'; let { data } = $props();</script>" +
			'<Half f={data.f}>{#each data.xs as x}<i>{x}</i>{/each}</Half>',
		data: [
			{ f: true, xs: ['p', 'q'] },
			{ f: false, xs: [] },
			{ f: true, xs: [] },
		],
	},
	{
		// On the server a boundary writes `<!--[-->`, its children, `<!--]-->`. The failed snippet
		// is never written, and the error handler never runs.
		name: 'a boundary',
		source:
			'<script>let { data } = $props(); function f() {}</script>' +
			'<svelte:boundary onerror={f}><p>{data.a}</p>{#if data.f}<b>y</b>{/if}' +
			'{#snippet failed(e)}<i>{e}</i>{/snippet}</svelte:boundary>',
		data: [
			{ a: 'x', f: true },
			{ a: '<&', f: false },
		],
	},
	{
		// `shared/element.js` pushes ` onload="this.__e=event" onerror="this.__e=event"` after the
		// attributes of a load or error element carrying a spread. The spread replaces the whole
		// attribute run with one call, so those two literals are inside what its marker stands for
		// and have to be written back with it.
		name: 'a spread on an element that fires load and error',
		source: `${PROPS}<img alt="" {...data.rest} /><span {...data.rest}></span>`,
		data: [{ rest: { width: '100%', src: 'x' } }, { rest: {} }],
	},
];
