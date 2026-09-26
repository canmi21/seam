/**
 * Components the walk cannot enter -- a package, a descent that stops -- and what is handed to them.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case } from './case.ts';

export const cases: Case[] = [
	{
		// A child the walk cannot enter -- its `$props()` gathers a rest, which is a set of keys at
		// the call site rather than a value -- that does render what it was given. From outside it
		// there is no anchor around what it writes, so the second render is what says so: the
		// markup is replaced by a literal nobody could produce and the literal comes back. Holding
		// a block, because a block wrongly called absent leaves the order the assembler counts and
		// the branch nobody rendered is the one that goes missing. See spec/refusals.md.
		name: 'markup given to a child the walk cannot enter, which writes it',
		beside: {
			Opaque:
				'<script>let { children, ...rest } = $props();</script>' +
				'<div>{@render children()}</div>',
		},
		source:
			"<script>import Opaque from './Opaque.svelte'; let { data } = $props();</script>" +
			'<Opaque><b>{data?.a}</b>{#if data?.f}<i>{data?.a}</i>{:else}<u>n</u>{/if}</Opaque>',
		data: [
			{ a: 'x', f: true },
			{ a: '<&', f: false },
		],
	},
	{
		// The same child, writing none of what it was given, which is what a portal and a closed
		// dialog do. The literal does not come back either, so every marker inside is allowed not
		// to -- on that evidence, never on the absence itself. See spec/refusals.md.
		name: 'markup given to a child the walk cannot enter, which writes none of it',
		beside: {
			Shut: '<script>let { children, ...rest } = $props();</script><div>fixed</div>',
		},
		source:
			"<script>import Shut from './Shut.svelte'; let { data } = $props();</script>" +
			'<Shut><b>{data.a}</b>{#if data.f}<i>{data.a}</i>{/if}</Shut>',
		data: [
			{ a: 'x', f: true },
			{ a: '<&', f: false },
		],
	},
	{
		// One of those inside another. The literal is inserted at the head of each group rather
		// than written in place of the markup, which is what lets one render answer for both: a
		// replacement erases every group nested inside it, and the inner component then reads as
		// never having been asked about -- which the arithmetic reported as a contradiction.
		name: 'markup given to one unenterable child inside another',
		beside: {
			Opaque2:
				'<script>let { children, ...rest } = $props();</script>' +
				'<div>{@render children()}</div>',
		},
		source:
			"<script>import O from './Opaque2.svelte'; let { data } = $props();</script>" +
			'<O><O><b>{data.a}</b></O></O>',
		data: [{ a: 'x' }],
	},
	{
		// A descent that stops is rolled back and the component is left to Svelte, which is what
		// keeps this from refusing what already worked. What it appended has to go back too: the
		// group it recorded on the way in outlived the holes it was measured against, so a
		// component the walk never entered was still asked whether its markup came back, over
		// indices that by then belonged to somebody else. A name assigned after it is declared is
		// the refusal here because it writes no anchors, so what is left is the rollback and
		// nothing else.
		name: 'a descent that stops takes its records back with it',
		beside: {
			Shed: '<script>let { children, ...rest } = $props();</script><div>{@render children()}</div>',
			Stops:
				"<script>import Shed from './Shed.svelte'; let { v } = $props(); let k = 1; k = 2;</script>" +
				'<Shed><b>{v}</b></Shed><i>{k}</i>',
		},
		source:
			"<script>import Stops from './Stops.svelte'; let { data } = $props();</script>" +
			'<Stops v={data.a} /><em>{data.b}</em>',
		data: [{ a: 'x', b: 'y' }],
	},
	{
		// A component the walk cannot enter -- its `$props()` gathers a rest -- that declares an id
		// of its own, which is what a package does: a trigger names the panel it opens by one. Its
		// output is Svelte's, so the id is read back off the render as a marker rather than held in
		// a hole, because Svelte numbers ids per render and a hole belongs to every render at once.
		// Inside an each, where one static id would repeat, and read in an attribute as well as in
		// content, which is where a package puts it. See `anchored()`.
		name: 'an id declared by a component the walk cannot enter',
		beside: {
			Panel:
				'<script>let { label, ...rest } = $props(); const id = $props.id();</script>' +
				'<button aria-controls="p-{id}">{label}</button><div id="p-{id}">{id}</div>',
		},
		source:
			"<script>import Panel from './Panel.svelte'; let { data } = $props();</script>" +
			'{#each data.xs as x}<Panel label={x} />{/each}{#if data.f}<Panel label={data.a} />{/if}',
		data: [
			{ xs: ['p', 'q'], f: true, a: 'x' },
			{ xs: [], f: false, a: '' },
			{ xs: ['<&'], f: true, a: '<&' },
		],
	},
	{
		// A value handed to a component the walk could not enter, written as an object. One marker
		// for the whole of it makes the component's own read -- `i.count` -- undefined, because a
		// string has no fields; the marker goes on each value instead, so what arrives is still an
		// object and only what the component writes out is standing in. Paraglide's `inputs` is
		// this shape, and it is how a translated string gets a number put inside it.
		name: 'an object handed to a child the walk cannot enter',
		beside: {
			Reads:
				'<script>let { inputs, ...rest } = $props();</script>' +
				'<i>{inputs.count}</i><b>{inputs.deep.name}</b><u>{inputs.list[0]}</u>',
		},
		source:
			"<script>import Reads from './Reads.svelte'; let { data } = $props();</script>" +
			'<Reads inputs={{ count: data.n, deep: { name: data.a }, list: [data.a] }} />',
		data: [
			{ n: 3, a: 'x' },
			{ n: 0, a: '<&' },
		],
	},
	{
		// A package's component is a component like any other. The bare specifier is resolved
		// through the package's `exports` under the `svelte` condition and the export followed
		// through the re-exports a `svelte-package` build writes -- `export * as`, `export { default
		// as }` -- to the file, and the walk enters it as it enters the project's own. What that
		// buys is what an unentered child cannot have: a value it transforms, a spread it writes.
		name: 'a component from a package',
		installed: {
			'kit/package.json': JSON.stringify({
				name: 'kit',
				type: 'module',
				exports: {
					'.': { svelte: './index.js', default: './index.js' },
					'./icons/*': { svelte: './icons/*.svelte' },
				},
			}),
			'kit/index.js':
				"export * as Kit from './kit/exports.js';\nexport { default as Badge } from './badge.svelte';",
			'kit/kit/exports.js':
				"export { default as Root } from './root.svelte';\nexport { default as Item } from '../item.svelte';",
			'kit/kit/root.svelte':
				'<script>let { children, tone } = $props();</script><section class={tone}>{@render children?.()}</section>',
			'kit/item.svelte': '<script>let { n, ...rest } = $props();</script><b {...rest}>{n * 2}</b>',
			'kit/badge.svelte': '<script>let { label } = $props();</script><i>{label.toUpperCase()}</i>',
			'kit/icons/star.svelte':
				'<script>let { size = 1 } = $props();</script><svg width={size}></svg>',
		},
		source:
			"<script>import { Kit, Badge } from 'kit'; import Star from 'kit/icons/star'; let { data } = $props();</script>" +
			'<Kit.Root tone={data.t}><Kit.Item n={data.n} id={data.i} /><Badge label={data.l} /></Kit.Root><Star size={data.s} />',
		data: [
			{ t: 'warm', n: 2, i: 'x', l: 'ok', s: 3 },
			{ t: '', n: 0, i: '<', l: 'a&b', s: 0 },
		],
	},
];
