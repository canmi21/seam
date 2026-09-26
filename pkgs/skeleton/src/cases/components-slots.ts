/**
 * What a component is handed: slots, fragments, `let:` names, markup and constants at the call site.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case } from './case.ts';

export const cases: Case[] = [
	{
		// Markup inside a component's tag is an arrow function passed as `children`, and the child
		// renders it with `{@render children()}`. So it is walked where the child renders it, not
		// where it was written: the markers go into the caller's source, which is where Svelte
		// compiled the body, and the blocks are numbered where the assembler will meet them.
		name: 'a wrapper around markup',
		beside: {
			Wrap: '<script>let { children, cls } = $props();</script><div class={cls}>{@render children()}</div>',
		},
		source:
			"<script>import Wrap from './Wrap.svelte'; let { data } = $props();</script>" +
			'<Wrap cls={data.b}><b>{data.a}</b></Wrap>',
		data: [
			{ a: 'x', b: 'c' },
			{ a: '<&', b: null },
		],
	},
	{
		// A child that never renders what it was given. Svelte writes none of it, and so does this.
		name: 'a wrapper that renders none of it',
		beside: { Drop: '<script>let { children } = $props();</script><div>fixed</div>' },
		source:
			"<script>import Drop from './Drop.svelte'; let { data } = $props();</script>" +
			'<Drop><b>{data.a}</b></Drop>',
		data: [{ a: 'x' }],
	},
	{
		// What a route is: a page inside its layout. Both halves are one walk, so the layout's head
		// and the page's markup come out of one render.
		name: 'a layout around a page',
		beside: {
			Layout:
				'<script>let { children } = $props();</script>' +
				'<svelte:head><meta name="l" content="v" /></svelte:head><header>h</header>' +
				'{@render children()}<footer>f</footer>',
			Page: '<script>let { data } = $props();</script><main>{data.a}</main>',
		},
		source:
			"<script>import Layout from './Layout.svelte'; import Page from './Page.svelte';" +
			' let { data } = $props();</script><Layout><Page {data} /></Layout>',
		data: [{ a: 'x' }],
	},
	{
		// A group handed to a component is a fragment of the caller's and Svelte cleans it the same
		// way, so a `{@const}` in one is hoisted and binds for its siblings. The group's nodes used
		// to be walked one at a time, which sent every one of these to the arm that refuses what the
		// walk has not been taught.
		name: 'a `{@const}` inside markup handed to a component',
		beside: { Kid: '<slot name="a" /><slot />' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid><svelte:fragment slot="a">{@const t = data.a + "!"}<b>{t}</b></svelte:fragment>' +
			'{@const u = data.a}<i>{u}</i></Kid>',
		data: [{ a: 'v' }],
	},
	{
		// A group is one span of the caller's source and walking it rewrites that span. A component
		// rendering the same group from a second `<slot>` -- with different props, which is the only
		// reason to -- wants a second rewrite of the same characters. It used to reach `apply` as
		// `two edits cover 103..108`, which names offsets rather than a question; now the walk says
		// what it is and leaves the component to Svelte, which renders it right.
		name: 'markup a component renders from two slots',
		beside: { Twice: '<slot key="a" /><slot key="b" />' },
		source:
			"<script>import Twice from './Twice.svelte'; let { data } = $props();</script>" +
			'<p>{data.a}</p><Twice let:key><b>{key}</b></Twice>',
		data: [{ a: 'v' }],
	},
	{
		// Markup handed to a component the walk could not enter is a fragment of the caller's, and
		// `clean_nodes` cleans it the same way: a `{@const}` among it binds for all of it and writes
		// no bytes of its own. Walked one node at a time to keep each group's holes apart, it reached
		// the arm that refuses what the walk has not been taught -- the same fault a `<slot>`'s own
		// group had, one construct along.
		name: 'a `{@const}` among the markup handed to a component',
		beside: { Boxy: '<div><slot /></div>' },
		source:
			"<script>import Boxy from './Boxy.svelte'; let { data } = $props();</script>" +
			'<Boxy><p>a</p>{@const twice = data.n * 2}<p>{twice}</p></Boxy>',
		data: [{ n: 3 }],
	},
	{
		// `let:thing={{ n }}` is a pattern rather than a name. `build_inline_component` writes it
		// straight into the slot function's parameter, `{ thing: { n } }`, so each name in it reaches
		// the slot prop the way a `{@const}`'s pattern reaches into its initialiser -- and
		// `takenApart`, which is Svelte's own `_extract_paths` read forward, says how.
		name: 'a `let:` that takes a pattern apart',
		beside: { Nest: '<script>export let thing;</script><div><slot {thing} /></div>' },
		source:
			"<script>import Nest from './Nest.svelte'; let { data } = $props();</script>" +
			'<Nest thing={data.t} let:thing={{ n }}><span>{n}</span></Nest>',
		data: [{ t: { n: 'v' } }, { t: { n: '<&' } }],
	},
	{
		// A `--x` on a component is not a prop: `build_inline_component` collects it into
		// `custom_css_props` and `$.css_props` writes it into a wrapper's `style`, escaped the way
		// an attribute is. It takes a marker like any other value written into the bytes, where it
		// was being neutralised to `null` and dropped.
		name: 'a custom property handed to a component',
		beside: { Kid: '<div>hi</div><style>div { background: var(--color) }</style>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid --color={data.c} />',
		data: [{ c: 'red' }, { c: '" onload="alert(1)' }],
	},
	{
		// `SlotElement.js` writes `block_open`, `$.slot(...)`, `block_close`, and `$.slot` calls what
		// the caller put under this name in `$$slots` or, where the caller put nothing, the element's
		// own children as the fallback. Both stay in the source for Svelte to render -- the caller's
		// tag still holds its children, so the copy is handed them as the original would have been.
		// What the walk does is walk whichever of the two renders, in the scope it was written in.
		//
		// A `let:` name is bound by the slot rather than read from the caller's scope, so it shadows
		// a declaration of the same name there: `count` below is the child's, not the caller's.
		name: 'a `<slot>`, a named one, a fallback and a `let:`',
		beside: {
			Card:
				'<script>let { data } = $props(); const count = 3;</script>' +
				'<article><slot name="head">fallback head</slot>' +
				'<slot {count} />' +
				'<slot name="foot">fallback foot</slot></article>',
		},
		source:
			"<script>import Card from './Card.svelte'; let { data } = $props(); const count = 'outer';" +
			'</script><Card {data} let:count>' +
			'<h1 slot="head">{data.a}</h1>' +
			'<p>{count}/{data.a}</p>' +
			'</Card><i>{count}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// A wrapper that writes nothing of its own: it carries a `slot=` and its `let:` directives,
		// and its children are the group.
		name: 'a `<svelte:fragment>` filling a named slot',
		beside: {
			Card:
				'<script>const rows = [1, 2];</script>' +
				'<article><slot name="body" {rows}>none</slot></article>',
		},
		source:
			"<script>import Card from './Card.svelte'; let { data } = $props();</script>" +
			'<Card><svelte:fragment slot="body" let:rows><b>{rows.length}</b><i>{data.a}</i>' +
			'</svelte:fragment></Card>',
		data: [{ a: 'x' }, { a: '' }],
	},
];
