/**
 * Components: children entered and left to the render, wrappers, slots, self-rendering.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		// Into the child, with its props bound to what the call site passes. Every row here was
		// refused before, and each for the same reason: a component is a plain call with no anchor
		// around what it writes, so a value handed over and not written back was an absence with
		// nothing attached to it. From inside, none of them is a special case.
		name: 'a child that computes with what it is given',
		beside: { Kid: '<script>let { p } = $props();</script><b>{String(p).toUpperCase()}</b>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid p={data.a} />',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// A component the request hands in that the source names none of: nothing for a value that is
		// nothing, as Svelte writes, and a throw per request for anything else -- see below.
		name: 'a dynamic component chosen by the request',
		source: '<script>let { data } = $props(); const Pick = $derived(data.c);</script><Pick />',
		data: [{ c: null }, {}],
	},
	{
		name: 'a child that writes a prop twice, and one that never writes it',
		beside: {
			Twice: '<script>let { p } = $props();</script><b>{p}</b><i>{p}</i>',
			Never: '<script>let { p } = $props();</script><b>fixed</b>',
		},
		source:
			"<script>import Twice from './Twice.svelte'; import Never from './Never.svelte';" +
			' let { data } = $props();</script><Twice p={data.a} /><Never p={data.a} />',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A prop the call site leaves out is its default, which is what `$props()` destructuring
		// does. Getting this wrong wrote the wrong bytes rather than refusing, and only the
		// comparison with Svelte said so.
		name: 'a child with a default the call site does not pass',
		beside: { Fallback: '<script>let { p, r = "d" } = $props();</script><b>{p}{r}</b>' },
		source:
			"<script>import Fallback from './Fallback.svelte'; let { data } = $props();</script>" +
			'<Fallback p={data.a} />',
		data: [{ a: 'x' }],
	},
	{
		// One copy per call site. The same module rendered twice writes the same markers twice, and
		// a marker has to come back once.
		name: 'the same child at two call sites',
		beside: { Same: '<script>let { p } = $props();</script><b>{p}</b>' },
		source:
			"<script>import Same from './Same.svelte'; let { data } = $props();</script>" +
			'<Same p={data.a} /><Same p={data.b} />',
		data: [{ a: 'x', b: 'y' }],
	},
	{
		name: 'a child of a child',
		beside: {
			Outer:
				"<script>import Inner from './Inner.svelte'; let { p } = $props();</script><Inner q={p} />",
			Inner: '<script>let { q } = $props();</script><b>{q}</b>',
		},
		source:
			"<script>import Outer from './Outer.svelte'; let { data } = $props();</script>" +
			'<Outer p={data.a} />',
		data: [{ a: 'x' }],
	},
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
		// A child that never renders what it was given. Svelte writes none of it, and so does this.
		name: 'a wrapper that renders none of it',
		beside: { Drop: '<script>let { children } = $props();</script><div>fixed</div>' },
		source:
			"<script>import Drop from './Drop.svelte'; let { data } = $props();</script>" +
			'<Drop><b>{data.a}</b></Drop>',
		data: [{ a: 'x' }],
	},
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
		// `$props.id()` is an id Svelte's server counts out per render and writes into an anchor the
		// client reads back, so it is decided when the bytes are written: the runtime counts in the
		// same order, and every read of it is a binding made at the anchor. The shapes here are the
		// ones static bytes got wrong -- an each body, where one id would repeat per item, and an
		// else branch, whose separate render numbered from one and collided -- plus a read inside a
		// derivation and a component that declares an id and never reads it. See spec/refusals.md.
		name: 'an id per component instance',
		beside: {
			Tagged:
				'<script>let { label } = $props(); const id = $props.id();' +
				' const panel = `${id}-panel`;</script>' +
				'<i id={id} aria-describedby={label ? id : undefined}>{label}</i>' +
				'<b id={panel}>{id}</b>',
			Quiet: '<script>let { x } = $props(); const unused = $props.id();</script><u>{x}</u>',
		},
		source:
			"<script>import Tagged from './Tagged.svelte'; import Quiet from './Quiet.svelte';" +
			' let { data } = $props(); const own = $props.id();</script>' +
			'<section id={own}>{#if data.a}<Tagged label={data.a} />{:else}<Quiet x={own} />' +
			'<Tagged label="" />{/if}{#each data.xs as x}<Tagged label={x} /><Quiet {x} />{/each}' +
			'<p>{own}</p></section>',
		data: [
			{ a: 'first', xs: ['p', 'q'] },
			{ a: '', xs: ['<&'] },
			{ a: 'only', xs: [] },
		],
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
		// A value handed to a component the walk cannot enter, which writes none of it. The marker
		// does not come back, and absence alone cannot tell that from the component having eaten it
		// -- so the render is made again with a different value in its place, and identical bytes
		// say it reaches none of them. This is press's language switcher: it hands its menu a source
		// language, the menu is a dropdown that is closed, and Svelte's own server writes the
		// trigger and nothing else. Measured on the real component before it was written here.
		name: 'a value a child is given and never writes',
		beside: {
			Shuts:
				'<script>let { tag, ...rest } = $props(); const open = false;</script>' +
				'{#if open}<i>{tag}</i>{/if}<b>shut</b>',
		},
		source:
			"<script>import Shuts from './Shuts.svelte'; let { data } = $props();</script>" +
			'<Shuts tag={data.a} /><p>{data.b}</p>',
		data: [
			{ a: 'x', b: 'v' },
			{ a: '<&', b: '<&' },
		],
	},
	{
		// Two values given away, one written and one not. Asked together the answer is only that
		// something reaches the bytes, which says nothing about which -- so one live value kept
		// every dead one beside it refused, and the refusal named whichever came first. Asked one
		// at a time after that, each gets its own answer.
		name: 'one value a child writes and one it does not',
		beside: {
			Picks:
				'<script>let { shown, hidden, ...rest } = $props(); const open = false;</script>' +
				'<b>{shown}</b>{#if open}<i>{hidden}</i>{/if}',
		},
		source:
			"<script>import Picks from './Picks.svelte'; let { data } = $props();</script>" +
			'<Picks shown={data.a} hidden={data.b} />',
		data: [
			{ a: 'x', b: 'y' },
			{ a: '<&', b: 'z' },
		],
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
		// A side-effect import of a component binds nothing and is kept for what running it does,
		// which is `customElements.define` and the client's: the server writes the tag as an unknown
		// element whether or not anything was ever defined. The render is Node, which cannot load a
		// `.svelte` file at all. And `./x.svelte` with no such file beside it is how a bundler is
		// asked for the runes module `x.svelte.js`, so it is not a component to follow.
		name: 'a side-effect import of a component, and a runes module named through `.svelte`',
		alongside: {
			'held.svelte.js': 'export const held = { a: 1 };',
			'Side.svelte': '<b>side</b>',
		},
		source:
			"<script>import './Side.svelte'; import { held } from './held.svelte';" +
			' let { data } = $props();</script><p>{data.a}{held.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// Svelte compiles a component to a module whose `default` is the component and whose
		// `<script module>` exports are its named exports, so only the default import is the thing
		// composed at compile time. A named one is a value like any other and is carried.
		name: 'a named import from a component, which is its module script',
		beside: {
			Held:
				'<script module>export const held = "m"; export function twice(n) { return n * 2 }' +
				'</script><i>held</i>',
		},
		source:
			"<script>import Held, { held, twice } from './Held.svelte'; let { data } = $props();" +
			'</script><Held /><p>{held}|{twice(data.n)}</p>',
		data: [{ n: 3 }],
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
	{
		// A prop whose name is not an identifier can only be written as a string, and no expression
		// can read it by that name -- `kebab-case` is a subtraction. The payload object can, and
		// `GIVEN` names it. The default is folded in here rather than left to the prop derivation,
		// which stands over the payload's key under a name, and a name is what this prop has not got.
		name: 'an entry prop whose name is not an identifier',
		source:
			"<script>let { data, 'kebab-case': k, 'a-b': ab = 'd' } = $props();</script>" +
			'<p>{k}|{ab}</p><b>{data.a}</b>',
		props: [
			{ data: { a: 'x' }, 'kebab-case': 'v', 'a-b': 'g' },
			{ data: { a: '<&' }, 'kebab-case': '<&' },
		],
	},
	{
		// The render is handed a literal for a prop whose value this walk models, and the value is
		// never written into the bytes -- it only has to survive being evaluated. `null` does not
		// where the child reads the name as the object of a member expression, and the value it
		// would have computed is one the walk had already read for itself.
		name: 'a prop the child reads a member of, handed to the render',
		beside: { Boxed: '<script>export let box;</script><div><slot width={box.width} /></div>' },
		source:
			"<script>import Boxed from './Boxed.svelte'; export let box = { width: 3 };</script>" +
			'<Boxed {box} let:width><i>{width}</i></Boxed>',
		props: [{}, { box: { width: 9 } }],
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
	{
		// `let { n, ...rest } = $props()`: the rest is the object of what the caller passed and the
		// pattern did not name, which a call site knows exactly. The walk used to stop at a rest and
		// leave the child to Svelte, where `n * 2` on a marker was `NaN` and the check that says a
		// value was eaten called it safe.
		name: 'a rest beside a prop the child transforms',
		beside: { Item: '<script>let { n, ...rest } = $props();</script><b {...rest}>{n * 2}</b>' },
		source:
			"<script>import Item from './Item.svelte'; let { data } = $props();</script>" +
			'<Item n={data.n} id={data.i} onclick={() => {}} />',
		data: [
			{ n: 2, i: 'x' },
			{ n: 0, i: null },
		],
	},
	{
		// Entered, a child that computes with a value or never writes one is the ordinary case: the
		// computation is a derivation and the unwritten value is markup nobody renders. The same
		// children are refused below when a spread at the call site keeps the walk out.
		name: 'one value a child eats and one it never writes, entered',
		beside: {
			Eats:
				'<script>let { eaten, ignored, ...rest } = $props(); const open = false;</script>' +
				'<b>{eaten.toUpperCase()}</b>{#if open}<i>{ignored}</i>{/if}',
			Chews: '<script>let { tag, ...rest } = $props();</script><i>{tag.toUpperCase()}</i>',
		},
		source:
			"<script>import Eats from './Eats.svelte'; import Chews from './Chews.svelte'; let { data } = $props();</script>" +
			'<Eats ignored={data.b} eaten={data.a} /><Chews tag={data.a} />',
		data: [
			{ a: 'x', b: 'y' },
			{ a: '<&', b: null },
		],
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
		// Svelte 4's spelling of a prop, which Svelte 5 still compiles. Measured byte for byte
		// against `$props()` with the same defaults, so the file is rewritten to that before
		name: 'a child written with export let',
		beside: {
			Kid: "<script>export let n; export let label = 'x', flag = false;</script><p>{label}{n * 2}{#if flag}!{/if}</p>",
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid n={data.n} /><Kid n={data.n} label="y" flag={data.f} />',
		data: [
			{ n: 3, f: true },
			{ n: 0, f: false },
		],
	},
	{
		// A default on the entry's own props. A child's is applied where the call site binds the prop;
		// the entry has no call site, its props being the payload, and until this was written the
		// default was dropped and a request that left the prop out wrote nothing where Svelte writes
		// the default. Both payloads, because the one that sends the prop is what says the default
		// does not also overwrite it. See spec/suite.md.
		name: "a default on the entry's own props",
		source:
			'<script>let { data, label = "none", n = 41 } = $props();</script>' +
			'<p>{label}</p><b>{n + 1}</b><i>{data.a}</i>',
		props: [
			{ data: { a: 'x' } },
			{ data: { a: 'x' }, label: 'given', n: 1 },
			{ data: { a: 'x' }, label: undefined, n: undefined },
			{ data: { a: 'x' }, label: null, n: 0 },
		],
	},
	{
		// The default is the author's own source and is expanded like every other expression: it may
		// call what only its own file has. Taken as written it reached the derivation evaluator,
		// which has the carried bundle in scope and not the component's body.
		name: "a default on the entry's props that calls the file's own function",
		alongside: { 'tax.ts': 'export const RATE = 0.2;' },
		source:
			"<script>import { RATE } from './tax.ts'; let { data, rate = base() + RATE } = $props();" +
			' function base() { return 1 }</script><p>{rate}</p><i>{data.a}</i>',
		props: [{ data: { a: 'x' } }, { data: { a: 'x' }, rate: 9 }],
	},
	{
		// `build_attribute_value` returns the expression itself when the value is one chunk -- quotes
		// or no quotes, `value.length === 1` is the whole test -- so `n='{1 + 1}'` hands a *number*
		// down. Several chunks become a template, each expression through `$.stringify`, and the
		// text raw because a component's is not escaped. The walk used to leave the whole component
		// to the render over one mixed value, and the child then got a string where Svelte gives a
		// number: `component-data-dynamic`, in both corpora.
		name: 'a component given a quoted expression and a mixed value',
		beside: {
			Kid:
				'<script>export let n; export let s; export let e;</script>' +
				'<p>{n} {typeof n}</p><p>{s}</p><p>{e}|{typeof e}</p>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid n=\'{40 + data.n}\' s="a {data.a} b" e="x{data.missing}y" />',
		data: [
			{ a: 'mid', n: 2 },
			{ a: 0, n: 0 },
		],
	},
	{
		// The payload's keys are the props, not the names the entry destructured them into. They are
		// the same word in nearly every component, which is why reading `bar` as the path `bar` --
		// when the request carries `foo` -- went unnoticed. The substitution's replacement is a bare
		// name, so a read of it stays a path rather than becoming a derivation.
		name: 'an entry prop read under another name',
		source:
			'<script>let { data, foo: bar } = $props();</script><p>{bar}</p><i>{bar.length}</i>' +
			'<b>{data.a}</b>',
		props: [
			{ data: { a: 'x' }, foo: 'given' },
			{ data: { a: 'x' }, foo: '' },
		],
	},
	{
		// A readonly export is not a prop -- a caller cannot pass one, and it reaches a caller only
		// through `bind:this` -- and it is legal in runes mode, so the legacy rewrite has nothing to
		// do to it. It used to refuse the whole component, which turned away every one that happened
		// to export a helper beside its props.
		name: 'a component exporting a helper beside its props',
		beside: {
			Kid:
				'<script>export let p; export const KIND = "k"; export function twice(n) { return n * 2 }' +
				' export class Held {}</script><b>{p}{KIND}{twice(2)}</b>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid p={data.a} />',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// Svelte 4's spelling of a prop, read where it is written rather than rewritten into
		// `$props()`. The rewrite is what put the file in runes mode, and `analysis.runes` decides
		// more than how props are declared -- among them whether a namespaced tag is a dynamic
		// component, which is the last line here: legacy writes no anchors around one and runes
		// writes `<!--[-->` and `<!--]-->`. See spec/roadmap.md.
		name: 'an entry whose props are `export let`',
		alongside: { 'held.ts': 'export const Held = { Inner: null };' },
		beside: { Inner: '<script>export let n;</script><b>{n}</b>' },
		source:
			"<script>import Inner from './Inner.svelte'; export let a; export let b = 'fallback';" +
			' let c = 1, d; export { c, d as renamed };</script>' +
			'<p>{a}</p><i>{b}</i><u>{c}</u><s>{d}</s><Inner n={a} />',
		props: [
			{ a: 'x', b: 'given', c: 9, renamed: 'r' },
			{ a: '', c: 0, renamed: '' },
		],
	},
	{
		// A child whose props are `export let`, entered and bound at its call site the way a runes
		// child is. Its defaults are Svelte's own, since nothing rewrites them any more.
		name: 'a child whose props are `export let`',
		beside: {
			Kid:
				'<script>export let p; export let q = 7; let r = 1; export { r as renamed };</script>' +
				'<b>{p}</b><i>{q}</i><u>{r}</u>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid p={data.a} renamed={data.b} />',
		data: [
			{ a: 'x', b: 'y' },
			{ a: '', b: 0 },
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
	{
		// The legacy spelling of the whole props object. `transform-server.js` writes
		// `$$sanitized_props` as `sanitize_props($$props)`, `$$restProps` as
		// `rest_props($$sanitized_props, [named])` and `$$slots` as `sanitize_slots($$props)` --
		// each Svelte's own function over the object the component was called with. The entry's is
		// the payload, which the evaluator binds under a name of its own; an expression reads its
		// scope through `with`, which binds the keys and not the object, and all three were refused
		// for want of a name for it.
		name: 'the whole of what the entry was given',
		source:
			'<script>export let a; export let b;</script>' +
			'<p>{JSON.stringify($$props)}</p><b>{JSON.stringify($$restProps)}</b><i>{a}</i>',
		data: [{ a: 1, b: 2, c: '<' }, { a: 1 }],
	},
	{
		// `$state` and the rest are compiled away by Svelte and exist nowhere at run time, so a
		// `.svelte.js` cannot be loaded as it is written. The carried bundle compiled one on the way
		// in and the compile-time render did not, which left Node importing `export let obj =
		// $state({})` and answering `$state is not defined` -- seven of Svelte's samples. The rule
		// is one function both loaders call.
		name: 'an entry importing a runes module',
		alongside: {
			'held.svelte.js': 'export let obj = $state({ a: 1, b: 2 });\n',
		},
		source:
			"<script>import { obj } from './held.svelte.js'; let { data } = $props();</script>" +
			'<p>{Object.values(obj)}</p><p>{data.n}</p>',
		data: [{ n: 2 }, { n: 21 }],
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
	{
		// `runtime-legacy/transition-css-iframe`, out of the skips with the two above. The child
		// writes an `<iframe>` and nothing else, and the component it is handed is a file this
		// compile imports: a value the build has, whichever way the child then uses it.
		name: 'a component handed to a child as a prop',
		beside: {
			Frame:
				'<script>export let component; let frame;' +
				' $: hold($$props); function hold(p) { return p; }</script>' +
				'<iframe bind:this={frame} title="frame"></iframe>',
			Foo: '<script>export let visible;</script>{#if visible}<b>yes</b>{/if}',
		},
		source:
			"<script>import Frame from './Frame.svelte'; import Foo from './Foo.svelte';" +
			' export let visible;</script><Frame component={Foo} {visible}/>',
		props: [{ visible: true }, { visible: false }],
	},
];
