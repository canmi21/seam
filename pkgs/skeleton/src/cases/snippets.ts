/**
 * Snippets and render tags: declared, handed, rendered per call, and what a body of one holds.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		// A snippet is a function and a render is a call, so two renders inline the body twice.
		// The markers are planted once, in one body, and used to come back twice. One copy per call
		// site is what the render does anyway, and it leaves every pass below the case it knows.
		name: 'a snippet rendered more than once',
		source: `${PROPS}{#snippet h()}<p>{data.a}</p>{/snippet}{@render h()}{@render h()}`,
		data: [{ a: 'v' }, { a: '<&"' }],
	},
	{
		// The reason this could not be one body: a parameter has to stand for a different argument
		// at each call.
		name: 'a snippet with a parameter, rendered more than once',
		source:
			`${PROPS}{#snippet h(v)}<p>{v}</p>{/snippet}` +
			'{@render h(data.a)}{@render h(data.b)}{@render h(data.a)}',
		data: [
			{ a: 'p', b: 'q' },
			{ a: '', b: null },
		],
	},
	{
		// One of the calls inside a block, so the copies are not adjacent and the block numbering
		// has to survive the rewrite.
		name: 'a repeated snippet with one call inside a block',
		source:
			`${PROPS}{#snippet h(v)}<i>{v}</i>{/snippet}` +
			'{@render h(data.a)}{#if data.f}{@render h(data.b)}{/if}',
		data: [
			{ a: 'p', b: 'q', f: true },
			{ a: 'p', b: 'q', f: false },
		],
	},
	{
		// The optional form. Svelte parses it as a chain around the call, so reading the callee
		// straight off the expression found nothing and this was refused for naming a snippet the
		// component does not declare -- which it does.
		name: 'an optional render of a local snippet',
		source: `${PROPS}{#snippet h()}<p>{data.a}</p>{/snippet}<div>{@render h?.()}</div>`,
		data: [{ a: 'v' }],
	},
	{
		// A default is JavaScript's: taken when the value is `undefined` and only then, which is
		// also what a parameter with no argument written for it holds.
		name: 'snippet parameters with defaults',
		source:
			`${PROPS}{#snippet r(v = data.d)}<p>{v}</p>{/snippet}{@render r(data.a)}` +
			'{#snippet s({ a = 1, b })}<i>{a}{b}</i>{/snippet}{@render s(data.o)}' +
			"{#snippet t(v = 'z')}<u>{v}</u>{/snippet}{@render t()}",
		data: [
			{ d: 'D', a: 'x', o: { a: 0, b: 'B' } },
			{ d: 'D', o: { b: 'B' } },
			{ d: 'D', a: null, o: { a: null, b: null } },
		],
	},
	{
		// A `{#snippet}` written inside a component's tag is a prop of its own under its own name,
		// and everything else in the tag is `children`. So a component may write one and not the
		// other, which is what bits-ui's trigger does. Measured as one group it looked like a
		// component writing none of what it was given while a marker from that markup came back.
		// See `visitors/shared/component.js` and spec/refusals.md.
		name: 'a snippet beside markup, where the child writes only the markup',
		beside: {
			Sided:
				'<script>let { children, ...rest } = $props();</script>' +
				'<div>{@render children()}</div>',
		},
		source:
			"<script>import Sided from './Sided.svelte'; let { data } = $props();</script>" +
			'<Sided><b>{data.a}</b>{#snippet extra()}<i>{data.b}</i>{#if data.f}<u>u</u>{/if}{/snippet}</Sided>',
		data: [
			{ a: 'x', b: 'y', f: true },
			{ a: '<&', b: 'z', f: false },
		],
	},
	{
		// A `{@const}` inside a snippet. Its body was walked child by child rather than as the
		// fragment it is, which stepped past the arm that reads one -- so a const tag reached the
		// walk's default case and was refused as a construct nobody had taught it, in a shape the
		// compiler had handled everywhere else for a while.
		name: 'a const tag inside a snippet',
		source:
			`${PROPS}<div>{@render row(data.n)}{@render plain()}</div>` +
			'{#snippet row(v)}{@const twice = v * 2}<i>{twice}</i>{/snippet}' +
			'{#snippet plain()}{@const k = data.a}<b>{k}</b>{/snippet}',
		data: [
			{ n: 3, a: 'x' },
			{ n: 0, a: '<&' },
		],
	},
	{
		// A snippet declared at the top of a component and rendered inside a branch. Svelte compiles
		// the declaration to a function and writes nothing for it; the body writes where the
		// `{@render}` calls it. Walking it at the declaration numbered its blocks against the
		// branches enclosing *that*, so a block inside the body belonged to a render nobody made and
		// the assembler went looking for it: `block 15 does not appear in the render made for it`.
		name: 'a snippet rendered inside a branch, holding a block of its own',
		source:
			`${PROPS}{#snippet row(v)}<i>{v}</i>{#if data.g}<b>{v}</b>{:else}<u>n</u>{/if}{/snippet}` +
			'{#if data.f}<p>first</p>{:else if data.s}{@render row(data.a)}{:else}<p>last</p>{/if}',
		data: [
			{ f: false, s: true, g: true, a: 'x' },
			{ f: false, s: true, g: false, a: '<&' },
			{ f: true, s: false, g: false, a: 'y' },
			{ f: false, s: false, g: false, a: 'z' },
		],
	},
	{
		// A snippet passed to a component that calls it. There is no `{@render}` in this component
		// to walk the body at -- the child decides when to call it -- so the declaration is the only
		// place, and skipping it left the child rendering the author's markup unrewritten, against
		// declarations the render had emptied.
		name: 'a snippet passed to a child that calls it',
		beside: {
			Calls:
				'<script>let { extra, children, ...rest } = $props();</script>' +
				'<div>{@render children()}{@render extra()}</div>',
		},
		source:
			"<script>import Calls from './Calls.svelte'; let { data } = $props(); const n = data.n;</script>" +
			'<Calls><b>{data.a}</b>{#snippet extra()}<i>{n}</i>{#if data.f}<u>y</u>{/if}{/snippet}</Calls>',
		data: [
			{ a: 'x', n: 3, f: true },
			{ a: '<&', n: 0, f: false },
		],
	},
	{
		// A snippet that reads one of the arguments the child would call it with, given to a child
		// that never calls it: a closed menu, which bits-ui writes nothing for. The value has nothing
		// standing in its place, and nothing needs to -- the markup is content the client makes
		// after hydration and the server never had, which is what Svelte's own server writes for a
		// closed menu, and it is the probe that says so rather than the declaration. A tag written
		// across lines, because the whitespace beside the snippet used to open a `children` group
		// of its own and the probe's literal there was the content Svelte refuses beside an
		// explicit `children`. See spec/refusals.md.
		name: 'a snippet reading a value, given to a child that never calls it',
		beside: {
			Closed:
				'<script>let { children, ...rest } = $props(); const open = false;</script>' +
				'<div>{#if open}{@render children?.({ checked: true })}{/if}</div>',
		},
		source:
			"<script>import Closed from './Closed.svelte'; let { data } = $props();</script>" +
			'<Closed>\n\t{#snippet children({ checked })}<i class={checked ? "on" : "off"}>{data.a}</i>' +
			'{#if checked}<u>c</u>{/if}{/snippet}\n</Closed><p>{data.a}</p>',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A snippet with a parameter, written inside the tag of a component the walk cannot enter,
		// where the parameter is itself a snippet the component supplies and the body only renders
		// it. There is nothing for this pass to put in its place and nothing that needs putting:
		// the component writes those bytes during the render, as any component writes its own.
		//
		// Paraglide's `<Message>` is the shape -- `{#snippet link({ children })}<a>{@render
		// children?.()}</a>{/snippet}` -- and what comes back through it is the marker the caller
		// put in `inputs`, measured on the generated message: the markup part wraps
		// `String(i?.language)`, so the value stays a hole rather than being baked in.
		name: 'a snippet whose parameter the component supplies and the body only renders',
		beside: {
			Weaves:
				'<script>let { link, inputs, ...rest } = $props();</script>' +
				'{#snippet inner()}{inputs.name}{/snippet}' +
				'<p>before {@render link?.({ children: inner })} after</p>',
		},
		source:
			"<script>import Weaves from './Weaves.svelte'; let { data } = $props();</script>" +
			'<Weaves inputs={{ name: data.a.toUpperCase() }}>' +
			'{#snippet link({ children })}<a href="/x">{@render children?.()}</a>{/snippet}' +
			'</Weaves>',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A snippet is a value. `RenderTag.js` visits the callee as an expression and calls it with
		// the renderer -- `{@render foo(1)}` is `foo($$renderer, 1)` -- so the callee may be anything
		// that evaluates to one: a store read, an import from another component's module script.
		// Where nothing in the call is the request's, the render evaluates it and writes the bytes
		// the walk would otherwise have had to reproduce, which is the answer an inert spread gets.
		name: 'a `{@render}` of a snippet this file does not declare, over nothing the request decides',
		beside: {
			Kid: '<script module>export { hi }</script>{#snippet hi(n)}<b>hi {n}</b>{/snippet}',
		},
		source:
			"<script>import { hi } from './Kid.svelte'; let { data } = $props();</script>" +
			'{@render hi(2)}<p>{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// A snippet is a function Svelte's server declares and `{@render}` calls, so rendering the
		// component inlines it: the body's markers are planted where it is written and come back
		// where it is called, which a marker's own index makes fine. Declared after the render tag
		// on purpose, and holding blocks of its own. See spec/refusals.md.
		name: 'a local snippet with no parameters',
		source:
			`${PROPS}<div>{@render head()}</div>` +
			'{#snippet head()}<h1>{data.a}</h1>{#if data.f}<b>{data.a}</b>{/if}{/snippet}',
		data: [
			{ a: 'v', f: true },
			{ a: '<&', f: false },
		],
	},
	{
		// A parameter's value is the argument at the one `{@render}` that calls the snippet, so it
		// substitutes like any other declared name. Here it stands in a slot, in a branch's test and
		// as an each block's source, and it shadows a script name of its own. See spec/refusals.md.
		name: 'a snippet with parameters',
		source:
			"<script>let { data } = $props(); const v = 'script'</script>" +
			'{#snippet r(v, n, { k }, [j])}<i>{v}{k}{j}</i>{#if n}<b>{v}</b>{/if}{/snippet}' +
			'{@render r(data.a, data.f, data.o, data.xs)}<b>{v}</b>',
		data: [
			{ a: 'x', f: true, o: { k: 'K' }, xs: ['J'] },
			{ a: '<&', f: false, o: {}, xs: [] },
		],
	},
	{
		// Given a pending snippet, a synchronous render is pending by definition: Svelte writes
		// `<!--[!-->`, the snippet's body, `<!--]-->`, and none of the children.
		name: 'a boundary with a pending snippet',
		source:
			`${PROPS}<svelte:boundary><p>{data.a}</p>{#snippet pending()}<i>{data.b}</i>` +
			'{#if data.f}<u>u</u>{/if}{/snippet}{#snippet failed(e)}<s>{e}</s>{/snippet}</svelte:boundary>',
		data: [
			{ a: 'x', b: 'y', f: true },
			{ a: 'x', b: '<&', f: false },
		],
	},
	{
		// `RegularElement.js`: `if (body) { value } else { children }`, with no anchor around
		// either. The if is written bare, and a textarea, which can hold no block, is one
		// expression choosing between the value and the text.
		name: 'a content binding on an element with children',
		source:
			'<script>let { data } = $props(); let v = $state(data.h); let t = $state(data.t);</script>' +
			'<div contenteditable bind:innerHTML={v}>x<b>{data.a}</b>{#if data.f}<i>f</i>{/if}</div>' +
			'<p contenteditable bind:textContent={t}>y{data.a}</p>' +
			'<textarea bind:value={t}>z &lt;</textarea>',
		data: [
			{ h: '<i>H</i>', t: 'T<', a: 'A', f: true },
			{ h: '', t: undefined, a: 'B', f: false },
			{ h: 0, t: 0, a: 'C', f: true },
		],
	},
	{
		// `SvelteBoundary.js` reads a `pending` attribute naming a declared snippet the way it reads
		// the tag form, and `failed` goes into the boundary's props, which write nothing.
		name: 'a boundary given its snippets by attribute',
		source:
			`${PROPS}{#snippet p()}<i>{data.a}</i>{/snippet}{#snippet f(e)}<b>{e}</b>{/snippet}` +
			'<svelte:boundary pending={p} failed={f}><p>{data.a}</p></svelte:boundary>' +
			'<svelte:boundary failed={f}><p>{data.a}</p></svelte:boundary>' +
			'<svelte:boundary pending={p}><p>x</p></svelte:boundary>',
		data: [{ a: 'A' }, { a: '<' }],
	},
	{
		// `RenderTag.js` passes every argument through, and JavaScript drops the ones nothing
		// receives, so the extra binds nothing and is written out like the rest.
		name: 'a snippet rendered with more arguments than it takes',
		source: `${PROPS}{#snippet r(a)}<p>{a}</p>{/snippet}{@render r(data.a, data.b)}`,
		data: [
			{ a: 'A', b: 'B' },
			{ a: '<', b: null },
		],
	},
	{
		// A `{@render}` whose callee the request decides can only be the snippet the source names:
		// the payload carries data and no function. Unlike a `<svelte:component>` there is no second
		// outcome to write a block for -- `RenderTag.js` emits `snippet($$renderer, ...)`, a plain
		// call, so a value that is not a function throws rather than rendering nothing. The name is
		// written as `(0, name)` so the tag stays the dynamic one it was: `is_standalone` wants a
		// render tag that is not dynamic, and a bare name made it one and dropped an anchor.
		name: 'a snippet the request decides, named by a default',
		source:
			'<script>let { data, kids = mine } = $props();</script>' +
			'{@render kids()}{#snippet mine()}<p>m</p>{/snippet}<p>{data.a}</p>',
		data: [{ a: 'x' }],
	},
	{
		// A `{#snippet x(n)}` written inside a component's tag is the prop `x`, which is the modern
		// spelling of `<svelte:fragment slot="x" let:...>`: `build_inline_component` puts both in the
		// same place. So it is a group of its own, its body is what the component renders, and its
		// parameters are bound to the arguments the component calls it with -- a `let:` the other
		// way round. The group is also a prop the child may test, and its value is a function, so it
		// stands for the one thing a derivation can ask of one.
		name: 'a snippet written at the call site and rendered with the child`s own value',
		beside: {
			Kount:
				'<script>let { foo, other } = $props(); let n = 3;</script>' +
				'{#if foo}{@render foo(n)}{/if}{#if other}<b>o</b>{/if}',
		},
		source:
			"<script>import Kount from './Kount.svelte'; let { data } = $props();</script>" +
			'<Kount>{#snippet foo(v)}<p>v={v}|{data.a}</p>{/snippet}</Kount>',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A component tag renders snippets too. `2-analyze` keeps `analysis.snippet_renderers` over
		// **sites** -- a render tag and a component tag both are one -- and `shared/component.js`
		// adds the snippet a `foo={bar}` names to the tag's set. Counting only the render tags whose
		// callee is a name this file declares made a snippet handed over as `<Kid {foo} />` read as
		// one nobody renders.
		// The body is the component's to write here, and nothing in it is the request's: the walk
		// leaves it, which is the same answer an inert value handed over already gets. One reading
		// the request needs the body walked where the component calls it, and that is refused.
		name: 'a snippet handed to a component by name',
		beside: { Kidder: '<script>let { foo } = $props(); let n = 3;</script>{@render foo(n)}' },
		source:
			"<script>import Kidder from './Kidder.svelte'; let { data } = $props();</script>" +
			'{#snippet foo(v)}<p>v={v}</p>{/snippet}<Kidder {foo} /><b>{data.a}</b>',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// A callee that settled names a different snippet than the one written at the tag, and the
		// record it settled to holds the calls of *its* name -- none, where nothing calls it by name.
		// So the parameters come apart from this call's arguments rather than from the ones recorded
		// against the name written there, which was `undefined`.
		name: 'a snippet reached through a declaration, called with arguments',
		source:
			'<script>let { data } = $props(); const first = true;' +
			' const held = first ? one : two;</script>' +
			'{#snippet one({ n })}<p>one {n}</p>{/snippet}{#snippet two({ n })}<p>two {n}</p>{/snippet}' +
			'{@render held({ n: data.a })}',
		data: [{ a: 'x' }, { a: '<&' }],
	},
	{
		// `ConstTag.js` is one visitor for every shape: a destructuring, a default inside it, one
		// const reading another, one reading two parameters, and one inside an each inside the
		// snippet, all scoped to the block they sit in.
		name: 'const shapes inside a snippet with parameters',
		source:
			`${PROPS}{#snippet row(v, n = 1)}{@const { a, b = 'd' } = v}{@const sum = a.length + n}` +
			'{@const [first] = a}<i>{a}{b}{sum}{first}</i>' +
			'{#each v.xs as x}{@const y = x + n}<u>{y}</u>{/each}{/snippet}' +
			'{@render row(data.v)}{@render row(data.w, 2)}',
		data: [
			{ v: { a: 'ab', xs: [1, 2] }, w: { a: 'c', b: 'B', xs: [] } },
			{ v: { a: '', xs: [] }, w: { a: 'x<', b: null, xs: [3] } },
		],
	},
	{
		// Recursion in structure: the body is fixed and the depth is the data's. A snippet that
		// renders itself is a fragment the runtime calls, its parameters bound per call the way an
		// each's item is per iteration; the call inside the body is a call of the same fragment,
		// and the render tag around it writes what Svelte writes around any. Measured against
		// Svelte's own recursion, which compiles the snippet to a function calling itself.
		name: 'a snippet that renders itself',
		source:
			`${PROPS}{#snippet h(node, depth = 0)}<li class="d{depth}">{node.label}` +
			'{#each node.children ?? [] as child}<ul>{@render h(child, depth + 1)}</ul>{/each}</li>{/snippet}' +
			'<ul>{@render h(data.tree)}</ul><ol>{@render h(data.other, 5)}</ol>',
		data: [
			{
				tree: {
					label: 'a',
					children: [
						{ label: 'b', children: [] },
						{ label: 'c', children: [{ label: 'd' }] },
					],
				},
				other: { label: 'x' },
			},
			{ tree: { label: '<', children: [] }, other: { label: 'y', children: [{ label: 'z' }] } },
		],
	},
	{
		// A recursive body that opens with text, which `is_text_first` in `Fragment.js` writes an
		// empty comment ahead of, and a second outer call of the same fragment.
		name: 'a snippet that renders itself, opening with text',
		source:
			`${PROPS}{#snippet t(n)}{n.v}{#each n.kids ?? [] as k}<i>{@render t(k)}</i>{/each}{/snippet}` +
			'<div>{@render t(data.t)}</div><p>{@render t(data.u)}</p>',
		data: [
			{ t: { v: 'a', kids: [{ v: 'b' }, { v: 'c', kids: [{ v: 'd' }] }] }, u: { v: 'x' } },
			{ t: { v: '<' }, u: { v: 'y', kids: [{ v: '&' }] } },
		],
	},
	{
		// A parameter that is a pattern binds the names inside it, each reached from the argument
		// the way a destructured declaration is, and a default inside the pattern is taken per
		// call by the runtime -- the render is handed an empty object and takes nothing from it.
		name: 'a snippet that renders itself and takes a pattern',
		source:
			`${PROPS}<ul>{@render row(data.tree)}</ul>` +
			'{#snippet row({ label, children = [] })}<li>{label}{#each children as child}<ul>{@render row(child)}</ul>{/each}</li>{/snippet}',
		data: [
			{
				tree: {
					label: 'a',
					children: [{ label: 'b' }, { label: 'c', children: [{ label: 'd' }] }],
				},
			},
			{ tree: { label: '<' } },
		],
	},
	{
		// Every way in a pattern has that is not a member, read out of Svelte's own `_extract_paths`:
		// a key written as a literal or computed is an index, a nesting is one way in after another,
		// and a rest is a call -- `exclude_from_object` for an object, `to_array().slice()` for an
		// array. A computed key reads a name the same pattern bound before it, which is the order
		// JavaScript binds one in. The pattern stays in the render over a placeholder, so nothing in
		// it may evaluate: the nestings become names and the computed keys `undefined`.
		name: 'a const and a snippet parameter taken apart every way a pattern offers',
		source:
			`${PROPS}{#snippet row({ 'a-b': ab, [ab ?? 'k']: picked, n: { deep }, xs: [first, ...more], ...rest })}` +
			'{@const { 0: zero, [zero]: byZero, q: { r }, ...left } = rest}' +
			'{@const [head, ...[next, ...tail]] = more}' +
			'<i>{ab}|{picked}|{deep}|{first}|{more.join(",")}|{JSON.stringify(rest)}</i>' +
			'<u>{zero}|{byZero}|{r}|{JSON.stringify(left)}|{head}|{next}|{tail.length}</u>{/snippet}' +
			'{@render row(data.v)}',
		data: [
			{
				v: {
					'a-b': 'k',
					k: 'picked',
					n: { deep: 'D' },
					xs: [1, 2, 3, 4],
					0: 'q',
					q: { r: 'R' },
					z: '<',
				},
			},
			{ v: { 'a-b': 'z', n: {}, xs: [], q: {} } },
		],
	},
	{
		// The pattern defaulted whole, `({ ... } = {})`: the default wraps the argument first, taken
		// where it is `undefined`, and the pattern inside then takes that apart. The first call is
		// handed nothing, so the default is what it destructures.
		name: 'a snippet that renders itself and takes a pattern defaulted whole',
		source:
			`${PROPS}<ul>{@render row(data.tree)}</ul>` +
			'{#snippet row({ label = "root", children = [] } = {})}<li>{label}{#each children as child}<ul>{@render row(child)}</ul>{/each}</li>{/snippet}',
		data: [
			{ tree: { label: 'a', children: [{ label: 'b' }, { children: [{ label: 'd' }] }] } },
			{},
		],
	},
	{
		// A `{@render}`'s callee is an expression, not always a name. It is settled the way a
		// `<svelte:component this={...}>` is, and what substitution leaves is then folded: a ternary
		// whose test has become a literal, and a read off an object literal. Where that reaches a
		// snippet this file declares, that is the one rendered, and the callee is written out as its
		// name so the render calls it too.
		name: 'a render whose callee reaches a snippet through a value',
		source:
			'<script>let { data } = $props(); const held = { one: first };' +
			' const which = true ? second : first;</script>' +
			'{@render held.one()}{@render which()}<p>{data.a}</p>' +
			'{#snippet first()}<b>1</b>{/snippet}{#snippet second()}<i>2</i>{/snippet}',
		data: [{ a: 'x' }, { a: '<' }],
	},
];
