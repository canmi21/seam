/**
 * Components rendered by Svelte per request in the bytes the program writes: declared so, or
 * degraded to it by a refusal. Cases `skeleton.test.ts` runs; what has to move up to a caller is
 * in `refusedBySsr` below, since in a case the caller is the entry. See spec/together.md.
 */
import { type Case } from './case.ts';

/** A child that doubles what it is handed and writes it, in a module script declared SSR. */
const DECLARED =
	"<script module>export const seam = 'ssr';</script>" +
	'<script>let { n, label } = $props(); const doubled = n * 2;</script>' +
	'<p class="x">{label}: {doubled}</p><style>.x { color: red; }</style>';

export const cases: Case[] = [
	{
		// Rendered where it is called, between markup of the caller's on both sides, and its props
		// computed per request from the caller's data.
		name: 'a component declared SSR',
		beside: { Doubled: DECLARED },
		source:
			"<script>import Doubled from './Doubled.svelte'; let { data } = $props();</script>" +
			'<h1>{data.t}</h1><Doubled n={data.n} label="sum" /><footer>{data.t}</footer>',
		data: [
			{ t: 'a', n: 2 },
			{ t: '<&', n: 0 },
		],
	},
	{
		// Inside a block and an each, where the anchors around a component call are the caller's.
		name: 'a component declared SSR inside an each',
		beside: { Doubled2: DECLARED },
		source:
			"<script>import Doubled2 from './Doubled2.svelte'; let { data } = $props();</script>" +
			'{#each data.xs as x}{#if x > 1}<Doubled2 n={x} label={`item ${x}`} />{:else}<i>small</i>{/if}{/each}',
		data: [{ xs: [1, 2, 3] }, { xs: [] }],
	},
	{
		// A legacy prop the child changes, which the walk refuses where the child is handed a
		// marker: degraded, the child is rendered by Svelte per request instead of failing.
		name: 'a component the walk refuses, degraded to SSR',
		beside: { Bumps: '<script>export let value; value += 1;</script><b>{value}</b>' },
		source:
			"<script>import Bumps from './Bumps.svelte'; let { data } = $props();</script>" +
			'<div><Bumps value={data.n} /></div>',
		data: [{ n: 1 }, { n: 41 }],
	},
];

export const refusedBySsr: Case[] = [
	{
		name: 'a component declared SSR handed markup by the entry',
		beside: {
			Wraps:
				"<script module>export const seam = 'ssr';</script><script>let { children } = $props();</script><div>{@render children()}</div>",
		},
		source: "<script>import Wraps from './Wraps.svelte';</script><Wraps><b>inside</b></Wraps>",
		says: 'hands it markup',
	},
	{
		name: 'a component declared SSR below a component that sets a context',
		beside: {
			Reads:
				"<script module>export const seam = 'ssr';</script><script>import { getContext } from 'svelte'; const c = getContext('k');</script><p>{c}</p>",
		},
		source:
			"<script>import { setContext } from 'svelte'; import Reads from './Reads.svelte'; setContext('k', 'v');</script><Reads />",
		says: 'sets a context',
	},
	{
		name: 'a component declared SSR that writes a head',
		beside: {
			Heads:
				'<script module>export const seam = \'ssr\';</script><svelte:head><meta name="a" content="b" /></svelte:head><p>x</p>',
		},
		source: "<script>import Heads from './Heads.svelte';</script><Heads />",
		says: 'writes a `<svelte:head>`',
	},
];
