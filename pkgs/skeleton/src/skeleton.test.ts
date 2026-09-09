// The refusal surface, measured rather than remembered.
//
// `spec/refusals.md` used to carry a table of what the compiler turns away. It was maintained by
// recollection and it was wrong in both directions at once: it listed an each block with a key and
// `{:else}` on an each as unwritten when both compiled, and it did not mention `{@const}` at all,
// which compiled and rendered the wrong bytes. This file is that table, produced by running the
// compiler, so it cannot drift from what the compiler does.
//
// Two rules it enforces, both of them the specification's own:
//
// **An accepted construct has to agree with Svelte, on every payload.** Not on one. `{:else}` on
// an each looked correct against a list with something in it, because the branch it turns on only
// appears when the list is empty. Every case here carries the payload its shape turns on.
//
// **A refusal has to say where the question lives.** `spec/refusals.md` says a refusal owes the
// reader what it is and where it is recorded; a message that names no specification file has told
// the author their code is wrong and nothing else.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { compile, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carriedBy, carry } from 'carry';
import { joined } from 'compiler';
import { compile as compileDerivations, type Derivation } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { expressionsOf, helpers, skeleton } from './skeleton.ts';

// Its own directory: `skeleton()` stages Svelte's compiled output in `../.build` and removes it
// when it is done, which would take this with it halfway through a case.
const staging = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-surface');
const PROPS = '<script>let { data } = $props()</script>';

interface Case {
	name: string;
	source: string;
	/**
	 * The payloads the shape turns on. An each block needs an empty list as well as a full one, an
	 * if needs both branches: a construct only has to be wrong on the payload nobody tried.
	 */
	data?: unknown[];
	/**
	 * Whole props objects, where the case is about a prop that is not `data`.
	 *
	 * `data` above is the usual shape and covers the payload a route has. A default on one of the
	 * entry's own props needs the other half as well -- the request that leaves the prop out and the
	 * one that sends it -- and neither is expressible as a value of `data`, since `data` is always
	 * passed. Given, these are the payloads instead of `data`'s.
	 */
	props?: Record<string, unknown>[];
	/** Sibling files the case imports, by name without the extension. Composition needs two. */
	beside?: Record<string, string>;
	/** Sibling files that are not components, written as named. What a derivation may call. */
	alongside?: Record<string, string>;
	/** Files under the case's own `node_modules`, by path there: a package the case imports. */
	installed?: Record<string, string>;
	/**
	 * Payload paths this render is fixed at, as literal source text. The payloads below have to
	 * agree with them, since the oracle is given the whole of the data and renders what it says.
	 */
	fixed?: Record<string, string>;
	/**
	 * What the refusal has to say, where saying the right thing is the point of the case.
	 *
	 * Most refusals are checked only for existing, because the message is prose and pinning prose
	 * makes a test that fails when somebody improves it. This is for the ones where *which* thing
	 * the message names is the behaviour under test.
	 */
	says?: string;
}

