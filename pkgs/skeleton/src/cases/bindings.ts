/**
 * Bindings on elements and on components: what the server writes, and what a child sends back.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case } from './case.ts';

export const cases: Case[] = [
	{
		// Svelte's server writes `let a = each_array[i]` inside the loop, so what the block binds
		// shadows a declaration of the same name the way any block-scoped declaration does. Without
		// that, `{#each a as a}` wrote the array's own initialiser at every read of `a`.
		name: 'an each whose binding shadows a declaration of the same name',
		source:
			"<script>let { data } = $props(); let a = ['x', 'y']; let i = 9;</script>" +
			'{#each a as a, i}<li>{a}{i}</li>{/each}<p>{data.k}</p>',
		data: [{ k: '1' }, { k: '<' }],
	},
	{
		// A binding is not a separate kind of output. The element visitor ends at
		// `attributes.push({ type: 'transformed', name, expression })`, so this writes what
		// `value={v}` writes. The refusal said a marker cannot stand where the value goes because
		// `bind:` takes a name; the syntax does, the output does not.
		name: 'a bind: the server writes',
		source:
			'<script>let { data } = $props(); let v = $state(data.a)</script><input bind:value={v} />',
		data: [{ a: 'v' }, { a: '' }, { a: null }],
	},
	{
		// Boolean, so what is written is the attribute's presence rather than its value, which is
		// the one rule `presence` already carries because a render cannot show it.
		name: 'a bind: on a boolean attribute',
		source:
			'<script>let { data } = $props(); let v = $state(data.f)</script>' +
			'<input type="checkbox" bind:checked={v} /><details bind:open={v}><p>x</p></details>',
		data: [{ f: true }, { f: false }],
	},
	{
		// Two the visitor drops on the way out: `bind:this` is client-only, and `value` is skipped
		// on a file input because the attribute has no effect there.
		name: 'the bindings the server drops',
		source:
			'<script>let { data } = $props(); let el; let v = $state(data.a)</script>' +
			'<div bind:this={el}>{data.a}</div><input type="file" bind:value={v} />',
		data: [{ a: 'v' }],
	},
	{
		// `checked`, computed the way `element.js` computes it: `===` against the element's own
		// `value` for a radio, `includes` for a checkbox, and nothing where there is no `value`.
		name: 'bind:group',
		source:
			'<script>let { data } = $props(); let g = $state(data.g); let cs = $state(data.cs)</script>' +
			'<input type="radio" value="a" bind:group={g} /><input type="radio" value={data.b} bind:group={g} />' +
			'<input type="checkbox" value="x" bind:group={cs} /><input type="radio" bind:group={g} />',
		data: [
			{ g: 'a', b: 'b', cs: ['x'] },
			{ g: 'b', b: 'b', cs: [] },
			{ g: null, b: 'b', cs: ['y'] },
		],
	},
	{
		// Written as the element's content rather than as an attribute. Escaped for the text
		// bindings and a textarea's value, raw for `innerHTML`, and with no anchors around any of
		// them, which is what tells them from `{@html}`. See spec/refusals.md.
		name: 'the bindings the server writes as content',
		source:
			'<script>let { data } = $props(); let t = $state(data.t); let h = $state(data.h)</script>' +
			'<div contenteditable bind:textContent={t}></div><div contenteditable bind:innerText={t}></div>' +
			'<textarea bind:value={t}></textarea><div contenteditable bind:innerHTML={h}></div>',
		data: [
			{ t: '<&"', h: '<b>x</b>' },
			{ t: '', h: '' },
			{ t: null, h: null },
			{ t: 0, h: 0 },
		],
	},
	{
		// `build_inline_component` writes the default slot as `children: slot_fn` and `$$slots.default:
		// true`. The walk composes slot content rather than passing a function, so the key was
		// missing from the object `$props()` binds and `Object.keys` was a name short. A function
		// rather than `true`, because `attributes()` skips a value whose type is `function` and a
		// component spreading its whole props into an element must write no `children` attribute.
		name: 'a child binding `$props()` whole under filled slot content',
		beside: {
			Kid:
				'<script>let props = $props();</script>' +
				'<b {...props}>{Object.keys(props).join()}|{@render props.children?.()}</b>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid a={data.a}>in</Kid>',
		data: [{ a: 'v' }, { a: '<&' }],
	},
	{
		// `$props()` bound to a name rather than destructured binds the whole object a caller passed.
		// `transform-server.js` writes `$$sanitized_props = sanitize_props($$props)` and that is what
		// the call returns, so for the entry it is the payload -- the same object a bare `$$props`
		// read already stands for. The render keeps the call as written and is given nothing, so the
		// declaration is neutralised there the way one reading a prop is.
		name: 'the entry binding `$props()` to a name',
		source: '<script>let props = $props();</script><p>{props.a}|{props.n ?? 0}</p>',
		props: [{ a: 'v', n: 3 }, { a: '<&' }],
	},
	{
		// `bind_props` reads the child's `bindable_prop` bindings and its readonly exports and nothing
		// else. In runes mode only a `$bindable()` is one, and Svelte's own comment beside the call
		// says the rest have "no effect in runes mode other than throwing an error". So a `bind:` on
		// a runes prop with a plain default sends nothing back, and there is nothing to refuse:
		// measured against a bindable child, whose caller writes the default either side of the tag
		// where this one writes nothing.
		name: 'a `bind:` on a runes prop that is not `$bindable`',
		beside: { Kid: '<script>let { x = 42 } = $props();</script><i>{x}</i>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props(); let x;</script>" +
			'<p>before={x}</p><Kid bind:x /><p>after={x}|{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// `bind_props` assigns up only where the caller's value is `undefined`, and the assignment is
		// monotone -- `undefined` becomes a value and never goes back -- so the loop settles and the
		// settled read is one ternary. `transform-server.js` wraps only `template.body` in it, so
		// the template's reads see what the child sent and a declaration computed from the name
		// keeps what it held before. Both shapes here: a readonly export, and a prop with a default
		// reached through a `<svelte:component>` that settles to one import.
		name: 'a component `bind:` the child sends back',
		beside: {
			Kid: '<script>export const v = 42;</script><b>{v}</b>',
			Foo: "<script>export let x = 'yes';</script><p>{x}</p>",
		},
		source:
			"<script>import Kid from './Kid.svelte'; import Foo from './Foo.svelte';" +
			' let { data } = $props(); let v; let x; const held = "held:" + x;</script>' +
			'<p>before={x}</p><Kid bind:v /><svelte:component this={Foo} bind:x />' +
			'<p>{v}|{x}|{held}|{data.a}</p>',
		data: [{ a: 'q' }],
	},
	{
		// Written inside a block, which child sends back is that block's answer, so the block's own
		// test goes inside the ternary: `x === undefined ? (data.f ? 'yes' : undefined) : x`. Both
		// payloads, because the shape turns on the test -- with `data.f` false nothing renders the
		// child and the name keeps what the request brought.
		name: 'a component `bind:` written inside a block',
		beside: { Kid: "<script>export let x = 'yes';</script><p>{x}</p>" },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props(); let x;</script>" +
			'{#if data.f}<Kid bind:x />{/if}<p>{x}|{data.a}</p>',
		data: [
			{ f: true, a: 'q' },
			{ f: false, a: 'q' },
		],
	},
	{
		// A `bind:` whose value the request does not decide is left exactly as written, both halves
		// of it, because both are the render's to run: Svelte wraps the caller's template in the
		// settling loop, `bind_props` assigns into the value the caller actually holds, and the
		// markup after the tag reads what it left. Written out as the getter expanded, the child
		// filled in an object literal this pass had just built and the caller's own read saw
		// nothing. `component-binding-blowback-d` is the vendored shape.
		name: 'a component `bind:` on an inert value, in a child the walk cannot enter',
		beside: {
			One:
				"<script>import Two from './Two.svelte'; export let list;</script>" +
				'{#each list as item}<Two bind:value={item.value} />{/each}',
			Two: "<script>export let value = 'filled';</script>",
		},
		source:
			"<script>import One from './One.svelte'; const obj = { a: [{}] };</script>" +
			'<One bind:list={obj.a} /><p>{obj.a.map(JSON.stringify)}</p>',
		data: [{}],
	},
	{
		// The settling loop renders the template again, so a name one binding settles is read by the
		// markup after it on the same pass and by the markup before it on the next. A block's tests
		// are expanded against the bindings settled so far, and the source order falls out of the
		// walk's own: with `<Baz bind:f/>` above the block the test is the settled `f`, and below it
		// the test is what the request brought. Both orders are in the vendored corpus, as
		// `component-binding-conditional-b` and `-conditional`, and Svelte answers them differently.
		name: 'a component `bind:` inside a block another binding settles',
		beside: {
			Kid: "<script>export let x = 'yes';</script><p>{x}</p>",
			Baz: '<script>export let f = true;</script>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; import Baz from './Baz.svelte';" +
			' let { data } = $props(); let x; let f;</script>' +
			'<Baz bind:f />{#if f}<Kid bind:x />{/if}<p>{x}|{data.a}</p>',
		data: [{ a: 'q' }],
	},
	{
		// `$props()` bound to a name is the object the call site passed, so a child that binds it is
		// entered like any other. `VariableDeclaration.js` says which object: `let { $$slots,
		// $$events, ...rest } = $$props`, which takes those two out and **keeps** `children`. That
		// is not the same object as `$$props`, which is `sanitize_props($$props)` and takes
		// `children` out instead -- so a caller that fills the default slot is refused, the walk
		// having no function to put there. Here it fills none.
		name: 'a child binding `$props()` to a name',
		beside: {
			Kid: '<script>let props = $props();</script><b>{props.a}|{props.b}</b>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid a={data.a} b="2" />',
		data: [{ a: 'v' }, { a: '<&' }],
	},
	{
		// Every one of these is a measurement only a browser can take, so the server writes nothing
		// for them and the walk steps over them. The list is Svelte's and `omitted.test.ts` holds it
		// against what Svelte does. See spec/refusals.md.
		name: 'bindings the server writes nothing for',
		source:
			'<script>let { data } = $props(); let w = 0; let el = null</script>' +
			'<svelte:window bind:innerWidth={w} bind:scrollY={w} />' +
			'<div bind:this={el} bind:clientWidth={w}>{data.a}</div>',
		data: [{ a: 'v' }],
	},
	{
		// `element.js` writes `b.call(expression.expressions[0])` where the value goes and
		// `component.js` a getter returning the same call: the getter, called, and the setter never
		// run while bytes are written.
		name: 'a binding with a getter and a setter',
		source:
			'<script>let { data } = $props(); let v = $state(data.a); const get = () => data.b;</script>' +
			'<input bind:value={() => data.a, (x) => v = x} />' +
			'<input type="checkbox" bind:checked={get, () => {}} />' +
			'<textarea bind:value={() => data.a, () => {}}></textarea>',
		data: [
			{ a: 'r', b: true },
			{ a: '<&', b: false },
		],
	},
	{
		// A self-closing element has no content to write the bound value into, and `<textarea />` and
		// `<textarea></textarea>` compile to the same thing -- measured -- so the pair is written out
		// around it rather than refused.
		name: 'a `bind:value` on a self-closed `<textarea>`',
		source:
			'<script>let { data } = $props(); let held = "a<b";</script><textarea bind:value={held} /><p>{data.a}</p>',
		data: [{ a: 'x' }],
	},
	{
		// `transform-server.js` wraps only `template.body` in `do { ... } while (!$$settled)`, so what
		// a binding sends up changes the bytes only through a read in that template. A name it does
		// not read is a second render writing what the first wrote.
		name: 'a binding the child sends back and the caller never reads',
		beside: {
			Emits: '<script>export let n = 1; export function grab() { return n; }</script><p>e{n}</p>',
		},
		source:
			"<script>import Emits from './Emits.svelte'; export let a; let grab;</script>" +
			'<Emits bind:grab /><p>{a}</p>',
		props: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A component `bind:` is a getter and a setter, and the setter only ever sends something back
		// where the child declares the prop with a default -- `bind_props` skips `undefined`. This
		// child has none, so nothing comes back and the binding is the getter, which is the value.
		name: 'a component `bind:` the child sends nothing back through',
		beside: { Kid: '<script>export let v;</script><b>{v}</b>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid bind:v={data.a} /><i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// `shared/component.js` pushes a binding's getter and setter with `push_prop(..., true)`,
		// whose comment says why: "Delay prop pushes so bindings come at the end, to avoid spreads
		// overwriting them." So a spread written after a binding does not win.
		name: 'a component `bind:` a later spread does not overwrite',
		beside: { Kid: '<script>export let v;</script><b>{v}</b>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			"<Kid bind:v={data.a} {...{ v: 'spread' }} />",
		data: [{ a: 'bound' }],
	},
	{
		// The same where the spread's keys are the request's, so the merge is a fold and the render
		// has to agree with it. The binding was written back where it stood, ahead of the spread,
		// and Svelte's own render then let the spread win: `bar` where Svelte wrote `foo`.
		name: 'a component `bind:` a spread whose keys nobody can list does not overwrite',
		beside: { Kid: '<script>export let v;</script><b>{v}</b>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props(); let v = 'foo';</script>" +
			'<Kid bind:v {...data.rest} /><i>{data.k}</i>',
		data: [
			{ rest: { v: 'bar' }, k: '1' },
			{ rest: {}, k: '<' },
		],
	},
	{
		// `runtime-runes/bind-getter-setter`, which sat in the skips until the configs were read.
		// `element.js` writes `b.call(expression.expressions[0])` where the value goes, so a pair
		// is the getter *called*; the child's own `bind:` reads a prop the caller bound with a
		// pair of its own, and what reached the element was the function rather than what calling
		// it returns.
		name: 'a get/set pair bound to a child prop, and the child binding an element with one',
		beside: {
			Kid:
				'<script>let { a = $bindable() } = $props();</script>' +
				'<input type="value" bind:value={() => a, (v) => { a = v; }} />',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props(); let a = $state(0);" +
			'</script><Kid bind:a={() => a, (v) => { a = v; }} /><i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// `runtime-legacy/binding-contenteditable-html`, out of the skips with the one above.
		// Svelte writes the open tag, the value and the close tag whichever way the author closed
		// the element, and `unbind.ts` already wrote the pair out for a `bind:textContent` written
		// self-closing. The arm that plants the content did not, and refused for a tag it could not
		// read, which was never what was wrong with it.
		name: 'a `bind:innerHTML` on a self-closing tag',
		source:
			'<script>export let name;</script><editor contenteditable="true" bind:innerHTML={name} />' +
			'<p>hello {@html name}</p>',
		props: [{ name: '<b>world</b>' }, { name: '' }],
	},
];
