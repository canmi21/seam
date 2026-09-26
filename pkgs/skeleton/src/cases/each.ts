/**
 * Each blocks and keys: items, patterns, empty lists, and what a key holds.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		name: 'a value, a branch and a list',
		source: `${PROPS}<p>{data.a}</p>{#if data.f}<b>{data.a}</b>{/if}{#each data.xs as x}<i>{x}</i>{/each}`,
		data: [
			{ a: 'v', f: true, xs: ['q', 'r'] },
			{ a: '<&"', f: false, xs: [] },
		],
	},
	{
		// Svelte's server writes `let <pattern> = each_array[i]`, so the one element this render
		// iterates has to be something the pattern accepts. It used to be `0`, and destructuring
		// that threw inside Svelte's own output with `number 0 is not iterable`.
		name: 'an each over an array pattern',
		source: `${PROPS}{#each data.pairs as [k, v]}<p>{k}={v}</p>{/each}`,
		data: [
			{ pairs: [] },
			{
				pairs: [
					['a', '1'],
					['b', '2'],
				],
			},
		],
	},
	{
		// An array pattern destructures by the iterator protocol, which is what Svelte's server
		// leaves to the engine. Reading the element by index is the same answer for an array and no
		// answer at all for a `Set`, so it goes through `to_array`: arrays unchanged, everything
		// else through `Array.from`. Without the count `_extract_paths` passes, whose branch tests
		// `Symbol.iterator in value` and throws on a primitive -- `{@const [first] = 'ab'}`
		// destructures on the server.
		name: 'an each over an array pattern whose elements are iterable but not arrays',
		source: `${PROPS}{#each data.rows as [a, b]}<p>{a}-{b}</p>{/each}`,
		data: [
			{ rows: [] },
			{
				rows: [
					new Set(['x', 'y']),
					new Map([
						['p', 1],
						['q', 2],
					]),
				],
			},
		],
	},
	{
		// The block binds the element under a name of its own and every name the pattern binds is an
		// expression over it: a member stays a path the injector resolves per item, and a literal
		// key, a computed key, a nesting and a rest are each a derivation over the binding. A
		// computed key reads what the same pattern bound before it, which is JavaScript's own order.
		name: 'an each over a pattern taken apart every way one offers',
		source:
			`${PROPS}{#each data.rows as { 'a-b': ab, [ab ?? 'k']: picked, n: { deep }, xs: [head, ...more], ...rest }, i}` +
			'<p>{i}:{ab}|{picked}|{deep}|{head}|{more.length}|{JSON.stringify(rest)}</p>{/each}',
		data: [
			{ rows: [] },
			{
				rows: [
					{ 'a-b': 'k', k: 'P', n: { deep: 'D' }, xs: [1, 2, 3], z: '<' },
					{ 'a-b': 'z', n: {}, xs: [] },
				],
			},
		],
	},
	{
		// Two things the walk had never met on the way into a child. `build_inline_component`'s
		// attribute loop has an arm for a `let:`, a spread, an attribute, a `bind:` and an
		// attachment and nothing else, so an `on:` contributes no property and the walk may step
		// over it -- it used to leave the child unentered and hand it a marker for its prop. And a
		// `$:` is collected by `LabeledStatement.js` and run once at the end of the instance body,
		// writing no bytes, so one reading a prop the render was handed nothing for threw inside
		// Svelte's own renderer.
		name: 'a legacy child listened to, with a reactive statement beside its prop',
		beside: {
			Row:
				'<script>export let todo; $: console.log(todo.id);</script>' +
				"<button on:click>{todo.done ? 'X' : ''}{todo.id}</button>",
		},
		source:
			"<script>import Row from './Row.svelte'; let { data } = $props();</script>" +
			'{#each data.todos as todo}<Row {todo} on:click={() => todo.id} />{/each}',
		data: [
			{ todos: [] },
			{
				todos: [
					{ id: 1, done: false },
					{ id: 2, done: true },
				],
			},
		],
	},
	{
		name: 'an each over an object pattern, with an index',
		source: `${PROPS}{#each data.rows as { id, label }, at}<i>{at}:{id}:{label}</i>{/each}`,
		data: [
			{ rows: [] },
			{
				rows: [
					{ id: 'x', label: 'L' },
					{ id: 'y', label: '<&' },
				],
			},
		],
	},
	{
		// The identity of a value handed to a child. `items` makes an array, and each read inside the
		// child used to build its own, so `items.includes(item)` asked a second array whether it held
		// the first one's element and answered `false` where Svelte answers `true`. The value is held
		// at the call site now and both reads are one array. See spec/derivation.md.
		name: 'a child asking whether the list it was handed holds the item it was handed',
		beside: {
			Item: '<script>let { item, items } = $props();</script><b>{item.n} {items.includes(item)}</b>',
		},
		source:
			"<script>import Item from './Item.svelte'; let { data } = $props();" +
			" const items = [{ n: 'a' }, { n: 'b' }];</script>" +
			'{#each items as item}<Item {item} {items} />{/each}<i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// `renderer.select` destructures `const { value, defaultValue, ...select_attrs } = attrs`, so
		// what those two names hold decides `select_value` and nothing else, and both `undefined` is
		// a select taking charge of no option -- which is what this compiler has taken over. Written
		// back as `undefined` rather than left out, the object no longer has to have listable keys:
		// a spread of a call had none, and the whole run was refused over a rewrite this does
		// without one.
		name: 'a select whose spread has keys nobody can list',
		source:
			'<script>let { data } = $props();' +
			" const extra = Object.assign({}, { id: 'pick' });</script>" +
			'<select {...extra} value="b"><option value="a">A</option>' +
			'<option value="b">B</option></select><i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// `Component.js` is one line -- `context.visit(b.member_id(node.name))` -- so a tag's name is
		// an expression and `<C />` is `<svelte:component this={C} />` written another way. Over a
		// name an each binds, the tag used to reach the render as the marker standing for the item
		// and Svelte called it: `C is not a function`, naming nothing the author wrote. Where the
		// block's source is a list whose elements all name one component, the root is written as that
		// component and the tag is Svelte's to render, which is where a member tag already goes.
		name: 'a component tag named by what an each block binds',
		beside: {
			Tip: '<span>tip</span>',
			Reg: "<script module>import Tip from './Tip.svelte'; export const Reg = { Tip };</script>",
		},
		source:
			"<script>import { Reg } from './Reg.svelte'; let { data } = $props();" +
			' const list = [Reg];</script>{#each list as R}<R.Tip />{/each}<i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// A call's result is not its callee. `{ a = fallback() }` in an each's pattern is a ternary
		// over a per-item test whose branch is a call, and reading the callee as a name made it a
		// choice between things a marker cannot stand for -- which a per-item test cannot be
		// enumerated for. What a marker cannot stand for is a branch that **is** the thing.
		name: 'a pattern default that calls, inside an each',
		source:
			'<script>let { data } = $props(); function one() { return 1 }</script>' +
			'{#each [{}, { a: 2 }] as { a = one() }}<i>{a}</i>{/each}<b>{data.a}</b>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// The markup stays in the caller's tag and `$.slot` calls it wherever a slot executes, so the
		// bytes come from the render either way. What the walk does at a `<slot>` is rewrite the
		// caller's source and plant its holes, and doing that twice over one span is two edits on one
		// place -- so the second slot rendering the same group is walked once and no more.
		name: 'a child with a `<slot>` in each branch',
		beside: {
			Kid:
				'<script>export let on;</script>' +
				'{#if on}<b>T <slot></slot></b>{:else}<i>F <slot></slot></i>{/if}',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid on={data.f}><em>fixed</em></Kid><p>{data.a}</p>',
		data: [
			{ f: true, a: 'x' },
			{ f: false, a: '<&' },
		],
	},
	{
		// A derivation that reads what an each block binds. Every other one is a pure function of
		// the payload and is computed once, before anything is injected; this is the same pure
		// function with one more input, and that input only exists inside the loop. So it is called
		// per item instead. Both lowering passes refused it before, on the reading that a
		// derivation is computed once per request -- which is a consequence of what its inputs are
		// rather than a rule about it. Here it stands in a slot, in an attribute, and as a test.
		name: 'a derivation that reads what an each block binds',
		source:
			`${PROPS}{#each data.rows as r}` +
			'<span title={r.name + "!"}>{r.name.toUpperCase()}</span>' +
			'{#if r.count * 2 > 4}<b>many</b>{:else}<i>few</i>{/if}' +
			'{/each}',
		data: [
			{
				rows: [
					{ name: 'a', count: 3 },
					{ name: '<&', count: 1 },
				],
			},
			{ rows: [] },
		],
	},
	{
		// A key is not carried into the IR at all: Svelte's server transform never mentions one --
		// `EachBlock.js` visits the expression, the context, the index, the body and the fallback --
		// and a keyed each renders byte for byte what an unkeyed one renders. The counter is bound
		// beside the item, which is what the `for` loop it compiles to does. See spec/ir.md.
		name: 'an each with a key and an index',
		source: `${PROPS}{#each data.xs as x, n (x)}<i>{n}:{x}</i>{/each}`,
		data: [{ xs: ['a', 'b'] }, { xs: [] }],
	},
	{
		// The key leaves the render and the block stays keyed. An `animate:` element must be the
		// only child of a **keyed** each and `2-analyze/visitors/shared/element.js` asks
		// `parent.key` for exactly that, so unkeying the render's copy failed Svelte's own analysis
		// with `animation_missing_key`. Red without the literal the key is replaced by: Svelte
		// refuses to compile what the walk hands it. See spec/refusals.md.
		name: 'a keyed each whose only child animates',
		source:
			'<script>let { data } = $props(); function flip() { return { duration: 0 } }</script>' +
			'{#each data.xs as x (x)}<i animate:flip>{x}</i>{/each}',
		data: [{ xs: ['a', 'b'] }, { xs: [] }],
	},
	{
		// The expression is replaced and the parentheses around it are not. Cutting from the `(`
		// before the key to the `)` after it takes the wrong pair where the key holds parentheses of
		// its own, and the render's copy was then invalid JavaScript.
		name: 'a key that holds parentheses of its own',
		source: `${PROPS}{#each data.xs as x ((() => x)())}<i>{x}</i>{/each}`,
		data: [{ xs: ['a', 'b'] }],
	},
	{
		// `DeclarationTag.js` pushes the whole `VariableDeclaration` into `init`, so one tag may
		// declare several at once and a later one reads what an earlier bound. Its initialiser
		// reaches the same `CallExpression` visitor a script's does, so the rune is compiled away
		// the same way: the value is the rune's first argument. Runes mode only, which
		// `declaration_tag_no_legacy_mode` enforces.
		name: 'a `{let}` declaring two at once, each rune read through',
		source: `${PROPS}{let n = $state(data.n), twice = $derived(n * 2)}<p>{n}:{twice}</p>`,
		data: [{ n: 3 }],
	},
	{
		// `EachBlock.js` writes the `for` loop whether or not there is a context, and only skips
		// `let <context> = each_array[i]` where there is none. So a block with no `as` runs the same
		// number of times and binds nothing, and the item is the block's own name -- the IR's `each`
		// binds a name per iteration and has no shape for binding none.
		name: 'an each block with no `as`, with and without a counter',
		source: `${PROPS}{#each data.xs}<i>x</i>{/each}{#each data.xs, n}<b>{n}</b>{/each}`,
		data: [{ xs: ['a', 'b'] }, { xs: [] }],
	},
	{
		// An import the markup never names: the declaration calls it and the markup reads the
		// declaration, which substitutes into a derivation calling the import. The bundle has to
		// hold it, and it did not: only what the markup named directly was gathered.
		name: 'an import reached through a declaration',
		alongside: { 'loud.ts': 'export const loud = (v) => String(v).toUpperCase();' },
		source:
			"<script>import { loud } from './loud.ts'; let { data } = $props(); const shout = loud(data.a);</script>" +
			'<p>{shout}</p>',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// An each whose source the request does not decide is iterated per request all the same,
		// so the runtime holds the source -- as the value the render computed, written as JSON,
		// never as the computation. The body's holes are per item as always.
		name: 'an each the request does not decide',
		alongside: { 'digits.ts': "export const digits = () => [{ d: '1' }, { d: '2' }];" },
		source:
			"<script>import { digits } from './digits.ts'; let { data } = $props(); const list = digits();" +
			'</script>{#each list as { d }, i}<i>{d}{i}{data.a}</i>{/each}',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// The key is the client's. Svelte's server never evaluates it and writes the fragment between
		// two empty comments, which are not a block, so the body is walked as if the key were not
		// there. Holding a block and a value, because that is what the fragment may hold.
		name: 'a key block',
		source: `${PROPS}{#key data.k}<p>{data.a}</p>{#if data.f}<b>y</b>{/if}{/key}`,
		data: [
			{ k: 1, a: 'x', f: true },
			{ k: 2, a: '<&', f: false },
		],
	},
	{
		// Two shapes, the way an if is two: `<!--[-->` and the items for a list with something in
		// it, `<!--[!-->` and the fallback for one with nothing. The fallback is read from a render
		// made with an empty list, and it is markup like any other, so it holds a value and a
		// block of its own here. Every payload the shape turns on: a full list, an empty one, and
		// nothing at all, which `ensure_array_like` reads as empty. See spec/refusals.md.
		name: 'an each with an else',
		source:
			`${PROPS}{#each data.xs as x}<i>{x}</i>{:else}<p>{data.none}</p>` +
			'{#if data.f}<b>f</b>{/if}{/each}<u>{data.after}</u>',
		data: [
			{ xs: ['a', 'b'], none: 'n', f: true, after: 'z' },
			{ xs: [], none: '<&', f: true, after: 'z' },
			{ xs: [], none: 'n', f: false, after: 'z' },
			{ none: 'n', f: true, after: 'z' },
		],
	},
	{
		// The fallback inside a branch, and a branch inside the fallback, since the fallback's
		// blocks are numbered within the each the way an else's are within its if.
		name: 'an each with an else, nested both ways',
		source:
			`${PROPS}{#if data.f}{#each data.xs as x}<i>{x}</i>{:else}` +
			'{#each data.ys as y}<s>{y}</s>{:else}<p>none</p>{/each}{/each}{/if}',
		data: [
			{ f: true, xs: ['a'], ys: [] },
			{ f: true, xs: [], ys: ['b', 'c'] },
			{ f: true, xs: [], ys: [] },
			{ f: false, xs: [], ys: [] },
		],
	},
	{
		// `let { id = data.d } = each_array[i]` in Svelte's own output: the default is taken when the
		// member is `undefined` and only then, so `null` is written as nothing. The runtime binds the
		// member and every read of the name is that choice, made per item.
		name: 'an each pattern with a default',
		source:
			`${PROPS}{#each data.rows as { id = data.d, n = 5 }}<i>{id}-{n}</i>{/each}` +
			'{#each data.pairs as [k, v = "?"]}<b>{k}{v}</b>{/each}',
		data: [
			{ d: 'D', rows: [{}, { id: 2 }, { id: null, n: 0 }], pairs: [['a'], ['b', 'c']] },
			{ d: 'E', rows: [], pairs: [] },
		],
	},
	{
		// `ensure_array_like`: a source with a length is itself, and anything else goes through
		// `Array.from`, which is what a `Map` or a `Set` in the payload meets. The fallback turns on
		// the converted list's length, so a size is a length there.
		name: 'an each over a Map or a Set',
		source:
			`${PROPS}{#each data.m as [k, v]}<b>{k}{v}</b>{:else}none{/each}` +
			'{#each data.s as x, i}<u>{i}{x}</u>{/each}',
		data: [
			{
				m: new Map([
					['x', 1],
					['y', 2],
				]),
				s: new Set(['p', 'q']),
			},
			{ m: new Map(), s: new Set() },
			{ m: [['z', 3]], s: undefined },
		],
	},
	{
		name: 'a dynamic component chosen through a table, with a key the table lacks',
		beside: { Ay2: '<i>A</i>' },
		source:
			"<script>import Ay2 from './Ay2.svelte'; let { data } = $props();" +
			' const ICONS = { a: Ay2 };</script><svelte:component this={ICONS[data.k]} /><p>{data.x}</p>',
		fixed: { 'data.k': '"zz"' },
		data: [{ k: 'zz', x: '2' }],
	},
	{
		// `ensure_array_like` asks the value for a `length` and hands back the value itself where it
		// has one, and the loop that follows reads `array[i]` for `i < array.length`. So a **string**
		// iterates its characters, and so does any array-like. Asking whether the source was an
		// object first missed both and wrote nothing.
		name: 'an each over a string and over an array-like',
		source:
			`${PROPS}<ul>{#each data.t as c}<li>{c}</li>{/each}</ul>` +
			'<ol>{#each data.like as x}<li>{x}</li>{/each}</ol>',
		data: [
			{ t: 'foo', like: { length: 2, 0: 'a', 1: 'b' } },
			{ t: '', like: { length: 0 } },
		],
	},
];