const accepted: Case[] = [
	{
		name: 'a value, a branch and a list',
		source: `${PROPS}<p>{data.a}</p>{#if data.f}<b>{data.a}</b>{/if}{#each data.xs as x}<i>{x}</i>{/each}`,
		data: [
			{ a: 'v', f: true, xs: ['q', 'r'] },
			{ a: '<&"', f: false, xs: [] },
		],
	},
	{
		// `{n}` is `n={n}`, and the braces of the short form hold a bare name and nothing else. The
		// marker that goes there is not one, so this used to stop inside Svelte's parser with
		// `attribute_empty_shorthand` -- an error about the author's own file, saying something
		// untrue about it. See spec/refusals.md.
		name: 'a shorthand attribute',
		source:
			'<script>let { data } = $props(); const n = data.a; const cls = data.b</script>' +
			'<b {n} class={cls}>x</b>',
		data: [
			{ a: 'v', b: 'c' },
			{ a: '', b: null },
		],
	},
	{
		// Every branch of `to_class`, which is what a `class:` compiles to. The payloads matter more
		// here than anywhere else: a directive that is falsy does not leave the class alone, it
		// removes its own name from it, and `on` below is in the static class on purpose. When
		// everything cancels there is no class attribute at all, which is the second payload.
		name: 'a class directive, both ways',
		source: `${PROPS}<p class="on" class:on={data.f}>x</p>`,
		data: [{ f: true }, { f: false }, { f: 0 }, { f: 'yes' }],
	},
	{
		// No class attribute to work with. Svelte's analysis invents an empty one and puts it after
		// every attribute that was written, so this also pins where it lands.
		name: 'a class directive with no class attribute',
		source: `${PROPS}<p id="i" class:on={data.f}>x</p>`,
		data: [{ f: true }, { f: false }],
	},
	{
		name: 'two class directives on one element',
		source: `${PROPS}<p class="a" class:on={data.f} class:off={data.g}>x</p>`,
		data: [
			{ f: true, g: true },
			{ f: true, g: false },
			{ f: false, g: true },
			{ f: false, g: false },
		],
	},
	{
		// The scoping hash is written inside the class attribute, between the value and the
		// directives, so a decision over the attribute has to carry it. It is read off the render
		// rather than reproduced: three places that hash a filename is two too many.
		name: 'a class directive in a scoped component',
		source: `${PROPS}<p class="a" class:on={data.f}>x</p><style>.a{color:red}</style>`,
		data: [{ f: true }, { f: false }],
	},
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
		// `$props()` destructures, so a default is taken where the property is `undefined` and the
		// question is about the payload rather than about what the name resolves to. Written as
		// `typeof Math === 'undefined'` it found the global and never took the default.
		name: 'a prop default whose name a global already has',
		source:
			'<script>let { data, Math = { min: () => "potato" } } = $props();</script>' +
			'<p>{Math.min(data.x, 5)}</p>',
		data: [{ x: 10 }],
	},
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
		// Nothing is written for the value, and Svelte writes `void 0` there:
		// `args.length > 0 ? visit(args[0]) : b.void0`. So the name holds `undefined` while the
		// bytes are written, which is what a piece of client state looks like before the client has
		// it. The markup used to be told the name had to come from the props.
		name: 'state with no initial value',
		source:
			'<script>let { data } = $props(); let t = $state()</script>' +
			'{#if t}<b>y</b>{:else}<i>{data.a}</i>{/if}',
		data: [{ a: 'v' }],
	},
	{
		// The whole of what a client-only component looks like on the server: state with no value,
		// a handler that would set it, and markup that branches on it. Svelte renders the branch
		// for the value it has, which is none, and the client takes over from there.
		name: 'state a handler assigns, read in the markup',
		source:
			'<script>let { data } = $props(); let open = $state(); function show() { open = true }</script>' +
			'<button onclick={show}>{#if open}<b>{data.a}</b>{:else}<i>closed</i>{/if}</button>',
		data: [{ a: 'v' }],
	},
	{
		name: 'a let with no initial value',
		source: '<script>let { data } = $props(); let t</script><p>{t}</p><p>{data.a}</p>',
		data: [{ a: 'v' }],
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
		// The one entry in Svelte's replacement table: `true` is `"yes"` and `false` is `"no"`,
		// because `translate="false"` means yes. A literal is folded by Svelte in the render, and a
		// value decided per request goes through the injector's copy of the table.
		name: 'translate',
		source: `${PROPS}<p translate={data.f}>{data.a}</p><i translate={true}>x</i><u translate="no">y</u>`,
		data: [
			{ f: true, a: 'x' },
			{ f: false, a: 'x' },
			{ f: 'yes', a: 'x' },
			{ f: null, a: 'x' },
		],
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
		// Text beside an expression is one value, joined the way `build_attribute_value` joins it:
		// a template with `$.stringify` around each expression, so null writes nothing and the
		// declaration `width: px;` is still written.
		name: 'style directives mixing text and expressions',
		source: `${PROPS}<p style:width="{data.a}px" style:color="{data.c}">x</p>`,
		data: [
			{ a: 10, c: 'red' },
			{ a: null, c: '' },
			{ a: 0, c: 'blue' },
		],
	},
	{
		// The renderer drops the select's value and writes ` selected=""` on the option that matches
		// it: `===` against the option's own value -- its attribute, or the one expression that is
		// its content, or its text -- and `includes` where the select is `multiple` and the value an
		// array. A bound value reads the same way. See spec/refusals.md.
		name: 'a select with a value',
		source:
			'<script>let { data } = $props(); let s = $state(data.s)</script>' +
			'<select value={data.s}><option value="a">A</option><option>b</option>' +
			'<option value={data.o}>{data.o}</option>{#each data.xs as x}<option value={x}>{x}</option>{/each}</select>' +
			'<select multiple value={data.m}><option value="a">A</option><option value="b">B</option></select>' +
			'<select bind:value={s}><option>{data.n}</option><option value="1">one</option></select>',
		data: [
			{ s: 'a', o: 'o', xs: ['x', 'y'], m: ['a', 'b'], n: 1 },
			{ s: 'y', o: 'y', xs: ['y'], m: 'b', n: 2 },
			{ s: 1, o: 'o', xs: [], m: [], n: 1 },
			{ s: null, o: null, xs: ['x'], m: null, n: null },
		],
	},
	{
		// Two of them and no `style` attribute, which is the shape that could not be independent
		// declarations: the result is trimmed, so whichever is present first loses its leading
		// space. Enumerated instead, each outcome built by calling `attr_style`, and each carrying
		// markers of its own so a value in half the outcomes is a hole consumed once.
		name: 'two style directives',
		source: `${PROPS}<span style:width={data.w} style:margin-top={data.m}></span>`,
		data: [
			{ w: '1px', m: '2px' },
			{ w: null, m: '2px' },
			{ w: '1px', m: null },
			{ w: null, m: null },
			// Neither is truthy and both are written: `to_style` asks whether the value is null or
			// the empty string, not whether it is falsy.
			{ w: 0, m: '' },
		],
	},
	{
		// A `style` attribute beside a directive is not passed through: the attribute is
		// reassembled, so this one is re-parsed and re-emitted, and `width` disappears out of it
		// because a directive names it.
		name: 'a style directive beside a style attribute',
		source: `${PROPS}<span style="width:9px;color:red" style:width={data.w}></span>`,
		data: [{ w: '1px' }, { w: null }],
	},
	{
		name: 'an important style directive, and a written one',
		source: `${PROPS}<span style:color="red" style:width|important={data.w}></span>`,
		data: [{ w: '1px' }, { w: null }],
	},
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
		name: 'a block on each side of the boundary',
		beside: {
			Half:
				'<script>let { children, f } = $props();</script>' +
				'{#if f}<div>{@render children()}</div>{:else}<p>n</p>{/if}',
		},
		source:
			"<script>import Half from './Half.svelte'; let { data } = $props();</script>" +
			'<Half f={data.f}>{#each data.xs as x}<i>{x}</i>{/each}</Half>',
		data: [
			{ f: true, xs: ['p', 'q'] },
			{ f: false, xs: [] },
			{ f: true, xs: [] },
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
		// The stamp that says which block just closed is a sibling of the author's own markup, and
		// Svelte's CSS analysis walks siblings: `get_possible_element_siblings` stops at the first
		// element it meets, so a `<template>` between two of them made `.a + .b` stop matching and
		// **both lost their scoping class**. Bare text is not an element and the walk steps over it,
		// which is why it is the carrier wherever text is writable. A `@keyframes` rule is here
		// because it scopes every element in the component, which puts a class on a `<template>`
		// carrier and is what the assembler has to read past. See `carrier()`.
		name: 'a stamp beside markup the stylesheet relates',
		source:
			`${PROPS}<div>{#if data.f}<i class="a">{data.a}</i>{/if}<b class="b">y</b></div>` +
			'<style>.a + .b { color: red }</style>',
		data: [
			{ f: true, a: 'x' },
			{ f: false, a: '<&' },
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
		// A shorthand property is one node standing as both key and value, so substituting it in
		// place takes the key with it and leaves `{ (data.n) }`, which is not JavaScript. The third
		// time this shape has come up: an attribute's `{n}` and a `{@const}` were the others. It is
		// how a locale reaches a message -- `m['x']({}, { locale })` -- so every translated string
		// in a real page went through it.
		name: 'an object shorthand whose value is substituted',
		source:
			'<script>let { data } = $props(); const n = data.n;</script>' +
			'<p>{Object.values({ n })[0]}</p><b>{Object.keys({ n }).join()}</b>',
		data: [{ n: 'v' }, { n: '<&' }],
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
		// A literal handed down through a component the walk entered. Every prop is handed to the
		// render as null, because the child's markers already carry the expressions and evaluating
		// what the call site passed would reach for data the render is not given -- but a literal
		// is not data, it reads nothing, and an expression over it is inert and left for Svelte.
		// Handed null it evaluated against nothing; the value the call site passed is carried now.
		name: 'a literal prop read by markup left for Svelte to evaluate',
		beside: {
			Tells:
				'<script>let { tag, ...rest } = $props();</script>' +
				"{#if tag === 'warm-x'}<i>warm</i>{:else}<i>{tag}</i>{/if}",
			Carries:
				"<script>import Tells from './Tells.svelte'; let { tone, data } = $props();</script>" +
				`<Tells tag={[tone, 'x'].join('-')} /><p>{data.a}</p>`,
		},
		source:
			"<script>import Carries from './Carries.svelte'; let { data } = $props();" +
			" const tone = 'warm';</script>" +
			'<Carries {tone} {data} />',
		data: [{ a: 'v' }, { a: '<&' }],
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
		// `element()` writes an empty comment, then the tag and its attributes, then the children,
		// another empty comment and a closing tag unless the tag is void, then a third. The
		// attributes and the children are the bytes a written element would produce, because the
		// namespace and the case rules are read off the node rather than off the value -- so the
		// render is given a stand-in tag and only what the tag decides is left to the request.
		name: 'svelte:element',
		source: `${PROPS}<svelte:element this={data.tag} id={data.i}>x{data.a}</svelte:element>`,
		data: [
			{ tag: 'h2', i: 'q', a: 'A' },
			// Void: no children and no closing tag.
			{ tag: 'br', i: 'q', a: 'A' },
			// Raw text: children, and no empty comment before the closing tag.
			{ tag: 'title', i: 'q', a: 'A' },
			// Nothing at all between the two comments.
			{ tag: null, i: 'q', a: 'A' },
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
		// An element carrying a spread does not write its attributes one at a time: every attribute
		// and every spread on it are merged into one object and handed to `$.attributes`, which
		// walks the object's keys at request time. Which keys those are is the only thing that
		// cannot be known here, so the marker stands for the whole run and the expression behind it
		// is that same call -- with the object rebuilt from the source and every other argument
		// taken verbatim from what Svelte compiled.
		name: 'a spread on an element',
		source: `${PROPS}<div {...data.r} id={data.i}>x{data.t}</div>`,
		data: [
			{ r: { a: '1', title: 'T' }, i: 'q', t: 'T' },
			{ r: {}, i: null, t: '' },
			// Escaping, a boolean name, a function and a key the writer skips, all Svelte's rules.
			{ r: { 'data-x': '<&"', hidden: true, onclick: () => {}, $$weird: 1 }, i: 'z', t: 'U' },
		],
	},
	{
		// The flags an element decides: an input maps `defaultValue`, a custom element keeps the
		// case of its attribute names. Neither is worked out here; both come out of the call.
		name: 'a spread on an input and on a custom element',
		source: `${PROPS}<input {...data.r} /><my-el {...data.r}>x</my-el>`,
		data: [{ r: { defaultValue: 'd', dataFoo: 'v' } }, { r: { value: 'v', disabled: true } }],
	},
	{
		name: 'raw html',
		source: `${PROPS}<p>{@html data.a}</p>`,
		data: [{ a: '<b>x</b>' }, { a: '' }],
	},
	{
		name: 'the head and a title',
		source: `${PROPS}<svelte:head><meta name="d" content={data.a} /><title>{data.a}</title></svelte:head><p>x</p>`,
		data: [{ a: 'v' }, { a: null }],
	},
	{
		// The scoped class is a hash of the filename relative to `rootDir`, so this also pins that
		// the render pass passes one. What it does not pin is that the client build passes the same
		// one; that is `pkgs/plugin`, where the two halves are held against each other.
		name: 'a scoped style',
		source: `${PROPS}<p class="x">{data.a}</p><style>.x{color:red}</style>`,
		data: [{ a: 'v' }],
	},
	{
		// On the server there is no reactivity, so a rune is a declaration whose value is its
		// argument -- Svelte's own server transform says so in a line, and these hold that against
		// its output rather than against the reading of it. See spec/derivation.md.
		name: 'runes read from markup',
		source:
			'<script>let { data } = $props(); let n = $state(0); let t = $derived(data.a + "!"); ' +
			'let u = $derived.by(() => data.a.length); $effect(() => { n = 9 })</script>' +
			'<p>{n}/{t}/{u}</p>',
		data: [{ a: 'v' }, { a: '' }],
	},
	{
		// The refusal for a name assigned after it is declared must not reach a handler: one does not
		// run while the bytes are written, so the initialiser is still what the name holds. Held to
		// Svelte's own output rather than to that reasoning.
		name: 'a handler that assigns to a declared name',
		source:
			'<script>let { data } = $props(); let n = 0; function buy() { n += 1 }</script>' +
			'<button onclick={buy}>{data.a}{n}</button><b onclick={() => { n += 1 }}>{n}</b>',
		data: [{ a: 'v' }],
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
		// A `{@const}` is hoisted out of the fragment by `clean_nodes` and its visitor pushes it into
		// the block's `init`, ahead of the template, so it binds for the whole fragment however late
		// in it it was written. In legacy mode `sort_const_tags` then puts them in topological order,
		// so one may read another written below it. Red without either: `bar` is reported as a name
		// the data does not carry.
		name: 'a `{@const}` read above where it is written, in legacy mode',
		source:
			'<script>export let data;</script>' +
			'{#if data.f}<h1>{yoo}|{bar}</h1>{@const foo = bar}{@const yoo = foo + data.a}' +
			'{@const bar = "w"}{/if}',
		data: [{ a: 'x', f: true }],
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
		// A block is a scope, and only a function's parameters used to be one. The substitution
		// reached past the block's own `f` to the script's and wrote a different function's body,
		// which is bytes rather than a refusal -- found by a `{@const}` whose initialiser held one.
		name: 'a declaration inside an expression shadows the script it sits in',
		source:
			'<script>let { data } = $props(); const f = (x) => x;</script>' +
			'<p>{data.xs.map((x) => { const f = (y) => y * 2; return f(x) }).join(",")}</p>',
		data: [{ xs: [1, 2, 3] }],
	},
	{
		// Destructuring uses the iterator protocol -- Svelte's server writes plain JavaScript and lets
		// the engine do it -- so reading `value[0]` is the same answer for an array and no answer at
		// all for anything else. Red without `to_array`: a `Set` wrote nothing where Svelte writes
		// its two members, silently, which is the shape this exists to stop. The count is the one
		// `_extract_paths` passes, and it caps an unbounded iterable rather than exhausting it.
		name: 'an array pattern over something that is not an array',
		source: '<script>let { data } = $props(); let [a, b] = data.src;</script><p>{a}-{b}</p>',
		data: [{ src: new Set(['p', 'q']) }],
	},
	{
		// `_extract_paths` in `compiler/utils/ast.js` answers the same question for the client, and a
		// rest is the one way in that wraps the value rather than following it:
		// `exclude_from_object(v, keys)` over every key the pattern named. That is why what a name
		// reaches its value by is a template rather than a suffix.
		name: 'a rest in a declaration gathers what the pattern did not name',
		source:
			'<script>let { data } = $props(); const { a, ...rest } = data.o;</script>' +
			'<p>{a}|{JSON.stringify(rest)}</p>',
		data: [{ o: { a: 1, b: 2, c: 3 } }],
	},
	{
		// A nesting is one way in after another, and the two kinds alternate: a member, then the
		// iterator, then a member again.
		name: 'a nested pattern in a declaration',
		source:
			'<script>let { data } = $props(); const { o: { x }, xs: [, second] } = data;</script>' +
			'<p>{x}|{second}</p>',
		data: [{ o: { x: 'v' }, xs: ['a', 'b'] }],
	},
	{
		// `build_inline_component` merges a spread with `$.spread_props` in source order, so a
		// component the walk could not enter still needs the object itself, with the request's
		// values standing in it. A marker is a string and spreading a string spreads its characters,
		// so what stands in has to be one marker per leaf -- the same reading an attribute's object
		// value already gets.
		name: 'a spread on a component the walk could not enter',
		// The child is one the walk cannot enter: it assigns a name after declaring it and the markup
		// reads that name, which is a program per request. `$props()` bound to a name is entered now,
		// being the object the call site passed, so it is no longer the shape to reach for here.
		beside: {
			Gate: '<script>let { a, b } = $props(); let c = a; c = b;</script><b>{c}{a}{b}</b>',
		},
		source:
			"<script>import Gate from './Gate.svelte'; let { data } = $props();</script>" +
			'<Gate {...{ a: data.a, b: "x" }} />',
		data: [{ a: 'v' }, { a: '<&' }],
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
		// `renderer.select` in `internal/server/renderer.js` destructures `{ value, defaultValue }`
		// off the **merged** attributes, writes neither, and compares every option against
		// `value === undefined ? defaultValue : value`. A spread carries either of them exactly as a
		// written attribute does, so the tag is read in source order and the last of each name wins.
		// Both have to come off, or Svelte does the comparison a second time over what was left:
		// measured on `<select {...{ defaultValue: 'b' }} defaultValue="a">`, which selected both
		// options when only the attribute was taken.
		name: 'a spread on a `<select>` carrying the value the options compare against',
		source:
			`${PROPS}<p>{data.a}</p><select {...{ defaultValue: 'b' }}>` +
			'<option value="a">A</option><option value="b">B</option></select>' +
			`<select {...{ defaultValue: 'b' }} defaultValue="a">` +
			'<option value="a">A</option><option value="b">B</option></select>' +
			`<select {...{ value: 'b', defaultValue: 'a' }}>` +
			'<option value="a">A</option><option value="b">B</option></select>',
		data: [{ a: 'x' }],
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
		// `transform-server.js` declares **every identifier the left binds**, not only a plain name:
		// `for (const id of extract_identifiers(node.body.expression.left))`, each one whose binding
		// is `legacy_reactive`. So a `$:` assigning a pattern is a declaration of what it
		// destructures, and each name reaches the right the way any pattern does.
		name: 'a `$:` that assigns a pattern declares every name in it',
		source:
			'<script>export let data; $: ({ a } = data.o); $: [x, y] = data.xs;</script>' +
			'<p>{a}|{x}|{y}</p>',
		data: [{ o: { a: 'v' }, xs: ['p', 'q'] }],
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
		// `to_style` builds one string from the written value and the directives, dropping a
		// declaration in the value whose name a directive also names. So which bytes exist is
		// decided by that string, and a marker cannot stand in it. Where the string is the same for
		// every request the render is the one that has it, and the whole run is left as written for
		// Svelte's own `to_style` to build -- which is what a spread of constants already gets.
		name: 'a `style:` beside a `style` the request does not decide',
		source:
			'<script>let { data } = $props(); const paint = () => "color: green";</script>' +
			'<p style:color={"red"} style={paint()}>{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// `build_element_attributes` has an arm for a spread, an attribute, a `class:`, a `style:` and
		// an attachment, and nothing else: a `use:`, a `transition:` and an `on:` fall past all of
		// them and write nothing. So a spread beside one merges exactly what it would have merged
		// without it, and the shorthand is the variable of that name -- `build_attr_style` writes
		// `b.id(directive.name)`, read from just past `style:` in the source, the same way the pass
		// that has no spread beside it reads one.
		name: 'a client-only directive and a `style:` shorthand beside a spread',
		source:
			'<script>let { data } = $props(); const focus = () => {}; const color = "red";</script>' +
			'<input {...{ name: data.a }} use:focus onfocus={() => {}} style:color />',
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
		// `typeof x` on a name nothing binds is defined behaviour and reads the same everywhere:
		// `"undefined"`. It is how a file asks whether a global exists, Svelte compiles it unchanged,
		// and the render evaluates the same expression. Only where every read is guarded that way --
		// the second here has to resolve, and does, from the pattern beside it.
		name: 'a name read only under `typeof`',
		source:
			'<script>const held = { b: { c: 1 } }; const { b: { c } } = held;' +
			' let { data } = $props();</script><p>{typeof b}|{typeof c}|{c}|{data.a}</p>',
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
		// `<svelte:element this="svg">` is a quoted literal, so its span sits inside the quotes: the
		// text there is the tag itself rather than an expression naming it, and the stand-in the
		// render is given has to replace the quotes too. Read as an expression it became the
		// identifier `svg`; written inside the quotes it made `this=""seam-el0""`, which Svelte
		// will not parse.
		name: 'a `<svelte:element>` whose tag is written as a quoted literal',
		source: `${PROPS}<svelte:element this="span">{data.a}</svelte:element>`,
		data: [{ a: 'v' }],
	},
	{
		// `VariableDeclaration.js` lets exactly three runes through to the visitor that answers them
		// where they stand -- `$effect.tracking`, `$inspect` and `$effect.root` -- and every other
		// rune in a declaration is its first argument or `void 0`. So `$effect.pending()` holds `0`
		// in an expression and `undefined` in a declaration, which is the same rule read in two
		// places. Without this the name went unrecorded and the markup reading it was refused.
		name: 'a declaration whose initialiser is a rune the server answers',
		source:
			'<script>let { data } = $props(); const here = $effect.tracking();' +
			' const stop = $effect.root(() => {});</script><p>{here}|{typeof stop}|{data.a}</p>',
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
		// A `{@const}` is a declaration scoped to its block, so it substitutes like any other
		// declared name -- chained, destructured, and in a branch's test. See spec/derivation.md.
		name: 'const tags',
		source:
			`${PROPS}{#if data.f}{@const n = data.n}{@const twice = n * 2}` +
			'{@const { k } = data.o}<i>{twice}{k}</i>{#if twice}<b>y</b>{/if}{/if}',
		data: [
			{ f: true, n: 3, o: { k: 'K' } },
			{ f: true, n: 0, o: {} },
		],
	},
	{
		name: 'markup that is inert on the server',
		beside: { Quiet: '<script>let { v } = $props();</script><i>{v}</i>' },
		source:
			"<script>import Quiet from './Quiet.svelte'; function act() {} let { data } = $props()</script>" +
			'<svelte:window /><svelte:body /><div use:act onclick={() => {}} {@attach act} {@attach data.g}>{data.a}</div>' +
			'<Quiet v={data.a} {@attach act} />{@debug data}',
		data: [{ a: 'v', g: null }],
	},
	{
		// What `$.await` writes for a value that is not a promise: `<!--[!-->` and the then branch,
		// with the value bound to it. The catch branch is never written on the server, so it is
		// dropped whole, holding a marker nothing binds. Every form the block takes: pending, then
		// and catch; the compact then; the compact catch; a destructured value; an each inside the
		// then and the whole inside a branch. See spec/refusals.md.
		name: 'an await over a value',
		source:
			`${PROPS}{#await data.p}<p>w</p>{:then v}<p>{v}</p>{:catch e}<u>{e}</u>{/await}` +
			'{#await data.o then { a, b }}<b>{a}{b}</b>{/await}' +
			'{#await data.p catch e}<u>{e}</u>{/await}' +
			'{#if data.f}{#await data.xs then list}{#each list as x}<i>{x}</i>{/each}{/await}{/if}',
		data: [
			{ p: 'x', o: { a: 1, b: 2 }, f: true, xs: ['q', 'r'] },
			{ p: '<&', o: { a: '', b: null }, f: false, xs: [] },
		],
	},
	{
		// A derivation that returns a promise, which is the one way a request can bring one: the
		// payload is data. Svelte's server does not wait: it writes `<!--[-->` and the pending
		// branch, and so does this, because the test is what `$.await` tests.
		name: 'an await over a promise',
		source:
			'<script>let { data } = $props(); const p = Promise.resolve(data.a);</script>' +
			'{#await p}<p>{data.w}</p>{:then v}<p>{v}</p>{/await}',
		data: [{ a: 'x', w: 'waiting' }],
	},
	{
		// On the server a boundary writes `<!--[-->`, its children, `<!--]-->`. The failed snippet
		// is never written, and the error handler never runs.
		name: 'a boundary',
		source:
			'<script>let { data } = $props(); function f() {}</script>' +
			'<svelte:boundary onerror={f}><p>{data.a}</p>{#if data.f}<b>y</b>{/if}' +
			'{#snippet failed(e)}<i>{e}</i>{/snippet}</svelte:boundary>',
		data: [
			{ a: 'x', f: true },
			{ a: '<&', f: false },
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
		// A name written in a type position is not a read, and a substitution written there is not
		// TypeScript: `T[k as keyof typeof T]` expanded `T` inside the `typeof` and stopped parsing.
		name: 'a substitution beside a type',
		source:
			'<script lang="ts">let { data }: { data: { k: string } } = $props();' +
			" const T = { a: 'A', b: 'B' } as const; const v = T[data.k as keyof typeof T];" +
			'</script><p>{v}</p>',
		data: [{ k: 'a' }, { k: 'b' }],
	},
	{
		// A value the request does not decide is bytes, computed by the render: a declaration
		// calling an import with nothing from the payload, a `$state` with no value, and a message
		// under a fixed locale. None of these is a hole, so none is asked for per request -- which
		// is what press's newsletter count needed, being client state whose server value is fixed
		// by construction and whose library cannot run outside a render. See spec/refusals.md.
		name: 'a value the request does not decide',
		alongside: {
			'count.ts': 'export const count = () => 3; export const greet = (l) => `hi-${l}`;',
		},
		source:
			"<script>import { count, greet } from './count.ts'; let { data } = $props();" +
			' const n = count(); let open = $state(); const msg = greet(data.locale);</script>' +
			'<p>{n}</p><i>{open}</i><b>{msg}</b><u title={n}>{data.a}</u>',
		fixed: { 'data.locale': '"en"' },
		data: [
			{ locale: 'en', a: 'x' },
			{ locale: 'en', a: '<&' },
		],
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
		// A class written as an expression, on an element the stylesheet could match. Svelte scopes
		// the element when it cannot read what the class could be, and appends the hash; a marker
		// or a constant written there is a literal it can read, and the hash went missing. What is
		// written into a class value is shielded from the analysis. See `Walk.classValue`.
		name: 'a class expression on a styled element',
		source:
			`${PROPS}<script>const fixed = 'k'</script>`.replace('</script><script>', '; ') +
			'<p class={data.a}>x</p><i class={fixed}>y</i><b class="{data.a} z">w</b>' +
			'<style>.on { color: red } .k { color: blue }</style>',
		data: [{ a: 'on' }, { a: 'off' }, { a: '' }],
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
		// Every `<option>` goes through `renderer.option` -- `is_option_special` is the name alone --
		// so its attributes are written by `attributes()`, which writes a boolean one as `name=""`
		// whatever its value. A marker planted there never comes back, and `disabled=""` landed on
		// every item of the each. It is a decision, carried the way `selected` is.
		name: 'a boolean attribute on an option',
		source:
			`${PROPS}<select><option value="none">none</option>` +
			'{#each data.xs as x}<option disabled={data.taken.includes(x)} value={x}>{x}</option>{/each}' +
			'</select>',
		data: [
			{ xs: [1, 2, 3], taken: [2] },
			{ xs: [], taken: [] },
		],
	},
	{
		// `renderer.select()` compares the options against `value === undefined ? defaultValue :
		// value`, and writes neither attribute.
		name: 'a select with a defaultValue',
		source:
			`${PROPS}<select defaultValue={data.s}><option>a</option><option value="b">B</option></select>` +
			'<select value={data.v} defaultValue="b"><option>a</option><option>b</option></select>' +
			'<select multiple defaultValue={data.m}><option>a</option><option>b</option></select>',
		data: [
			{ s: 'a', v: 'a', m: ['a', 'b'] },
			{ s: 'b', v: undefined, m: [] },
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
		// `build_attr_class`: `$.attr_class($.clsx(value), hash, { on: t })`, one call whose result
		// is the attribute or nothing, and a falsy directive removes its name from the value. The
		// call is Svelte's own, carried, with the hash read off the render.
		name: 'class: beside a class attribute that is an expression',
		source:
			`${PROPS}<b class={data.c} class:on={data.t}>x</b>` +
			'<i class={[data.c, "k"]} class:on={data.t} class:off={!data.t}>y</i>' +
			'<u class="a {data.c}" class:on={data.t}>z</u>' +
			'<em class={data.c} class:on={data.t}>w</em>' +
			'<style>b { color: red } i { color: blue }</style>',
		data: [
			{ c: 'on p', t: true },
			{ c: 'on p', t: false },
			{ c: null, t: false },
			{ c: 'q', t: true },
		],
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
		// Whether an element is scoped is decided by what its class could be, and
		// `gather_possible_values` reads a literal, a ternary, a logical and an array. A class the
		// walk hid from it was scoped where Svelte leaves it alone -- press writes
		// `class="truncate {tone === 'dark' ? 'text-black' : 'text-white'}"`, matching neither of
		// this stylesheet's rules, and that one class was every differing byte of two hundred and
		// sixty-seven of its responses. Here the readable shapes sit beside the ones the analysis
		// gives up on, so the scoping of each is Svelte's own.
		name: 'a class the css analysis can read',
		source:
			'<script>let { data } = $props(); const ell = (v) => String(v).toUpperCase();</script>' +
			`<b class="t {data.f ? 'p' : 'q'}">x</b>` +
			"<i class=\"t {data.f ? 'on' : 'q'}\">y</i>" +
			'<u class="t {data.f && \'q\'}">z</u>' +
			'<em class="t {data.c}">w</em>' +
			'<span class="t {ell(data.c)}">v</span>' +
			'<style>.on { color: red } .card { color: blue }</style>',
		data: [
			{ f: true, c: 'on' },
			{ f: false, c: 'q' },
		],
	},
	{
		// `class={[...]}` and `class={{...}}` go through `clsx` in Svelte's own output, and so does
		// a bare name, which may hold either.
		name: 'a class that is an array or an object',
		source:
			`${PROPS}<b class={[data.c, 'k', data.t && 'on']}>x</b><i class={{ on: data.t, off: !data.t }}>y</i>` +
			'<u class={data.c}>z</u><style>b { color: red } i { color: blue }</style>',
		data: [
			{ c: 'p', t: true },
			{ c: ['q', 'r'], t: false },
			{ c: null, t: false },
		],
	},
	{
		// `prepare_element_spread`: the class directives and the style directives are the third and
		// fourth arguments of the one `$.attributes` call, and an attribute mixing text and an
		// expression is one template in the object. All of it is Svelte's own call, read back.
		name: 'directives and mixed text beside a spread',
		source:
			'<script>let { data } = $props(); const on = data.t;</script>' +
			'<div {...data.r} class:on style:color={data.c} a="x{data.y}" class="k">x</div>' +
			'<p {...data.r} class:off={!data.t} style:width="{data.w}px" style:margin|important={data.m}>y</p>' +
			'<style>div { color: red }</style>',
		data: [
			{ r: { id: 'i', class: 'on q' }, t: true, c: 'red', y: 'Y', w: 3, m: '1px' },
			{ r: {}, t: false, c: null, y: null, w: null, m: null },
		],
	},
	{
		// `$.element()` writes the tag and calls the same `$.attributes` for the run, so the run is
		// a hole inside the element block, hash and flags read back as on a written element.
		name: 'svelte:element with a spread',
		source:
			`${PROPS}<svelte:element this={data.tag} {...data.r} id="x" class:on={data.t}>c</svelte:element>` +
			'<svelte:element this={data.tag} {...data.r} /><style>div { color: red }</style>',
		data: [
			{ tag: 'div', r: { a: '1' }, t: true },
			{ tag: 'br', r: {}, t: false },
			{ tag: 'p', r: { class: 'q' }, t: false },
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
		name: 'a dynamic component chosen through a table, with a key the table lacks',
		beside: { Ay2: '<i>A</i>' },
		source:
			"<script>import Ay2 from './Ay2.svelte'; let { data } = $props();" +
			' const ICONS = { a: Ay2 };</script><svelte:component this={ICONS[data.k]} /><p>{data.x}</p>',
		fixed: { 'data.k': '"zz"' },
		data: [{ k: 'zz', x: '2' }],
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
		// `set_title` in `internal/server/renderer.js` keeps the title whose render path compares
		// later, and `$.head` is hoisted ahead of its fragment, so a child's head block runs after
		// its parent's and wins whichever order they are written in, a later sibling wins over an
		// earlier one, and inside one head block the first title executed is kept: a top-level one
		// before any inside a block. Measured against Svelte for every case here.
		name: 'which title wins',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><title>kid {t}</title></svelte:head><i>k</i>',
			Kid2: '<script>let { t } = $props();</script><svelte:head><title>kid2 {t}</title></svelte:head><i>k</i>',
			Deep: "<script>import Kid from './Kid.svelte'; let { t } = $props();</script><Kid {t} /><svelte:head><title>deep {t}</title></svelte:head>",
		},
		source:
			"<script>import Kid from './Kid.svelte'; import Kid2 from './Kid2.svelte'; import Deep from './Deep.svelte'; let { data } = $props();</script>" +
			'<svelte:head>{#if data.f}<title>B {data.a}</title>{/if}<title>A {data.a}</title><title>C</title></svelte:head>' +
			'{#if data.g}<Kid t={data.t} />{/if}{#if data.h}<Deep t={data.t} /><Kid2 t={data.t} />{/if}<p>{data.a}</p>',
		data: [
			{ f: true, g: false, h: false, a: 'x', t: 'T' },
			{ f: false, g: true, h: false, a: 'y', t: '<' },
			{ f: true, g: true, h: true, a: 'z', t: 'U' },
			{ f: false, g: false, h: true, a: 'w', t: 'V' },
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
		// `clean_nodes` hoists a title out of its fragment, so the whitespace around it is trimmed
		// where it opened or closed the fragment and one space where two neighbours remain. The
		// stand-in stays in the fragment, and the whitespace is written as hoisting leaves it.
		name: 'a title among the whitespace of its head',
		beside: {
			Mid: '<svelte:head>\n\t<meta name="a" />\n\t<title>M</title>\n\t<meta name="b" />\n</svelte:head>',
			Last: '<svelte:head>\n\t<meta name="c" />\n\t<title>L</title>\n</svelte:head>',
		},
		source:
			"<script>import Mid from './Mid.svelte'; import Last from './Last.svelte'; let { data } = $props();</script>" +
			'<svelte:head>\n\t<title>F {data.a}</title>\n\t<meta name="d" />\n\t{#if data.f}\n\t\t<title>I</title>\n\t{/if}\n\t<meta name="e" />\n</svelte:head>' +
			'{#if data.g}<Mid /><Last />{/if}<p>{data.a}</p>',
		data: [
			{ a: 'x', f: true, g: true },
			{ a: 'y', f: false, g: false },
		],
	},
	{
		// `{...props}` on a component is `$.spread_props`, and a call site knows the keys exactly
		// when the object is written out, which a rest gathered from the caller's attributes is once
		// it is expanded. Then the spread is so many props and the child is entered.
		name: 'a spread on a component whose object is known',
		beside: {
			Outer:
				'<script>import Inner from \'./Inner.svelte\'; let { title, ...props } = $props();</script><h2>{title}</h2><Inner {...props} extra="e" />',
			Inner:
				'<script>let { a, b = 1, extra } = $props();</script><p>{a.toUpperCase()}{b * 2}{extra}</p>',
		},
		source:
			"<script>import Outer from './Outer.svelte'; let { data } = $props();</script>" +
			'<Outer title={data.t} a={data.a} b={data.b} onclick={() => {}} />',
		data: [
			{ t: 'T', a: 'x', b: 3 },
			{ t: '<', a: 'y', b: undefined },
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
		// The same ways in where an await binds them. The then branch is the one the server writes,
		// its value the expression itself, so a rest there is the same call over it.
		name: 'an await whose value is taken apart every way a pattern offers',
		source:
			`${PROPS}{#await data.v then { 'a-b': ab, [ab ?? 'k']: picked, n: { deep }, ...rest }}` +
			'<i>{ab}|{picked}|{deep}|{JSON.stringify(rest)}</i>{/await}',
		data: [
			{ v: { 'a-b': 'k', k: 'P', n: { deep: 'D' }, z: 1 } },
			{ v: { 'a-b': '<', n: {}, y: 'y' } },
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
		// A fragment that writes a head stands in the head stream too, its head half a fragment of
		// its own that every call of it calls, so the head holds one block per level and the deepest
		// last level's title wins as the last head block executed. And a rest is a parameter bound
		// per call to what the call wrote and the pattern did not name.
		name: 'a component that renders itself with a head and a rest',
		beside: {
			Tree:
				"<script>import Tree from './Tree.svelte'; let { node, ...rest } = $props();</script>" +
				'<svelte:head><meta name="n" content={node.label} /><title>T {node.label}</title></svelte:head>' +
				'<li {...rest}>{node.label}{#each node.children ?? [] as child}<ul><Tree node={child} title={child.label} /></ul>{/each}</li>',
		},
		source: `<script>import Tree from './Tree.svelte'; let { data } = $props();</script><ul><Tree node={data.tree} class="root" /></ul>`,
		data: [
			{
				tree: {
					label: 'a',
					children: [{ label: 'b' }, { label: 'c', children: [{ label: 'd' }] }],
				},
			},
			{ tree: { label: '<&' } },
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
		// `{...data.obj}` on a component is `$.spread_props` over an object whose keys the request
		// decides. The child's `$props()` names what it reads, so each of those is the value the
		// merge leaves for it -- a later part overriding an earlier one by the key's presence, a
		// missing key leaving the default -- and the rest is the merge with the named keys taken
		// out, spread onto an element per request. See `merged()` in walk.ts.
		name: 'a spread on a component whose object the request hands over',
		beside: {
			Inner:
				'<script>let { a, b = 1, extra, ...rest } = $props();</script><p {...rest}>{a}{b}{extra}</p>',
		},
		source:
			"<script>import Inner from './Inner.svelte'; let { data } = $props();</script>" +
			'<Inner {...data.obj} extra="e" /><Inner a="first" {...data.obj} b={data.n} />',
		data: [
			{ obj: { a: 'q', b: 2, title: 't' }, n: 7 },
			{ obj: { a: 'r', b: undefined, 'data-x': '1' }, n: undefined },
			{ obj: null, n: 0 },
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
		// `$.head` runs where the component does, so a headed child inside an each writes one head
		// block per item and one inside an if writes one per branch taken, and the head is a flat
		// run of head blocks with nothing around the ones a block produced. The walk stands the
		// block in the head stream as well: a `{@const}` at the start of each branch opens it and
		// an expression tag beside the stamp closes it, neither touching the body's bytes. The head
		// IR then carries the each and the if the body does. The last item's title wins, as the
		// last head block executed. See `mirrored()` in walk.ts and spec/ir.md.
		name: 'a component with a head inside an each',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /><title>K {t}</title></svelte:head>k{t}',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<svelte:head><title>A</title></svelte:head>\n{#each data.xs as x}\n\tx{x}<Kid t={x} />\n{/each}\n' +
			'{#each data.ys as y}<p>{y}</p>{:else}<Kid t="none" />{/each}<p>{data.a}</p>',
		data: [
			{ xs: [1, 2], ys: ['q'], a: 'v' },
			{ xs: [], ys: [], a: 'w' },
			{ xs: ['<'], ys: [], a: '' },
		],
	},
	{
		// The same for an if: one head block on the branch that holds the child and none on the
		// others, through an `{:else if}` chain and an if with no else, whose render not taken has
		// to hold the block all the same.
		name: 'a component with a head inside a branch',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /></svelte:head><i>k</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<p>a</p>\n{#if data.g}<Kid t="g" />{:else if data.h}<Kid t="h" />{:else}<b>n</b>{/if}\n' +
			'{#if data.g}<Kid t={data.t} />{/if}\n<p>b</p>',
		data: [
			{ g: true, h: false, t: 'T' },
			{ g: false, h: true, t: 'T' },
			{ g: false, h: false, t: 'T' },
		],
	},
	{
		// An await is an if to every pass after the walk, and stands in the head the same way; its
		// pending branch is the one place Svelte allows no `{@const}`, so the open goes around the
		// awaited expression, which runs once before either branch. See `headOpensWith()`.
		name: 'a component with a head inside an await',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /></svelte:head><i>k</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'{#await data.p}<Kid t="w" />{:then v}<b>{v}</b><Kid t={v} />{/await}',
		data: [{ p: Promise.resolve('x') }, { p: 'done' }],
	},
	{
		// Two blocks deep, in a table: the inner if stands in the head inside the outer each, and
		// the close rides inside the `<template>` the stamp needs where text is refused.
		name: 'a component with a head two blocks deep in a table',
		beside: {
			Kid: '<script>let { t } = $props();</script><svelte:head><meta name="k" content={t} /></svelte:head><i>k</i>',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<table><tbody>{#each data.rows as r}<tr><td>{#if r.on}<Kid t={r.t} />{/if}<Kid t="row" /></td></tr>{/each}</tbody></table>',
		data: [
			{
				rows: [
					{ on: true, t: 'a' },
					{ on: false, t: 'b' },
				],
			},
			{ rows: [] },
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
		// `$bindable` marks a prop a parent may write and may only appear inside `$props()`, so what
		// stands for the default elsewhere is its argument. The entry has no parent to bind it.
		name: "a `$bindable` default on the entry's own props",
		source:
			'<script>let { data, open = $bindable(true) } = $props();</script>' +
			'<p>{open ? "open" : "shut"}</p><i>{data.a}</i>',
		props: [{ data: { a: 'x' } }, { data: { a: 'x' }, open: false }],
	},
	{
		// The shape Kit's generated root has, which is why this had to stay a path: `data_0 = null`
		// per level of the route. Rewriting each read into a guard was tried and turned every read
		// of every prop on every page into a derivation. See `Skeleton.defaults`.
		name: 'a default on a prop the markup reads fields off, which stays a path',
		source:
			'<script>let { form, page, data_0 = null } = $props();</script>' +
			'<h1>{data_0.title}</h1><p>{data_0.body}</p><a href={page.url}>{form}</a>',
		props: [
			{ form: 'f', page: { url: '/p' }, data_0: { title: 'T', body: 'B' } },
			{ form: 'f', page: { url: '/p' }, data_0: { title: 'T', body: 'B' }, extra: 1 },
		],
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
		// The other side of the same rule, and the one that says the fix is not a blanket anchor:
		// `RegularElement.js` never goes through `Fragment.js`, so its children read the enclosing
		// flag, which inside an element is always false -- Svelte writes the anchor here by itself
		// and a second one would be ours. Measured on `runtime-legacy/self-reference-tree`.
		name: 'a `<svelte:self>` alone inside an element, where Svelte writes the anchor itself',
		source:
			'<script>let { data } = $props();</script><ul>{#each data.items as item}' +
			'<li>{#if item.kids}<svelte:self data={{ items: item.kids }} />{:else}{item.name}{/if}</li>' +
			'{/each}</ul>',
		data: [{ items: [{ name: 'a' }, { kids: [{ name: 'b' }] }] }, { items: [] }],
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
		// Where an element carries a `class:` or a `style:` and no attribute of that name,
		// `2-analyze/index.js` appends one: `create_attribute('class', ...)` when it is scoped or
		// has a class directive, then `create_attribute('style', ...)` when it has a style one. Both
		// land after every written attribute, and class is appended first whichever order the
		// directives were written in. Here both are inserts at that one offset, and the one pushed
		// later comes out first, so the two passes run the other way round.
		name: 'a `class:` and a `style:` with no attribute of either name',
		source:
			`${PROPS}<p style:color={data.c} class:on={data.on}>a</p>` +
			'<p class:on={data.on} style:color={data.c} id="x">b</p>' +
			'<p style="margin:0" class:on={data.on}>c</p>',
		data: [
			{ c: 'red', on: true },
			{ c: '', on: false },
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
		// A path is a member chain rooted at a name the payload carries, and nothing in it says which
		// steps land on data and which on a string, an array or a number. Resolution used to stop at
		// anything that was not an object, so this wrote nothing where Svelte writes the number.
		name: 'a path whose last step reads a string or an array',
		source: `${PROPS}<p>{data.t.length}</p><i>{data.xs.length}</i><b>{data.xs[0]}</b>`,
		data: [
			{ t: 'abc', xs: ['q', 'r'] },
			{ t: '', xs: [] },
		],
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
	{
		// `build_attr_style` writes `b.id(directive.name)` where a written value would have been
		// built, so `style:color` is the variable `color`. The name sits just past `style:` in the
		// source, which is where an expansion of it is read from.
		name: 'a `style:` in its shorthand form',
		source:
			'<script>let { data } = $props(); const color = data.c; const width = data.w;</script>' +
			'<p style:color style:width>a</p><i style:color="green">b</i>',
		data: [
			{ c: 'red', w: '2px' },
			{ c: '', w: null },
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
	{
		// A declaration reading a prop is neutralised for the render, which is given no data. The
		// legacy spellings of a prop were not counted as ones -- `export let` and `export { x as y }`
		// -- so `export let n; const twice = n.v * 2` kept its initialiser, and the render evaluated
		// `undefined.v` and threw a `TypeError` naming nothing: the crash the neutralisation exists
		// to prevent. Found by probe; the corpus shows four of these and they all read as
		// `Cannot read properties of undefined`.
		name: 'a declaration computed from a legacy prop',
		source:
			'<script>export let n; let m; export { m as q };' +
			' const twice = n.v * 2; const held = `[${m}]`;</script><p>{twice}{held}</p>',
		props: [
			{ n: { v: 21 }, q: 'x' },
			{ n: { v: 0 }, q: '<' },
		],
	},
	{
		// `LabeledStatement.js` collects a `$:` and `transform-server.js` puts it at the end of the
		// instance body in topological order, declaring `let x` for the name it assigns. So it is a
		// declaration whose initialiser is the right-hand side, and one reading another chains the
		// way two declarations do -- the ordering being what substitution does anyway.
		name: 'reactive declarations',
		source:
			'<script>export let a; let n = 2; $: doubled = a * n; $: label = `is ${doubled}`;' +
			' $: console.log(label);</script><p>{doubled} {label}</p>',
		data: [{ a: 3 }, { a: 0 }],
	},
	{
		// `CallExpression.js` answers every rune where it stands, and an expression holding one has
		// to be written as what Svelte writes there: `$effect.tracking()` is `false`,
		// `$effect.pending()` is `0`, `$effect.root()` a noop, `$state.eager(v)` the argument. They
		// were read as names the data has to carry.
		name: 'markup holding the runes the server answers',
		source:
			`${PROPS}<p>{$effect.tracking()}{$effect.pending()}{typeof $effect.root(() => {})}</p>` +
			'<p>{$state.eager(data.a)}</p>',
		data: [{ a: '1' }, { a: '<' }],
	},
	{
		// `shared/element.js` pushes ` onload="this.__e=event" onerror="this.__e=event"` after the
		// attributes of a load or error element carrying a spread. The spread replaces the whole
		// attribute run with one call, so those two literals are inside what its marker stands for
		// and have to be written back with it.
		name: 'a spread on an element that fires load and error',
		source: `${PROPS}<img alt="" {...data.rest} /><span {...data.rest}></span>`,
		data: [{ rest: { width: '100%', src: 'x' } }, { rest: {} }],
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
		// `console` reads the same everywhere -- `undefined` -- and what it does instead of returning
		// is not bytes, so it is one of the names nobody has to think about. Eight of Svelte's
		// samples log from markup and were refused for reading a name the data does not carry.
		name: 'markup that logs',
		source: `${PROPS}<p>{console.log(data.a) ?? data.a}</p>`,
		data: [{ a: '1' }, { a: '<' }],
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
		// `SlotElement.js` builds `$.spread_props([{ ...named }, ...spreads])` -- every written
		// attribute in one object first and then the spreads, which is not the order they were
		// written in, so a spread wins over a name beside it however they were arranged. Each
		// `let:` name is the fold that merge leaves for it.
		//
		// And a component carrying `slot=` is a named slot inside another one, so its `let:` scope
		// is that slot's rather than its own: `slot_scope_applies_to_itself`. Its own `<slot />`
		// passes nothing for the name, and reading it there used to write `undefined`.
		name: 'a slot with a spread, and a `let:` on a component that is itself a named slot',
		beside: {
			Outer: `${PROPS}<div>{#each data.rows as row}<slot name="foo" {row} />{/each}</div>`,
			Inner: '<script>export let row;</script><span>{row.n}</span><slot />',
			Spread:
				'<script>export let obj; export let c;</script><slot c={c} {...obj} d="d" /><slot name="x" />',
		},
		source:
			"<script>import Outer from './Outer.svelte'; import Inner from './Inner.svelte';" +
			" import Spread from './Spread.svelte'; let { data } = $props();</script>" +
			'<Outer {data}><Inner slot="foo" let:row={r} row={r}><b>{r.n}</b></Inner></Outer>' +
			'<Spread obj={data.obj} c={data.c} let:a let:c let:d><i>{a}{c}{d}</i></Spread>',
		data: [
			{ rows: [{ n: 1 }, { n: 2 }], obj: { a: 'A', c: 'over' }, c: 'c' },
			{ rows: [], obj: {}, c: '<' },
		],
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
	{
		// Svelte calls its own helpers through `$.`; ours had them bare, so a component with a prop
		// called `attributes` -- an ordinary name for one -- put an object where the helper's name
		// was and the derivation called it. They are carried under a `$$` name now, which nothing
		// the author writes can shadow because Svelte reserves the prefix.
		name: 'a prop named after one of the helpers a spread calls',
		source:
			'<script>export let attributes = {}; export let myClass;</script>' +
			'<div class={myClass} {...attributes}></div>',
		props: [
			{ myClass: 'a', attributes: { id: 'x', title: 't' } },
			{ myClass: '', attributes: {} },
		],
	},
];

// Each one is a gap rather than a boundary, and the message has to say which.
const refused: Case[] = [
	{
		// The object a caller passed is rebuilt wherever it is read -- the entry's out of the
		// payload, a child's out of what its call site wrote -- so a write into it is lost. The
		// same rule an assignment after a declaration falls under, on a name that is not a
		// declaration: measured, `$: $$restProps.c = 'c'` beside `{$$restProps.c}` wrote nothing
		// where Svelte wrote `c`.
		name: 'a script that writes into the props object',
		says: 'the object a caller passed is rebuilt',
		source:
			"<script>export let a; $: $$restProps.c = $$restProps.c ?? 'c';</script>" +
			'<p>{a}{$$restProps.c}</p>',
	},
	{
		// Which child sends back is the block's answer rather than the file's:
		// `{#if a}<Foo bind:x/>{:else}<Bar bind:x/>{/if}` settles `x` to one default or the other,
		// and the read outside the block sees whichever branch ran. One ternary per file cannot say
		// that, and writing the block's answer as the file's is bytes rather than a refusal --
		// measured on two samples before this said so.
		name: 'a component `bind:` written inside a block',
		says: 'a binding the child sends back',
		beside: { Kid: "<script>export let x = 'yes';</script><p>{x}</p>" },
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props(); let x;</script>" +
			'{#if data.f}<Kid bind:x />{/if}<p>{x}</p>',
	},
	{
		// A component's `<script module>` is module state too, reached by a named import of the
		// component. The render mutates its own instance of that module and would bake whatever it
		// left behind; the artifact's instance is a different one, per request. One render cannot
		// show it -- the oracle renders once and agrees -- which is why this is a refusal and not a
		// byte comparison.
		name: 'a name a component`s module script changes',
		says: 'a module binding something in that module changes',
		beside: {
			Held: '<script module>export let n = 0; export function bump() { n += 1 }</script><i>h</i>',
		},
		source:
			"<script>import { n, bump } from './Held.svelte'; let { data } = $props(); bump();" +
			'</script><p>{n}|{data.a}</p>',
	},
	{
		// And a name read both ways still has to come from somewhere.
		name: 'a name read under `typeof` and beside it',
		says: 'the data does not carry',
		source: `${PROPS}<p>{typeof mystery}{mystery}</p>`,
	},
	{
		// And refused where the string is the request's, which is the half a marker cannot stand in.
		name: 'a `style:` beside a `style` the request decides',
		says: 'the request decides',
		source: `${PROPS}<p style:color={"red"} style={data.s}>x</p>`,
	},
	{
		// Where the object itself is what the request decides there is nothing to put a marker
		// inside: its keys cannot be listed, so no object can stand in it while the bytes are
		// written. Refused by name rather than written wrong.
		name: 'a spread on a component the walk could not enter, over a value the request decides',
		beside: {
			Gate: '<script>let { a } = $props(); let c = a; c = "s";</script><b>{c}{a}</b>',
		},
		source:
			"<script>import Gate from './Gate.svelte'; let { data } = $props();</script>" +
			'<Gate {...data.o} />',
		says: 'its keys cannot be listed',
	},
	{
		// A declaration is substituted at every read, so a value that is not the same twice is a
		// different value at each of them. `Math.random` was already refused where the markup wrote
		// it; this is the same rule reaching the declaration the markup read, and `Symbol()` is the
		// shape that found it -- two reads, two symbols, and `false` where Svelte writes `true`.
		name: 'a declaration the markup reaches holding a value that is not the same twice',
		source:
			'<script>let { data } = $props(); const s = Symbol(); const o = { [s]: data.a };</script>' +
			'<p>{s in o}</p>',
		says: 'the same twice',
	},
	{
		// The store itself would have to be in the payload, and a store is an object with a
		// `subscribe` function where the payload carries data. `store_get` handed a marker reads
		// nothing, so this used to be written out for the render and came back empty.
		name: 'a `$store` over a value the request brings',
		says: '`$store` subscription',
		source: '<script>export let s;</script><p>{$s}</p>',
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
		// A path may hold it -- the injector splits on dots and looks the segment up -- but every
		// expression this compiler writes is JavaScript, where `kebab-case` is a subtraction. So it
		// is refused rather than turned into a path that works until something derives from it.
		name: 'an entry prop whose name is not an identifier',
		says: 'not an identifier',
		source: "<script>let { data, 'kebab-case': k } = $props();</script><p>{k}</p><b>{data.a}</b>",
	},
	{
		// Every key the request brought that the pattern did not name, and a derivation reads its
		// scope through `with`, which binds the keys and not the object -- so there is nothing to
		// gather them from. It used to read as a path of its own and write nothing.
		name: "a rest in the entry's props",
		says: 'rest in the entry',
		source:
			'<script>let { data, ...others } = $props();</script><p>{others.bar}</p><b>{data.a}</b>',
	},
	{
		// A `<select>` carrying a spread goes through `renderer.select` rather than `$.attributes`,
		// so the run of attributes has no call for a marker to ride in. Where the spread holds a
		// value the request decides there is nowhere to put it, and it is refused rather than
		// planted into a call Svelte did not compile.
		name: 'a spread on a `<select>` holding a value the request decides',
		says: 'Svelte compiled no call',
		source:
			`${PROPS}<select {...{ value: data.v, 'data-x': data.a }} defaultValue="a">` +
			'<option value="a">A</option></select>',
	},
	{
		// The keys of a spread on a `<select>` are only listable where it is written out. Where they
		// are not, the value the options compare against is the request's and so is the option that
		// carries it, and nothing can take it off the tag.
		name: 'a spread on a `<select>` whose keys cannot be listed',
		says: 'whose keys cannot be listed',
		source: `${PROPS}<select {...data.r}><option value="a">A</option></select>`,
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
		// The child is one the walk cannot enter -- it assigns a name after declaring it and the
		// markup reads that name -- and it branches on what it was handed.
		beside: {
			Gate:
				'<script>let { on } = $props(); let t = on; t = !!on;</script>' +
				'{#if t}<b>shown</b>{/if}',
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
		// after. See `headedFragment()` in walk.ts.
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
		// Chosen by a value the request decides, and the source names no component it could be: the
		// payload carries data and no function, so the component this renders is the one the request
		// sent and there are no bytes for it. A `?:` or a lookup in a literal would be enumerable
		// and stops the walk to ask instead, and a `this` naming one candidate is a block.
		name: 'a dynamic component chosen by the request',
		source: '<script>let { data } = $props(); const Pick = $derived(data.c);</script><Pick />',
		says: 'the source names none it could be',
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
		// The snippet inside the tag is what keeps the walk out of the child; entered, the same
		// child compiles, which the accepted case with the same name says.
		name: 'one value a child eats and one it never writes',
		says: '`eaten`',
		beside: {
			Eats:
				'<script>let { eaten, ignored, ...rest } = $props(); const open = false;</script>' +
				'<b>{eaten.toUpperCase()}</b>{#if open}<i>{ignored}</i>{/if}',
		},
		source:
			"<script>import Eats from './Eats.svelte'; let { data } = $props();</script>" +
			'<Eats ignored={data.b} eaten={data.a}>{#snippet extra()}<u>e</u>{/snippet}</Eats>',
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
		beside: { Feeds: '<script>let { row, ...rest } = $props();</script><p>{@render row?.(1)}</p>' },
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
		// Substitution replaces a name with the expression it was declared to be, so an assignment
		// afterwards makes that expression stop being what the name holds. Both of these compiled and
		// wrote the wrong bytes before they were refused.
		name: 'a name assigned after it is declared',
		source: '<script>let { data } = $props(); let x = 1; x = 2</script><p>{x}</p>',
	},
	{
		name: 'an object mutated after it is declared',
		source: '<script>let { data } = $props(); const o = { a: 1 }; o.a = 2</script><p>{o.a}</p>',
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
		says: 'a context read in a value the request decides',
		source:
			"<script>import { getContext } from 'svelte'; let { data } = $props();</script>" +
			'<b>{getContext(data.k)}</b>',
	},
	{
		// Not a declaration: `$: $count = n` writes the store, and `transform-server.js` declares a
		// `let` only for a binding whose kind is `legacy_reactive`. Nor is one whose name a `let`
		// already declares, which stays an assignment after a declaration and stays refused.
		name: 'a reactive statement that writes a store',
		says: 'assigned after being declared',
		source: '<script>export let a; let n = 1; $: n = a * 2;</script><p>{n}</p>',
	},
	{
		// A rune is compiled away by Svelte and is not a function anything can call. The ones whose
		// answer the server writes are written out -- `ANSWERED` in `locals.ts` -- and what is left
		// is the ones that call into Svelte's runtime: `$derived` in a class field is not a
		// declaration this pass reads, and reached the evaluator as `$derived is not defined`.
		name: 'a rune left in a value the request decides',
		says: 'is left in a value the request decides',
		source:
			'<script>let { data } = $props(); class T { n = 1; twice = $derived(this.n * 2); }' +
			' const t = new T();</script><p>{t.twice + data.a}</p>',
	},
	{
		// Svelte catches what a boundary's body throws and writes the `failed` snippet instead, so
		// where the body calls the author's code over a value the request brings, which of the two
		// shapes reaches the bytes is the request's answer. It threw at injection instead -- a
		// refusal arriving per request, which is the whole of what `deriving ... failed` is.
		name: 'a boundary whose body calls over a request value',
		says: 'a `<svelte:boundary>` with a `failed` snippet',
		source:
			'<script>let { data } = $props(); function search(q) { throw new Error(q); }</script>' +
			'<svelte:boundary><p>{search(data.q)}</p>' +
			'{#snippet failed(e)}<i>{e.message}</i>{/snippet}</svelte:boundary>',
	},
	{
		// The render's module instances are not the artifact's. An expression the walk judges inert
		// is handed back for Svelte to evaluate in the render, which imports the module afresh; a
		// derivation evaluates in the carried bundle, which imported it once. Where the module holds
		// no state the two agree; where it does, they are two states -- `{mark(n)}` ran in the
		// bundle and `{seen.length}` in the render, where `mark` was a marker and never ran: `1:0`,
		// `2:0` against Svelte's `1:1`, `2:2`.
		name: 'a read of module state something in that module changes',
		says: 'a module binding something in that module changes',
		alongside: {
			'held.js':
				'export const seen = [];\nexport function mark(x) { seen.push(x); return seen.length; }\n',
		},
		source:
			"<script>import { mark, seen } from './held.js'; let { data } = $props();</script>" +
			'{#each data.rows as r}<b>{mark(r)}:{seen.length}</b>{/each}',
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
		// A prop is not a declaration, and the rule is the same: Svelte runs the instance script
		// before the template, so `options` holds `bar` while the bytes are written, where the
		// substitution stands for the payload's key and wrote `foo`.
		name: 'a prop assigned after it is destructured',
		says: 'assigned after being declared',
		source: "<script>let { options = 'foo' } = $props(); options = 'bar'</script><p>{options}</p>",
	},
	{
		// The same fault one level in, and it used to compile: the instance script runs once and a
		// function beside it closes over that one binding, while substitution gives every read its
		// own copy of the initialiser. Measured against Svelte before it was refused, `1|0` and
		// `2|0` where Svelte wrote `1|1` and `2|2`.
		name: 'a value changed by a function the markup calls',
		says: 'changed by a function this render calls',
		source:
			'<script>let { data } = $props(); const log = [];' +
			' function next(x) { log.push(x); return x; }</script>' +
			'{#each data.rows as row}<p>{next(row)}|{log.length}</p>{/each}',
	},
	{
		// A function written as an argument of a call is run by that call: `run(() => count += 1)`
		// from `svelte/legacy` is a `$:` migrated, and `untrack(() => count++)` is Svelte's own.
		// A plain name only -- `sleep(10).then(() => ...)` hands its function to a member, and what
		// a member does with one this pass does not know -- and not the runes `CallExpression.js`
		// answers with `void 0`, whose argument the server never runs.
		name: 'a value changed by a function handed to a call the render makes',
		says: 'changed by a function this render calls',
		source:
			"<script>import { untrack } from 'svelte'; let { data } = $props(); let seen = 0;" +
			' untrack(() => { seen += 1 });</script><p>{data.a}{seen}</p>',
	},
	{
		// And through the script's own statements, which Svelte puts ahead of the template: a
		// statement assigning through a call is the rule that refuses a direct one, one level in.
		// `let promise; new_promise()` left `{#await promise}` taking the wrong branch.
		name: 'a value changed by a function the script itself calls',
		says: 'changed by a function this render calls',
		source:
			'<script>let { data } = $props(); let seen = 0;' +
			' function bump() { seen += 1 } bump();</script><p>{data.a}{seen}</p>',
	},
	{
		// The same through a declaration rather than the markup: reading `first` writes `tick()` out
		// where the render evaluates it, so the call is made and what it changes is lost.
		name: 'a value changed by a function a declaration the markup reads calls',
		says: 'changed by a function this render calls',
		source:
			'<script>let { data } = $props(); const seen = [];' +
			' function tick() { seen.push(1); return seen.length; }' +
			' const first = tick();</script><p>{data.a}{first}|{seen.length}</p>',
	},
	{
		// The other reading of a marker that does not come back, and the one that is a fault: the
		// component wrote something it computed from the value rather than the value. Rendering
		// again with a different one in its place changes the bytes, which is what says so -- and
		// what keeps the relaxation beside this from covering it.
		name: 'a value a child is given and transforms',
		beside: {
			Chews: '<script>let { tag, ...rest } = $props();</script><i>{tag.toUpperCase()}</i>',
		},
		source:
			"<script>import Chews from './Chews.svelte'; let { data } = $props();</script>" +
			'<Chews tag={data.a}>{#snippet extra()}<u>e</u>{/snippet}</Chews>',
	},
];

/** Where one case's files go: its own directory under the staging root, named for the case. */
function staged(at: string): string {
	return resolve(staging, at);
}

/** Compiles one case, and says either what it produced or why it was turned away. */
async function attempt(
	one: Case,
	at: string,
): Promise<{
	ir?: Parameters<typeof inject>[0];
	derivations?: Derivation[];
	/** What the expressions call into, which a spread needs: `attributes` is Svelte's own. */
	carried?: string;
	refusal?: string;
}> {
	// A directory of its own per case. The siblings a case writes are named by the case, and two
	// cases naming a sibling alike in one directory made the later one overwrite the earlier --
	// silently, and read as an oracle rendering the wrong component. Three times before it was
	// found; the third was a `Calls.svelte` in two cases.
	const dir = staged(at);
	mkdirSync(dir, { recursive: true });
	const file = resolve(dir, 'entry.svelte');
	for (const [name, source] of Object.entries(one.beside ?? {})) {
		writeFileSync(resolve(dir, `${name}.svelte`), source);
	}
	for (const [name, source] of Object.entries(one.alongside ?? {})) {
		writeFileSync(resolve(dir, name), source);
	}
	for (const [name, source] of Object.entries(one.installed ?? {})) {
		const at = resolve(dir, 'node_modules', name);
		mkdirSync(dirname(at), { recursive: true });
		writeFileSync(at, source);
	}
	writeFileSync(file, one.source);
	try {
		const rendered = await skeleton(file, staging, new Map(Object.entries(one.fixed ?? {})));
		const lowered = lower([[one.name, JSON.stringify(rendered)]])[0];
		if (lowered === undefined) return { refusal: 'nothing came back from lowering' };
		if ('error' in lowered) return { refusal: lowered.error };
		// Through `joined`, which is what a build goes through even for a component with one
		// structure: it is where the entry's prop defaults become derivations, and skipping it here
		// meant the check and the build compiled the same component two ways.
		const compiled = joined(
			one.name,
			[{ fixed: new Map(), decided: new Map(), compiled: lowered as never }],
			rendered.defaults,
		);
		return {
			ir: compiled.ir as Parameters<typeof inject>[0],
			derivations: compiled.derivations as Derivation[],
			// Gathered by the function the build gathers with, over the same files, so what the
			// check runs is what a page runs rather than a second arrangement of the same parts.
			carried: await carry(
				file,
				new Map([...carriedBy(staging, expressionsOf(rendered)), ['*', helpers(rendered)]]),
			),
		};
	} catch (error) {
		return { refusal: (error as Error).message };
	}
}

beforeAll(() => mkdirSync(staging, { recursive: true }));
afterAll(() => rmSync(staging, { recursive: true, force: true }));

// Svelte hashes a component's filename into the anchor that opens a `<svelte:head>` block and into
// the class that scopes a `<style>`, after making it relative to `rootDir` -- which defaults to
// `process.cwd()`. Left at the default, the directory the build ran from would be in the response
// bytes, and two people building one commit from different places would get different artifacts.
it('renders the same bytes from any working directory', async () => {
	const source = `${PROPS}<svelte:head><title>{data.a}</title></svelte:head><p>{data.a}</p>`;
	const file = resolve(staging, 'rooted.svelte');
	mkdirSync(staging, { recursive: true });
	writeFileSync(file, source);

	const before = process.cwd();
	const here = await skeleton(file, staging);
	process.chdir(tmpdir());
	try {
		expect(await skeleton(file, staging)).toEqual(here);
	} finally {
		process.chdir(before);
	}
});

// A default stands over the payload's key, not over each read of it, and this is the difference
// measured. Rewriting the reads is correct and was written first: `data_0.title` became
// `(typeof data_0 === 'undefined' ? null : data_0).title`, which is no longer a path, so every read
// of every prop with a default became a derivation -- and Kit's generated root declares
// `data_0 = null` per level of the route, so that was every read on every page of a real site. The
// bytes agree either way, which is why this asks the artifact rather than the output.
it('a default leaves a read of the prop a path, and costs one derivation', async () => {
	const source =
		'<script>let { form, page, data_0 = null } = $props();</script>' +
		'<h1>{data_0.title}</h1><p>{data_0.body}</p><a href={page.url}>{data_0.tag}</a>';
	const dir = staged('paths');
	mkdirSync(dir, { recursive: true });
	const file = resolve(dir, 'entry.svelte');
	writeFileSync(file, source);

	const rendered = await skeleton(file, staging);
	const lowered = lower([['paths', JSON.stringify(rendered)]])[0];
	if (lowered === undefined || 'error' in lowered) throw new Error('it did not compile');
	const compiled = joined(
		'paths',
		[{ fixed: new Map(), decided: new Map(), compiled: lowered as never }],
		rendered.defaults,
	);

	// One per prop, however many times the markup reads it: the one with a default holds it, and
	// the rest stand over their key holding `undefined`, which is what puts the name in scope for
	// a request that did not send it. Only the first compiles an expression.
	expect(compiled.derivations.map((one) => one.name)).toEqual(['form', 'page', 'data_0']);
	expect(compiled.derivations.filter((one) => one.expression !== 'undefined')).toHaveLength(1);
	const text = JSON.stringify(compiled.ir);
	for (const path of ['data_0.title', 'data_0.body', 'data_0.tag', 'page.url']) {
		expect(text, `\`${path}\` stopped being a path`).toContain(`"path":"${path}"`);
	}
});

describe('what the compiler accepts, it reproduces byte for byte', () => {
	it.each(accepted.map((one, at) => [one.name, one, at] as const))('%s', async (_name, one, at) => {
		const { ir, derivations, carried, refusal } = await attempt(one, `ok-${at}`);
		expect(refusal, 'it was refused instead, so the surface has moved').toBeUndefined();

		const dir = staged(`ok-${at}`);
		const file = resolve(dir, 'entry.svelte');
		const out = resolve(dir, 'entry.js');
		// The same `rootDir` the compiler used. Svelte hashes the filename, relative to it, into a
		// head anchor and into a scoped class, so an oracle rooted elsewhere renders a different
		// component. See spec/build.md.
		let code = compile(one.source, {
			generate: 'server',
			name: 'C',
			filename: file,
			rootDir: staging,
		}).js.code;
		// Bundled the way a page is, because Node cannot load a `.svelte` and this oracle is Node:
		// every component the entry reaches -- a sibling, a package's through its `exports` under
		// the `svelte` condition -- is compiled where it sits and its runes modules with it, and
		// Svelte's own runtime stays external so the render runs one copy of it.
		writeFileSync(out, code);
		const bundle = await rolldown({
			input: out,
			platform: 'node',
			resolve: { conditionNames: ['svelte', 'import', 'default'] },
			external: [/^svelte(?:\/|$)/],
			logLevel: 'silent',
			plugins: [
				{
					name: 'svelte',
					load(id) {
						if (id.endsWith('.svelte')) {
							return compile(readFileSync(id, 'utf8'), {
								generate: 'server',
								name: basename(id, '.svelte'),
								filename: id,
								rootDir: staging,
							}).js.code;
						}
						if (/\.svelte\.(?:js|ts)$/.test(id)) {
							const text = readFileSync(id, 'utf8');
							const source = id.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
							return compileModule(source, { generate: 'server', filename: id }).js.code;
						}
						return null;
					},
				},
			],
		});
		const { output } = await bundle.generate({ format: 'es' });
		await bundle.close();
		const [chunk] = output;
		if (chunk === undefined) throw new Error('nothing came out of bundling the oracle');
		writeFileSync(out, chunk.code);
		const mod = (await import(pathToFileURL(out).href)) as {
			default: Parameters<typeof render>[0];
		};

		// Through `derive`, not around it. Injecting `{ data }` alone leaves every derived field
		// undefined, so an accepted case that produced one rendered empty and matched nothing --
		// which stayed invisible for as long as every accepted case here happened to have none.
		const derive = compileDerivations(derivations ?? [], carried ?? '');
		const payloads = one.props ?? (one.data ?? []).map((data) => ({ data }));
		for (const props of payloads) {
			// Both streams. The head used to go uncompared, and a headed component inside a body
			// block compiled to a head that held its block whichever branch the request took.
			const ours = inject(ir as Parameters<typeof inject>[0], derive(props));
			const theirs = render(mod.default, { props: props as never });
			expect(ours.body).toBe(theirs.body);
			expect(ours.head).toBe(theirs.head);
		}
	});
});

describe('what it refuses, it refuses by saying where the question lives', () => {
	it.each(refused.map((one, at) => [one.name, one, at] as const))('%s', async (_name, one, at) => {
		const { refusal } = await attempt(one, `no-${at}`);
		expect(refusal, 'it compiled instead, so the surface has moved').toBeDefined();
		// Checked rather than trusted. Four of these used to be a TypeError escaping from inside
		// the sentinel pass, which is an internal stack rather than anything an author can act on.
		expect(refusal, 'the message names no specification file').toContain('spec/');
		if (one.says !== undefined) expect(refusal).toContain(one.says);
	});
});
