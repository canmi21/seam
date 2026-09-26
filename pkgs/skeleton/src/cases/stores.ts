/**
 * Stores: declared, imported, brought by the request, and read where the bytes are written.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { writable } from 'svelte/store';
import { type Case } from './case.ts';

export const cases: Case[] = [
	{
		// A subscription over a prop. `2-analyze/index.js` writes the allowance out rather than
		// implying it -- `store_name !== 'props' && get_rune(init, instance.scope) === '$props'`,
		// under "rune-like names received as props are valid too" -- so `const { s } = $props()`
		// beside `{$s}` is a store subscription Svelte compiles. This pass asked only what the
		// scripts declare, so the read was reported as a name the data does not carry.
		name: 'a child subscribing to a store its caller passed',
		beside: { Sub: '<script>const { s } = $props();</script><b>{$s.n}</b>' },
		source:
			"<script>import { writable } from 'svelte/store'; import Sub from './Sub.svelte';" +
			" let { data } = $props(); const s = writable({ n: 'q' });</script>" +
			'<Sub {s} /><i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// A store the request brings. It used to be refused: the payload was the wire too, and a
		// store is an object with a `subscribe` function. The render input holds any value, and
		// `$s` is the store's value read per request. See spec/payload.md.
		name: 'a `$store` over a value the request brings',
		source: '<script>export let s;</script><p>{$s}</p>',
		props: [{ s: writable('one') }, { s: writable('two') }, { s: writable(undefined) }],
	},
	{
		// The pass that drops an unused import asks whether the file still mentions the name, and it
		// asked through the reader that skips a name written to -- which is right everywhere else and
		// wrong here. `$count++` is the only mention an imported store may have, so the import went
		// and Svelte refused the read: "`$count` is an illegal variable name".
		name: 'an imported store whose only mention is written to',
		alongside: {
			'counter.js': "import { writable } from 'svelte/store'; export const count = writable(0);",
		},
		source:
			"<script>import { count } from './counter.js'; let { data } = $props();" +
			'export function bump() { $count++ }</script><p>{data.a}|{$count}</p>',
		data: [{ a: 'v' }],
	},
	{
		// The same declaration holding a store. Read as a write to a store the script already had,
		// the whole subscription was left to the render -- which is given no props and wrote
		// nothing. A `$:` that binds the name is not a statement that sets the store's value.
		name: 'a store a `$:` binds by destructuring',
		source:
			"<script>import { writable } from 'svelte/store'; export let data;" +
			" const held = { s: writable('hi') }; $: ({ s } = held);</script><p>{data.a}|{$s}</p>",
		data: [{ a: 'v' }],
	},
	{
		// A declaration holding a snapshot holds what was snapshotted. `VariableDeclaration.js` writes
		// `args.length > 0 ? visit(args[0]) : b.void0` for every rune it does not let through, so
		// there `$state.snapshot(v)` is `v`. In an expression the same call is `$.snapshot(v)`, which
		// clones -- two visitors, and this is the declaration's.
		name: 'a declaration holding a `$state.snapshot`',
		source:
			'<script>let { data } = $props(); let held = $state({ a: data.a });' +
			' let taken = $state.snapshot(held);</script><p>{taken.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// `transform-server.js` binds `$$props` to `sanitize_props($$props)`, `$$restProps` to
		// `rest_props($$sanitized_props, [named])` and `$$slots` to `sanitize_slots($$props)`, each
		// over the object the caller passed. The entry's is the payload; a child's is what its call
		// site wrote, which the walk has as the same object `spread_props` merges. `sanitize_props`
		// drops `children` and `$$slots`, neither of which that object carries, and which slots were
		// filled is known by name here. The list `rest_props` leaves out is the readonly exports
		// first and the bindable props after, which is the order `transform-server.js` builds it in.
		name: "a child's `$$props`, `$$restProps` and `$$slots`",
		beside: {
			Kid:
				'<script>export let a; export function b() {} export let c = 1;</script>' +
				'<p>{JSON.stringify($$props)}|{JSON.stringify($$restProps)}|' +
				'{$$slots.default ? "d" : "-"}</p><slot />',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid a={data.a} c={3} d="4">x</Kid>',
		data: [{ a: 'v' }],
	},
	{
		// A rest or a whole binding keeps `children` in it, and the walk composes slot content rather
		// than passing a function for it, so where the caller fills the default slot the object would
		// be a key short. The walk stops at the tag instead and Svelte renders the component, which
		// has the function. Measured before it stopped: `Object.getOwnPropertyNames(rest)` listed
		// `b` where Svelte lists `b,children`.
		name: 'a child gathering a rest from `$props()` under filled slot content',
		beside: {
			Kid: '<script>let { a, ...rest } = $props();</script><i>{a}|{Object.keys(rest).join()}</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid a={data.a} b="2">slot</Kid>',
		data: [{ a: 'v' }],
	},
	{
		// A rest on the entry is every key the request brought that the pattern did not name, and the
		// payload itself is what it is gathered from -- `GIVEN` names that object. `$$slots` and
		// `$$events` are excluded with the named props, and only where there is a rest:
		// `VariableDeclaration.js` splices them into the object pattern ahead of the rest element
		// for that reason, and leaves a pattern without one alone.
		name: "a rest in the entry's `$props()`",
		source:
			'<script>const { foo, first = 1, ...others } = $props();</script>' +
			'{foo} {first} {others.bar} {JSON.stringify(others)}',
		props: [
			{ foo: 'f', bar: 'b', extra: 2 },
			{ foo: '<&', first: 9, bar: '<&' },
		],
	},
	{
		// `$bindable` marks a prop a parent may write and may only appear inside `$props()`, so what
		// stands for the default elsewhere is its argument. The entry has no parent to bind it.
		name: "a `$bindable` default on the entry's own props",
		source:
			'<script>let { data, open = $bindable(true) } = $props();</script>' +
			'<p>{open ? "open" : "shut"}</p><i>{data.a}</i>',
		props: [{ data: { a: 'x' } }, { data: { a: 'x' }, open: false }],
	},
	{
		// `$x` is a subscription to the store `x`: `build_getter` writes
		// `$.store_get($$store_subs ??= {}, '$x', x)`, which subscribes, takes the value and
		// memoises it for the render. So it resolves exactly where `x` resolves, and where `x` is the
		// component's own the read decides nothing per request and the render evaluates it.
		name: 'a store the component made, read in markup',
		alongside: {
			'shop.ts':
				"import { readable } from 'svelte/store'; export const held = readable('imported');",
		},
		source:
			"<script>import { writable } from 'svelte/store'; import { held } from './shop.ts';" +
			' let { data } = $props(); const own = writable(1);</script>' +
			'<p>{$own}</p><i>{$held}</i><b>{$own + 1}</b><u>{data.a}</u>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// `$foo` is a subscription to the store `foo`, which Svelte compiles to
		// `store_get($$store_subs, '$foo', foo)`. Where `foo` is a declaration this pass substitutes,
		// the read is the store's value -- `get` from `svelte/store`, which subscribes, takes it and
		// unsubscribes, Svelte's own holding the subscription until a teardown a derivation has not
		// got. It used to reach the evaluator as the bare name and throw `$foo is not defined` per
		// request.
		name: 'a store read where the store is a declaration',
		source:
			"<script>import { writable } from 'svelte/store'; let { data } = $props();" +
			" const n = writable(42); const t = writable('x');</script>" +
			'<p>{$n}</p><p class:on={$n > 1}>{$t}{data.a}</p>',
		data: [{ a: '1' }, { a: '<' }],
	},
];
