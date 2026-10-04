/**
 * Props of a child: what it is given, writes, defaults, exports, and declares as `export let`.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case } from './case.ts';

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
		// writes `<!--[-->` and `<!--]-->`. See spec/readings.md.
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
	{
		// `@lucide/svelte`'s `Icon`: a `$derived` taken apart by an array pattern, one of whose names
		// a second `$derived` spreads. The second was written into the child's script as a read of
		// the held first, `$$hold(0)[1]`, which is the derivations' spelling and no name Svelte
		// compiles. Met moving `status`; see spec/conformance.md, "Stage 3".
		name: 'a derived taken apart by an array pattern and spread by another',
		alongside: {
			'build.ts':
				"export const build = (icon, o) => ['svg', { class: 'icon', width: o.size }, icon.node];",
		},
		beside: {
			Icon:
				"<script>import { build } from './build.ts';" +
				' const { size = 24, icon = { node: [] }, class: propsClass, ...props } = $props();' +
				' const [, svgAttributes, built = []] = $derived(build(icon, { size, attributes: props }));' +
				" const iconAttributes = $derived({ ...svgAttributes, class: [...svgAttributes.class.split(' '), propsClass] });" +
				'</script><svg {...iconAttributes}>{#each built as [tag, attrs]}<svelte:element this={tag} {...attrs} />{/each}</svg>',
		},
		source:
			"<script>import Icon from './Icon.svelte'; let { data } = $props();</script>" +
			"<Icon class=\"dark:hidden\" icon={{ node: [['path', { d: 'M1' }]] }} /><i>{data.a}</i>",
		data: [{ a: 'x' }],
	},
];
