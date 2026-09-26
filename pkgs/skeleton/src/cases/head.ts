/**
 * The head stream: titles, head blocks, and a child's head merged into the entry's.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		name: 'the head and a title',
		source: `${PROPS}<svelte:head><meta name="d" content={data.a} /><title>{data.a}</title></svelte:head><p>x</p>`,
		data: [{ a: 'v' }, { a: null }],
	},
	{
		// `set_title` in `internal/server/renderer.js` keeps the title whose render path compares
		// later, and `$.head` is hoisted ahead of its fragment, so a child's head block runs after
		// its parent's and wins whichever order they are written in, a later sibling wins over an
		// earlier one, and inside one head block the first title executed is kept: a top-level one
		// before any inside a block. Measured against Svelte for every case here.
		name: 'which title wins',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><title>kid {t}</title></svelte:head><i>k</i>',
			Kid2: '<script>let { t } = $props();</script><svelte:head><title>kid2 {t}</title></svelte:head><i>k</i>',
			Deep: "<script>import Kid from './Kid.svelte'; let { t } = $props();</script><Kid {t} /><svelte:head><title>deep {t}</title></svelte:head>",
		},
		source:
			"<script>import Kid from './Kid.svelte'; import Kid2 from './Kid2.svelte'; import Deep from './Deep.svelte'; let { data } = $props();</script>" +
			'<svelte:head>{#if data.f}<title>B {data.a}</title>{/if}<title>A {data.a}</title><title>C</title></svelte:head>' +
			'{#if data.g}<Kid t={data.t} />{/if}{#if data.h}<Deep t={data.t} /><Kid2 t={data.t} />{/if}<p>{data.a}</p>',
		data: [
			{ f: true, g: false, h: false, a: 'x', t: 'T' },
			{ f: false, g: true, h: false, a: 'y', t: '<' },
			{ f: true, g: true, h: true, a: 'z', t: 'U' },
			{ f: false, g: false, h: true, a: 'w', t: 'V' },
		],
	},
	{
		// `clean_nodes` hoists a title out of its fragment, so the whitespace around it is trimmed
		// where it opened or closed the fragment and one space where two neighbours remain. The
		// stand-in stays in the fragment, and the whitespace is written as hoisting leaves it.
		name: 'a title among the whitespace of its head',
		beside: {
			Mid: '<svelte:head>\n\t<meta name="a" />\n\t<title>M</title>\n\t<meta name="b" />\n</svelte:head>',
			Last: '<svelte:head>\n\t<meta name="c" />\n\t<title>L</title>\n</svelte:head>',
		},
		source:
			"<script>import Mid from './Mid.svelte'; import Last from './Last.svelte'; let { data } = $props();</script>" +
			'<svelte:head>\n\t<title>F {data.a}</title>\n\t<meta name="d" />\n\t{#if data.f}\n\t\t<title>I</title>\n\t{/if}\n\t<meta name="e" />\n</svelte:head>' +
			'{#if data.g}<Mid /><Last />{/if}<p>{data.a}</p>',
		data: [
			{ a: 'x', f: true, g: true },
			{ a: 'y', f: false, g: false },
		],
	},
	{
		// A fragment that writes a head stands in the head stream too, its head half a fragment of
		// its own that every call of it calls, so the head holds one block per level and the deepest
		// last level's title wins as the last head block executed. And a rest is a parameter bound
		// per call to what the call wrote and the pattern did not name.
		name: 'a component that renders itself with a head and a rest',
		beside: {
			Tree:
				"<script>import Tree from './Tree.svelte'; let { node, ...rest } = $props();</script>" +
				'<svelte:head><meta name="n" content={node.label} /><title>T {node.label}</title></svelte:head>' +
				'<li {...rest}>{node.label}{#each node.children ?? [] as child}<ul><Tree node={child} title={child.label} /></ul>{/each}</li>',
		},
		source: `<script>import Tree from './Tree.svelte'; let { data } = $props();</script><ul><Tree node={data.tree} class="root" /></ul>`,
		data: [
			{
				tree: {
					label: 'a',
					children: [{ label: 'b' }, { label: 'c', children: [{ label: 'd' }] }],
				},
			},
			{ tree: { label: '<&' } },
		],
	},
	{
		// `$.head` runs where the component does, so a headed child inside an each writes one head
		// block per item and one inside an if writes one per branch taken, and the head is a flat
		// run of head blocks with nothing around the ones a block produced. The walk stands the
		// block in the head stream as well: a `{@const}` at the start of each branch opens it and
		// an expression tag beside the stamp closes it, neither touching the body's bytes. The head
		// IR then carries the each and the if the body does. The last item's title wins, as the
		// last head block executed. See `mirrored()` in stamps.ts and spec/ir.md.
		name: 'a component with a head inside an each',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /><title>K {t}</title></svelte:head>k{t}',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<svelte:head><title>A</title></svelte:head>\n{#each data.xs as x}\n\tx{x}<Kid t={x} />\n{/each}\n' +
			'{#each data.ys as y}<p>{y}</p>{:else}<Kid t="none" />{/each}<p>{data.a}</p>',
		data: [
			{ xs: [1, 2], ys: ['q'], a: 'v' },
			{ xs: [], ys: [], a: 'w' },
			{ xs: ['<'], ys: [], a: '' },
		],
	},
	{
		// The same for an if: one head block on the branch that holds the child and none on the
		// others, through an `{:else if}` chain and an if with no else, whose render not taken has
		// to hold the block all the same.
		name: 'a component with a head inside a branch',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /></svelte:head><i>k</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<p>a</p>\n{#if data.g}<Kid t="g" />{:else if data.h}<Kid t="h" />{:else}<b>n</b>{/if}\n' +
			'{#if data.g}<Kid t={data.t} />{/if}\n<p>b</p>',
		data: [
			{ g: true, h: false, t: 'T' },
			{ g: false, h: true, t: 'T' },
			{ g: false, h: false, t: 'T' },
		],
	},
	{
		// Two blocks deep, in a table: the inner if stands in the head inside the outer each, and
		// the close rides inside the `<template>` the stamp needs where text is refused.
		name: 'a component with a head two blocks deep in a table',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /></svelte:head><i>k</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<table><tbody>{#each data.rows as r}<tr><td>{#if r.on}<Kid t={r.t} />{/if}<Kid t="row" /></td></tr>{/each}</tbody></table>',
		data: [
			{
				rows: [
					{ on: true, t: 'a' },
					{ on: false, t: 'b' },
				],
			},
			{ rows: [] },
		],
	},
];
