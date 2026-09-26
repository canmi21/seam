/**
 * What the compiler refuses, and what each refusal has to say. Each one is a gap rather than a boundary.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const refused: Case[] = [
	{
		// The same raw snippet with the component handed what the request decides: that render is the
		// request's, and a derivation renders nothing.
		name: 'a raw snippet embedding a render over the request',
		beside: { Kid: '<script>let { n } = $props();</script><b>{n}</b>' },
		source:
			"<script>import { createRawSnippet } from 'svelte'; import { render } from 'svelte/server';" +
			" import Kid from './Kid.svelte'; let { data } = $props();" +
			' const hello = createRawSnippet(() => ({ render: () => `<div>${render(Kid, { props: { n: data.n } }).body}</div>` }));</script>' +
			'{@render hello()}',
		data: [{ n: 1 }],
		says: 'renders a component over what the request decides',
	},
	{
		// The other half of letting a component import resolve. The name is legal and the staged
		// copy keeps the import, so a component handed to a child is a value the build has; what
		// the bundle cannot hold is the same name, because `carriedBy()` skips a component and a
		// derivation is evaluated with the bundle and nothing else. So the shape to refuse is a
		// component reaching an expression the artifact holds, and it is asked over the finished
		// list rather than at the name. See `composed()` in skeleton.ts.
		name: 'a component read by an expression the request decides',
		beside: { Foo: '<p>foo</p>' },
		source:
			"<script>import Foo from './Foo.svelte'; let { data } = $props();</script>" +
			'<p>{data.a + Foo.name}</p>',
		data: [{ a: 'x' }, { a: '' }],
		says: 'is a component read by an expression this artifact holds',
	},
	{
		// Where the object itself is what the request decides there is nothing to put a marker
		// inside: its keys cannot be listed, so no object can stand in it while the bytes are
		// written. Refused by name rather than written wrong.
		name: 'a spread on a component the walk could not enter, over a value the request decides',
		beside: {
			Gate:
				'<script>let { a } = $props(); let c = a; const set = () => { c = "s"; return ""; };</script>' +
				'{set()}<b>{c}{a}</b>',
		},
		source:
			"<script>import Gate from './Gate.svelte'; let { data } = $props();</script>" +
			'<Gate {...data.o} />',
		says: 'its keys cannot be listed',
	},
	{
		// The object a caller passed is rebuilt wherever it is read -- the entry's out of the
		// payload, a child's out of what its call site wrote -- so a write into it is lost:
		// measured, `$: $$restProps.c = 'c'` beside `{$$restProps.c}` wrote nothing where Svelte
		// wrote `c`. The script run does not answer it either, since a read of the object is written
		// out as Svelte's own helper rather than as a name the run could hand back.
		name: 'a script that writes into the props object',
		says: 'the object a caller passed is rebuilt',
		source:
			"<script>export let a; $: $$restProps.c = $$restProps.c ?? 'c';</script>" +
			'<p>{a}{$$restProps.c}</p>',
	},
	{
		// A component's `<script module>` is module state too, reached by a named import. This render
		// calls into it -- `bump()` as the script runs -- so the value depends on calls made while the
		// bytes are written, in their order, which a derivation reading the module does not keep.
		name: 'a name a component`s module script changes',
		says: 'read beside a call into that module',
		beside: {
			Held: '<script module>export let n = 0; export function bump() { n += 1 }</script><i>h</i>',
		},
		source:
			"<script>import { n, bump } from './Held.svelte'; let { data } = $props(); bump();" +
			'</script><p>{n}|{data.a}</p>',
	},
	{
		// The same from the markup: `{mark(r)}` changes what `{seen.length}` reads, per item.
		name: 'a read of module state something in that module changes',
		says: 'read beside a call into that module',
		alongside: {
			'held.js':
				'export const seen = [];\nexport function mark(x) { seen.push(x); return seen.length; }\n',
		},
		source:
			"<script>import { mark, seen } from './held.js'; let { data } = $props();</script>" +
			'{#each data.rows as r}<b>{mark(r)}:{seen.length}</b>{/each}',
	},
	{
		// `export { x }` is a prop only where `x` is a plain `let` or `var`: over a `const` it is a
		// readonly export, and over a destructuring it binds a name whose value comes out of a
		// pattern rather than from an initialiser this can read as the default.
		name: 'an `export { }` naming something a pattern binds',
		says: 'a pattern binds',
		source: '<script>let { a, b } = { a: 1, b: 2 }; export { a };</script><p>{a}{b}</p>',
	},
	{
		// The other side of it. `$.bind_props` assigns the child's value up where the caller passed
		// `undefined` and the caller's props object has a setter for the key, and
		// `transform-server.js` then renders the caller's whole template again from a fresh renderer
		// copy. Whether that happens turns on whether the request sent the value, so it is a
		// structure rather than something a marker can stand for. It used to compile, keep the first
		// pass and say nothing.
		name: 'a component `bind:` the child sends a default back through',
		says: 'sends back',
		beside: { Kid: '<script>export let v = "d";</script><b>{v}</b>' },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<Kid bind:v={data.a} /><i>{data.a}</i>',
	},
	{
		// A marker may stand where a value is written and never where it decides which bytes exist.
		// The child cannot be entered -- `<slot>` -- so the value goes to it as a marker, and the
		// child branches on it. Every marker is a non-empty string, so the branch was taken, the
		// whole component came back as static bytes with no block in it, and nothing said so. It
		// agreed with Svelte for as long as the payload made that branch the right one.
		// Measured on `runtime-legacy/component-yield-nested-if`, which passed this way.
		name: 'a value a child the walk cannot enter branches on',
		says: 'did not come back',
		// The child is one the walk cannot enter -- its markup calls a function that changes a name
		// the markup then reads, which no script run sees -- and it branches on what it was handed.
		beside: {
			Gate:
				"<script>let { on } = $props(); let t = on; const flip = () => { t = !!on; return ''; };</script>" +
				'{flip()}{#if t}<b>shown</b>{/if}',
		},
		source:
			"<script>import Gate from './Gate.svelte'; let { data } = $props();</script>" +
			'<Gate on={data.on} />',
	},
	{
		// Async Svelte awaits a real promise per request while the bytes are written, which is
		// loading data: the load stage's, by definition. See spec/roadmap.md.
		name: 'an await in markup',
		source: `${PROPS}<p>{await data.p}</p>`,
		says: 'async Svelte',
	},
	{
		// The entry's `page` from `$app/state` is the payload's `page`, under that name: a child's
		// rename is bound at its call, and the entry has no call to bind it at. See spec/framework.md.
		name: 'page imported under another name in the entry',
		source: `<script>import { page as here } from '$app/state'; ${PROPS.slice('<script>'.length)}<a href={here.url.pathname}>{data.t}</a>`,
		says: 'payload',
	},
	{
		// A fragment's head is read off its own component before the body is walked, because the
		// calls inside the body are written then. One a component inside the body writes is found
		// after. See `headedFragment()` in stamps.ts.
		name: 'a snippet that renders itself around a headed component',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /></svelte:head><i>{t}</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script><ul>{@render row(data.tree)}</ul>" +
			'{#snippet row(node)}<li><Kid t={node.label} />{#each node.children ?? [] as child}<ul>{@render row(child)}</ul>{/each}</li>{/snippet}',
		says: 'head stream',
	},
	{
		// Inside a table the stamp has to be an element, because text is refused there, and an
		// element is the sibling the case above is about. No carrier avoids it -- text and an
		// `<option>` are both refused outright -- so the one combination that would write wrong
		// bytes is named instead. Measured: two `<tr>`s related by `+`, with a block between them,
		// both silently lost their scoping class.
		name: 'a block inside a table whose stylesheet relates siblings',
		source:
			`${PROPS}<table><tbody>{#each data.rows as r}<tr class="x"><td>{r}</td></tr>{/each}` +
			'<tr class="y"><td>last</td></tr></tbody></table><style>.x + .y { color: red }</style>',
		says: 'scoping class',
	},
	{
		// Svelte's scope cannot prove a prop defined, so it writes `if (p) { pending } else {
		// children }`: a choice per request over a snippet that arrived as a value.
		name: 'a boundary given its pending snippet from a prop',
		source:
			'<script>let { data, p } = $props();</script>' +
			'<svelte:boundary pending={p}><p>{data.a}</p></svelte:boundary>',
		says: 'nullish',
	},
	{
		// Written inside a component's tag, so it is a prop that component receives. The child calls
		// it, and with what is not visible from here. One with no parameters has nothing to decide,
		// and that one works -- it is what `{@render children()}` is.
		name: 'a snippet passed to a component, with parameters',
		source: `${PROPS}<b>{data.a}</b>{#snippet row(r)}<i>{r}</i>{/snippet}`,
	},
	{
		// Two values given away, one never written and one written after being computed with. Asked
		// together the only answer is that something reaches the bytes, which says nothing about
		// which -- so the live one kept the dead one refused beside it and the message named
		// whichever came first. Asked one at a time after that, the message names the one that is
		// actually a fault.
		// A child that assigns after declaring is what keeps the walk out of it; entered, the same
		// child compiles, which the accepted case with the same name says. It used to be a
		// `{#snippet}` inside the tag, and that stopped being a way out when a snippet written there
		// became a group like any other -- the second time this case has had to find one, and the
		// reason to pick a rule that does not move.
		name: 'one value a child eats and one it never writes',
		says: '`eaten`',
		beside: {
			Eats:
				'<script>let { eaten, ignored, ...rest } = $props(); let open = false;' +
				" const opened = () => { open = true; return ''; };</script>" +
				'{opened()}<b>{eaten.toUpperCase()}</b>{#if open}<i>{ignored}</i>{/if}',
		},
		source:
			"<script>import Eats from './Eats.svelte'; let { data } = $props();</script>" +
			'<Eats ignored={data.b} eaten={data.a} />',
	},
	{
		// The other side of what a component may supply. A parameter only ever rendered is markup
		// the component writes, and needs nothing put in its place; one read as a value does, and
		// there is nothing to put there -- bits-ui's `{#snippet children({ checked })}` is this,
		// with `checked` decided by a state machine inside the package. Refused only because the
		// child writes the body, which the probe says; the same snippet given to a child that
		// never calls it compiles, above.
		name: 'a snippet a component supplies a value to, not markup',
		says: 'reads one of them as a value',
		beside: {
			Feeds:
				'<script>let { row, ...rest } = $props(); let n = 1; n = 2;</script>' +
				'<p>{@render row?.(n)}</p>',
		},
		source:
			"<script>import Feeds from './Feeds.svelte'; let { data } = $props();</script>" +
			'<Feeds>{#snippet row(n)}<i class={n > 0 ? "up" : "down"}>{data.a}</i>{/snippet}</Feeds>',
	},
	{
		name: 'a render of a snippet from a prop',
		source: `${PROPS}<div>{@render data.children()}</div>`,
	},
	{
		// The same thing under the name everybody writes it with, which used to reach Svelte's
		// renderer and fail there with `children is not a function`. The case above passed for a
		// reason that did not generalise: `data.children` is a member, so the callee had no name at
		// all, and only the nameless half was refused. A bare `children` did have a name -- the one
		// its own `{@render}` had just put in the table -- and looked declared. See spec/refusals.md.
		name: 'a render of children, which is a snippet from a prop',
		source: `${PROPS}<div>{@render children()}</div>`,
	},
	{
		// The whole pass plants a marker, renders, and reads it out of the bytes. A component
		// writing that shape as literal markup puts something in the output nothing can tell from
		// a marker: measured, a `<p>` holding the text and a `<p>` holding a value came out with
		// their contents swapped, and nothing said so.
		name: 'markup that writes the shape of a marker',
		says: 'literal markup',
		source: `${PROPS}<p>%%s0%% here</p><p>{data.a}</p>`,
	},
	{
		// A derivation is evaluated outside `render()`, and `getContext` asks the component being
		// rendered. Handed to the render the read is fine, which is the ordinary case; as a marker
		// it has nowhere to come from, and it reached the evaluator and threw there.
		name: 'a context read in a value the request decides',
		says: 'a context read in a value this compiler has to write itself',
		source:
			"<script>import { getContext } from 'svelte'; let { data } = $props();</script>" +
			'<b>{getContext(data.k)}</b>',
	},
	{
		// The body of an each is written once and every item renders those bytes, so a tag naming the
		// item is expressible where the item is the same component throughout and not otherwise. Two
		// components in the list would want the body written once each, which is the block unrolled
		// rather than the block.
		name: 'a component tag named by an each block over two components',
		says: 'decided per item',
		beside: {
			Tip: '<span>tip</span>',
			Tap: '<span>tap</span>',
			Reg:
				"<script module>import Tip from './Tip.svelte'; import Tap from './Tap.svelte';" +
				' export const One = { Tip }; export const Two = { Tap };</script>',
		},
		source:
			"<script>import { One, Two } from './Reg.svelte'; let { data } = $props();" +
			' const list = [One, Two];</script>{#each list as R}<R.Tip />{/each}<i>{data.a}</i>',
	},
	{
		// `declared: false` says only that no `{#snippet}` of that name is written here, and the
		// record exists because a render was seen. It does not say the name came from the call site,
		// and the refusal used to say it did -- untrue about a file that binds the name itself.
		name: 'a render tag whose callee this file binds and nothing can follow to a snippet',
		says: 'names no `{#snippet}` this compiler can follow it to',
		source:
			"<script>import { writable } from 'svelte/store'; let { data } = $props();" +
			' const held = writable(one);</script>' +
			'{#snippet one()}<b>{data.a}</b>{/snippet}{@render $held()}',
	},
	{
		// A rune is compiled away by Svelte and is not a function anything can call. The ones whose
		// answer the server writes are written out -- `ANSWERED` in `reactive.ts` -- and a `$derived`
		// class field is read as the getter `ClassBody.js` makes of it. A field whose key is computed
		// is neither: `get_name` cannot name it, so this pass leaves it as written and the rune is
		// still there.
		name: 'a rune left in a value the request decides',
		says: 'is left in a value this compiler has to write itself',
		source:
			"<script>let { data } = $props(); const k = 'twice';" +
			' class T { n = 1; [k] = $derived(this.n * 2); }' +
			' const t = new T();</script><p>{t[k] + data.a}</p>',
	},
	{
		// `setContext(k, v)` runs while the bytes are written and a descendant's `getContext(k)`
		// reads it. Neither name is one the request decides, so the read looks inert and was handed
		// to the render -- which holds the literal standing in for the value, not the request's.
		// It rendered empty where Svelte wrote the value, with nothing to say so.
		name: 'a context read where the context was set from a prop',
		says: 'a context read where a `setContext`',
		beside: {
			Kid: "<script>import { getContext } from 'svelte'; const held = getContext('k');</script><b>{held.v}</b>",
		},
		source:
			"<script>import { setContext } from 'svelte'; import Kid from './Kid.svelte';" +
			" let { data } = $props(); setContext('k', { v: data.v });</script><Kid />",
	},
	{
		// The other reading of a marker that does not come back, and the one that is a fault: the
		// component wrote something it computed from the value rather than the value. Rendering
		// again with a different one in its place changes the bytes, which is what says so -- and
		// what keeps the relaxation beside this from covering it.
		name: 'a value a child is given and transforms',
		beside: {
			Chews:
				"<script>let { tag, ...rest } = $props(); let n = 1; const two = () => { n = 2; return ''; };</script>" +
				'<i>{two()}{tag.toUpperCase()}{n}</i>',
		},
		source:
			"<script>import Chews from './Chews.svelte'; let { data } = $props();</script>" +
			'<Chews tag={data.a} />',
	},
];
