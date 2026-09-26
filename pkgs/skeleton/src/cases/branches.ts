/**
 * Branches: ifs, chains, blocks the request decides, and what follows a block.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		// One block, not two. Svelte's server transform flattens the chain and tells the branches
		// apart by numbering the marker it opens each one with -- `<!--[0-->`, `<!--[1-->`, and
		// `<!--[-1-->` for the else. Following the AST, which nests them, numbers a block the render
		// never wrote. Every branch is a payload here, including the one nothing matches.
		name: 'an else-if chain',
		source: `${PROPS}{#if data.a}<b>{data.x}</b>{:else if data.b}<i>{data.x}</i>{:else}<u>z</u>{/if}`,
		data: [
			{ a: true, b: false, x: 'p' },
			{ a: false, b: true, x: 'q' },
			{ a: false, b: false, x: 'r' },
		],
	},
	{
		name: 'an else-if chain with no final else',
		source: `${PROPS}{#if data.a}<b>a</b>{:else if data.b}<i>b</i>{/if}`,
		data: [
			{ a: true, b: true },
			{ a: false, b: true },
			{ a: false, b: false },
		],
	},
	{
		// Three of them, so the branch numbering is exercised past the one place an off-by-one
		// would still line up.
		name: 'a chain of four branches',
		source:
			`${PROPS}{#if data.a}<b>1</b>{:else if data.b}<i>2</i>` +
			`{:else if data.c}<u>3</u>{:else}<s>4</s>{/if}`,
		data: [
			{ a: true, b: true, c: true },
			{ a: false, b: true, c: true },
			{ a: false, b: false, c: true },
			{ a: false, b: false, c: false },
		],
	},
	{
		// A block in a branch the baseline render does not hold. It is numbered by the source walk
		// after the branch above it, and the assembler meets it in that branch's own render -- in
		// the same order, which is the whole of why the two line up. Rewinding the count between
		// branches was what made this impossible, and rewinding was never needed.
		name: 'a block inside an else',
		source: `${PROPS}{#if data.f}<p>a</p>{:else}{#each data.xs as x}<p>{x}</p>{/each}{/if}`,
		data: [
			{ f: true, xs: ['p'] },
			{ f: false, xs: ['p', 'q'] },
			{ f: false, xs: [] },
		],
	},
	{
		// A test the substitution has already turned into a constant, which is not a question for
		// the render and never was. Svelte compiles a dead branch and never runs it; this walk goes
		// into every branch whatever it is told, which is what makes a block re-materialisable per
		// render -- so a branch nothing writes was rendered, and what the source never evaluates
		// threw there. Folded before the walk goes in.
		name: 'a branch whose test the source has already decided',
		source:
			'<script>let { data } = $props(); let hidden = $state(false); let held = $state();</script>' +
			'{#if hidden}<p>{held.missing}</p>{/if}{#if held}<p>{held.other}</p>{:else}<i>none</i>{/if}' +
			'<p>{data.a}</p>',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// The name check is owed a name that would have reached the bytes as nothing. A branch behind
		// a test the request does not decide reaches no bytes at all, so a name that resolves nowhere
		// inside one is not a name the data has to carry -- Svelte compiles such a branch and never
		// runs it, and never asks about the name either.
		name: 'a name read only where nothing renders',
		source:
			'<script>let { data } = $props(); let hidden = $state(false);</script>' +
			'{#if hidden}<p>{nowhere}</p>{/if}<p>{data.a}</p>',
		data: [{ a: 'x' }],
	},
	{
		// A chain is tests Svelte evaluates in order until one is true, so a later test is reached
		// only where every earlier one was false. Waiting for all of them before folding kept the
		// block a decision, and the ask for the later test is written into the script, where it runs
		// whatever branch the render takes -- so a test the source never evaluates was evaluated.
		name: 'a chain decided by its first test, whose later test never runs',
		source:
			'<script>let { data } = $props(); const on = true;' +
			" function boom() { throw new Error('never'); }</script>" +
			'{#if on}<p>first</p>{:else if boom()}<p>second</p>{/if}<p>{data.a}</p>',
		data: [{ a: 'x' }],
	},
	{
		// A test the request does not decide is answered by a render and the walk runs again told, so
		// the branch the answer excludes is folded on that second pass. Checking the names on the
		// first reported one that lives in markup no request reaches, a pass before the walk knew it.
		name: 'a name in a branch the render has yet to fold away',
		source:
			'<script>let { data } = $props(); const xs = [1, 2];</script>' +
			'{#if xs.length > 1}<p>yes</p>{:else}<p>{nowhere}</p>{/if}<p>{data.a}</p>',
		data: [{ a: 'x' }],
	},
	{
		name: 'a block inside an else-if branch',
		source: `${PROPS}{#if data.f}<p>a</p>{:else if data.g}{#if data.h}<p>b</p>{/if}{/if}`,
		data: [
			{ f: true, g: true, h: true },
			{ f: false, g: true, h: true },
			{ f: false, g: true, h: false },
			{ f: false, g: false, h: true },
		],
	},
	{
		// Both branches holding one, so the count has to carry from the first into the second
		// rather than restart in either.
		name: 'a block in the consequent and another in the else',
		source:
			`${PROPS}{#if data.f}{#each data.xs as x}<p>{x}</p>{/each}` +
			`{:else}{#each data.ys as y}<i>{y}</i>{/each}{/if}`,
		data: [
			{ f: true, xs: ['p', 'q'], ys: [] },
			{ f: false, xs: [], ys: ['r', 's'] },
		],
	},
	{
		// `transform-server.js` collects each reactive statement and does
		// `instance.body.push(statement)` in the analysis's topological order, after the rest of the
		// instance body and before the template. So a `$:` wins over the declaration of the same
		// name, `export let` included: the request may send `c` and the statement overwrites it.
		// Read as an assignment to the declaration, every one of these was refused.
		name: 'a reactive statement over a declaration, and over a prop, block or not',
		props: [
			{ data: { a: 'x' }, a: 1, b: 2, c: 9 },
			{ data: { a: '' }, a: 3, b: 4 },
		],
		source:
			'<script>export let data; export let a = 1; export let b = 2; export let c;' +
			' let both; $: c = a + b; $: { both = c * 2; }</script>' +
			'<p>{a} + {b} = {c}</p><p>{both}</p><i>{data.a}</i>',
	},
	{
		// Blocks in the child, numbered in the walk that reaches them and met in the render in the
		// same order, which is the whole of what makes them line up.
		name: 'a child that branches and iterates over what it is given',
		beside: {
			Both:
				'<script>let { xs, f } = $props();</script>{#if f}<b>y</b>{:else}<i>n</i>{/if}' +
				'<ul>{#each xs as x}<li>{x}</li>{/each}</ul>',
		},
		source:
			"<script>import Both from './Both.svelte'; let { data } = $props();</script>" +
			'<Both xs={data.xs} f={data.f} />',
		data: [
			{ xs: ['a', 'b'], f: true },
			{ xs: [], f: false },
		],
	},
	{
		// A component the walk did not enter writes anchors of its own, and they look exactly like
		// ours: `{#if}` in a package's markup opens and closes the way `{#if}` here does. Matching
		// them by the order they appear in counted somebody else's blocks as ours and ran out of
		// list. The stamp after each block says which one it is, so a pair without one is bytes --
		// copied out, and walked through, because our own block renders inside theirs.
		name: 'a child the walk cannot enter wraps what it was given in a block of its own',
		beside: {
			Wraps:
				'<script>let { children, ...rest } = $props(); const on = true;</script>' +
				'{#if on}<div>{@render children()}</div>{:else}<p>off</p>{/if}',
		},
		source:
			"<script>import Wraps from './Wraps.svelte'; let { data } = $props();</script>" +
			'<Wraps><b>{data.a}</b>{#if data.f}<i>{data.a}</i>{:else}<u>n</u>{/if}</Wraps>',
		data: [
			{ a: 'x', f: true },
			{ a: '<&', f: false },
		],
	},
	{
		// Where text is refused the stamp is a `<template>`, and a `@keyframes` rule scopes every
		// element in the component -- the template included -- so it comes back carrying a class of
		// Svelte's. The assembler reads its tag to the `>` rather than matching `<template>` whole,
		// which is what a route with one such rule in it found. See `stamped()`.
		name: 'a stamp Svelte scopes, where text is not writable',
		source:
			`${PROPS}<table><tbody>{#each data.rows as r}<tr><td class="c">{r}</td></tr>{/each}` +
			'</tbody></table><style>.c { color: red } @keyframes -global-turn { 0% { opacity: 0 } }</style>',
		data: [{ rows: ['p', 'q'] }, { rows: [] }],
	},
	{
		// The stamp that says which block just closed cannot always be bare text. Svelte refuses
		// `<#text>` inside a table's parts, and a text or element child of a `<select>` makes it
		// rich, which closes the tag with `<!>`. Each of these is a position where the carrier has
		// to be something the element already allows and already ignores. See `carrier()`.
		name: 'blocks inside elements that will not hold text',
		source:
			`${PROPS}<table><tbody>{#each data.rows as r}<tr><td>{r}</td></tr>{/each}</tbody></table>` +
			'<select>{#each data.opts as o}<option>{o}</option>{/each}</select>' +
			'<select><option>{#if data.f}{data.a}{/if}</option></select>',
		data: [
			{ rows: ['a', 'b'], opts: ['x'], f: true, a: 'v' },
			{ rows: [], opts: [], f: false, a: '' },
		],
	},
	{
		// A payload path the build declared a domain for, and this render is one of the values in
		// it. The path is a literal rather than a hole everywhere it is read: in markup, in a
		// declaration computed from it, and in a prop handed to a component the walk cannot enter
		// -- which is the position that matters, because a marker there is a string where the
		// component expected a value and there is no way in from outside. A field with no declared
		// domain beside it is a hole as always. See spec/pipeline.md.
		name: 'a render fixed at a payload path',
		fixed: { 'data.locale.code': '"en"' },
		beside: {
			// It decides on the value rather than writing it out, which is the position a marker
			// cannot stand in: a string nobody chose takes the wrong branch, silently.
			Shown:
				'<script>let { tag, ...rest } = $props();</script>' +
				"{#if tag === 'en'}<i>english</i>{:else}<i>{tag}</i>{/if}",
			// A page inside its layout, which is the shape a route has, so the fixed path is read
			// inside a component the walk entered -- where the call site's values are handed over as
			// nothing. Nothing except the paths the render is fixed at, which is what this is for:
			// the second `<Shown>` is inert and left for Svelte, and it reads `data` out of props.
			Held:
				"<script>import Shown from './Shown.svelte'; let { data } = $props();" +
				' const loc = data.locale.code;</script>' +
				'<p>{loc}</p><b>{data.locale.code}</b><Shown tag={loc} /><em>{data.title}</em>' +
				`<Shown tag={['a', data.locale.code].join('-')} />` +
				'{#if data.locale.code === "en"}<u>english</u>{:else}<u>other</u>{/if}',
		},
		source:
			"<script>import Held from './Held.svelte'; let { data } = $props();</script>" +
			'<Held {data} />',
		data: [
			{ locale: { code: 'en' }, title: 'x' },
			{ locale: { code: 'en' }, title: '<&' },
		],
	},
	{
		name: 'svelte:element with directives and a block inside it',
		source:
			`${PROPS}<svelte:element this={data.tag} class="a" class:on={data.f} style:width={data.w}>` +
			'{#each data.xs as x}<i>{x}</i>{/each}</svelte:element>',
		data: [
			{ tag: 'h3', f: true, w: '1px', xs: ['p', 'q'] },
			{ tag: 'p', f: false, w: null, xs: [] },
			{ tag: 'hr', f: true, w: '2px', xs: ['r'] },
		],
	},
	{
		// A component rendering itself whose body is one block. The bare block wrapping the body and
		// the each end at the same place, so their stamps land at one offset -- and `apply` writes
		// back to front, so among edits beginning there the one pushed first ends up rightmost. The
		// wrapper's close is written after the body is walked, so it was pushed last and landed to
		// the left of the each's stamp: `%%b0%%%%b1%%`, of which only the first was read and the
		// second stayed in the bytes. The guard at the end of assembly caught it; the order is what
		// fixes it, and the close is merged into the edit that says what that order is.
		name: 'a component rendering itself whose body is one block',
		source:
			`${PROPS}{#each data.tree as item}<div>{item.id}` +
			'{#if item.sub}<svelte:self data={{ tree: item.sub }} />{/if}</div>{/each}',
		data: [{ tree: [{ id: 'a', sub: [{ id: 'b' }] }, { id: 'c' }] }, { tree: [] }],
	},
	{
		// A block whose every test the request does not decide is decided once, by the render,
		// and is bytes: the walk asks, the render answers, the walk runs again told, and the
		// branch taken is walked between anchors the assembler copies. A hole inside it is still a
		// hole. Both branches, so that the answer is read rather than assumed.
		name: 'an if the request does not decide',
		alongside: { 'flag.ts': 'export const flag = () => true;' },
		source:
			"<script>import { flag } from './flag.ts'; let { data } = $props(); let open = $state(false);" +
			' const n = flag();</script>{#if open}<b>o</b>{:else if n}<i>{data.a}</i>{:else}<u>u</u>{/if}' +
			'{#if !n}<s>s</s>{/if}',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A stamp is text, and text is not neutral everywhere. `clean_nodes` collapses whitespace
		// between a block and a text node to one space and keeps whitespace inside a text node as
		// written, so a stamp at the block turned ` tail` into a newline and a tab; and inside an
		// `<svg>` a whitespace-only node is removed entirely, so a stamp there left a space where
		// Svelte had none. press's language chart is the second -- nine hundred blocks in one
		// `<svg>`, two hundred and ninety-nine spaces a response. Every shape that can follow a
		// block, in both namespaces. See `stamping()` and `carrier()`.
		name: 'a block and whatever follows it',
		source:
			`${PROPS}<div>{#if data.f}a{/if}\n\ttail</div>` +
			'<div>{#if data.f}a{/if}\n\t<b>x</b></div>' +
			'<div>{#if data.f}a{/if}\n\t{#if data.f}b{/if}</div>' +
			'<div>{#if data.f}a{/if}\n\t</div>' +
			'<div>{#each data.xs as x}<b>{x}</b>{/each}\n\t<i>y</i></div>' +
			'<div>{#each data.xs as x}{x}{/each}\n\ttail</div>' +
			'<svg><g>{#if data.f}<text>a</text>{/if}\n\t{#if data.f}<rect />{/if}</g></svg>' +
			'<svg><g>{#if data.f}<text>a</text>\n\t{#if data.f}<rect />{/if}\n{/if}</g></svg>' +
			'<svg><g>{#if data.f}<text>a</text>{/if}\n\t<rect /></g></svg>' +
			'<svg><text>{#if data.f}a{/if}\n\ttail</text></svg>' +
			'<svg><foreignObject>{#if data.f}<b>a</b>{/if}\n\t<i>x</i></foreignObject></svg>',
		data: [
			{ f: true, xs: ['p'] },
			{ f: false, xs: [] },
		],
	},
	{
		// The end of the instance script is not the end of the instance body: `transform-server.js`
		// pushes every `$:` statement onto the body after it has visited everything else, so a
		// statement written below one in the source runs above it in the output. The ask read `rows`
		// before `$: rows = ...` had assigned it. Labelled, the ask is a reactive statement too.
		name: 'a test the render answers over a `$:` declaration',
		source:
			'<script>export let a; $: rows = [1, 2];</script>' +
			'{#if rows.length > 1}<p>many</p>{:else}<p>one</p>{/if}<p>{a}</p>',
		props: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A test the render answers may read a store this file makes. `varies` says a `$store` cannot
		// be handed to the render, and that is about the **expansion**, which names helpers the
		// render has not got -- an ask is written as the author's own source, which it evaluates
		// natively. And a test after the one that answered is never evaluated, so the names in it
		// are not names the data has to carry.
		name: 'a chain over a store this file makes, whose later test never runs',
		source:
			"<script>import { writable } from 'svelte/store'; export let a;" +
			' const on = writable(true);</script>' +
			'{#if $on}<p>yes</p>{:else if missing()}<p>no</p>{/if}<p>{a}</p>',
		props: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A lookup in a table of components is a choice whose domain is the table's keys, written as
		// the chain of `?:` it is; a key the table lacks is the `undefined` that `<svelte:component>`
		// writes `<!--[!--><!--]-->` for. Fixed here so the chain is Svelte's to evaluate; per request
		// the same chain is enumerated as a tree, which is the compiler's and measured with it.
		name: 'a dynamic component chosen through a table',
		beside: { Ay2: '<i>A</i>', Bee2: '<b>B</b>' },
		source:
			"<script>import Ay2 from './Ay2.svelte'; import Bee2 from './Bee2.svelte'; let { data } = $props();" +
			' const ICONS = { a: Ay2, b: Bee2 }; const Pick = $derived(ICONS[data.k]);</script>' +
			'<Pick /><svelte:component this={ICONS[data.k]} /><p>{data.x}</p>',
		fixed: { 'data.k': '"b"' },
		data: [{ k: 'b', x: '1' }],
	},
	{
		// `is_standalone` in `3-transform/utils.js` needs the fragment's one trimmed node to be a
		// `Component`, and `<svelte:self>` is a `SvelteSelf` -- so Svelte writes the `<!---->` that
		// `shared/component.js` pushes after a component, where one ordinary component alone in the
		// same place gets none. The stand-in the walk writes is a component tag, so it was read as
		// standalone and the anchor went missing, one per level of the recursion.
		name: 'a `<svelte:self>` alone in a block, which anchors unlike a component',
		source:
			'<script>let { data } = $props();</script><ul>{#each data.items as item}' +
			'{#if item.kids}<svelte:self data={{ items: item.kids }} />{:else}<li>{item.name}</li>{/if}' +
			'{/each}</ul>',
		data: [
			{ items: [{ name: 'a' }, { kids: [{ name: 'b' }, { kids: [{ name: 'c' }] }] }] },
			{ items: [] },
		],
	},
	{
		// `clean_nodes` asks `next?.type !== 'ExpressionTag'` before collapsing a text node's trailing
		// whitespace, so an expression tag holds the whitespace in front of it as written where a
		// block or an element collapses it to one space. A stamp written at the block turned that
		// node from whitespace into a stamp plus whitespace -- no longer leading, so nothing
		// collapsed. Every shape that can follow a block, since the placement turns on which.
		name: 'whatever follows a block, and the whitespace between',
		source:
			`${PROPS}<div>{#each data.xs as x}<i>{x}</i>{/each}\n\n{data.a}</div>` +
			'<div>{#each data.xs as x}<i>{x}</i>{/each}\n\ntail</div>' +
			'<div>{#each data.xs as x}<i>{x}</i>{/each}\n\n<b>e</b></div>' +
			'<div>{#each data.xs as x}<i>{x}</i>{/each}\n\n{#if data.a}<u>y</u>{/if}</div>' +
			'<div>{#each data.xs as x}<i>{x}</i>{/each}\n\n{@html data.h}</div>' +
			'<div>{#each data.xs as x}<i>{x}</i>{/each}\n\n</div>',
		data: [
			{ xs: ['p'], a: 'A', h: '<em>h</em>' },
			{ xs: [], a: '', h: '' },
		],
	},
	{
		// A `{@const}` only makes sense inside its branch, and Svelte evaluates one in the branch's
		// own init. Computed up front it threw for every request that took another branch -- and the
		// artifact had already been written, so the refusal arrived per request rather than at the
		// build. A derivation is a pure expression, so *when* it is computed cannot change what it
		// is; whether it is computed at all can.
		name: 'a `{@const}` in a branch the request does not take',
		source:
			`${PROPS}{#if data.xs.length === 2}{@const second = data.xs[1]}<p>{second.w}</p>` +
			'{:else if data.xs.length === 1}{@const first = data.xs[0]}<i>{first.w}</i>' +
			'{:else}<b>none</b>{/if}',
		data: [{ xs: [{ w: 1 }, { w: 2 }] }, { xs: [{ w: 3 }] }, { xs: [] }],
	},
];
