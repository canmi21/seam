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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carry } from 'carry';
import { compile as compileDerivations, type Derivation } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { skeleton } from './skeleton.ts';

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
	/** Sibling files the case imports, by name without the extension. Composition needs two. */
	beside?: Record<string, string>;
	/**
	 * Payload paths this render is fixed at, as literal source text. The payloads below have to
	 * agree with them, since the oracle is given the whole of the data and renders what it says.
	 */
	fixed?: Record<string, string>;
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
		// Three the visitor drops on the way out: `bind:this` is client-only, and `value` is
		// skipped on a select and on a file input because the attribute has no effect there.
		name: 'the bindings the server drops',
		source:
			'<script>let { data } = $props(); let el; let v = $state(data.a)</script>' +
			'<div bind:this={el}>{data.a}</div><select bind:value={v}><option>a</option></select>' +
			'<input type="file" bind:value={v} />',
		data: [{ a: 'v' }],
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
		// indices that by then belonged to somebody else. `{#key}` is the refusal here because it
		// writes no anchors, so what is left is the rollback and nothing else.
		name: 'a descent that stops takes its records back with it',
		beside: {
			Shed: '<script>let { children, ...rest } = $props();</script><div>{@render children()}</div>',
			Stops:
				"<script>import Shed from './Shed.svelte'; let { v } = $props();</script>" +
				'<Shed><b>{v}</b></Shed>{#key v}<i>k</i>{/key}',
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
		// A key is not carried at all: Svelte's server transform never mentions one, and a keyed each
		// renders byte for byte what an unkeyed one renders. The counter is bound beside the item,
		// which is what the `for` loop it compiles to does. See spec/ir.md.
		name: 'an each with a key and an index',
		source: `${PROPS}{#each data.xs as x, n (x)}<i>{n}:{x}</i>{/each}`,
		data: [{ xs: ['a', 'b'] }, { xs: [] }],
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
		source:
			'<script>function act() {} let { data } = $props()</script>' +
			'<svelte:window /><svelte:body /><div use:act onclick={() => {}}>{data.a}</div>{@debug data}',
		data: [{ a: 'v' }],
	},
];

// Each one is a gap rather than a boundary, and the message has to say which.
const refused: Case[] = [
	{
		// A directive removes its own name from the class it was given, so which bytes exist is
		// decided by a string that only exists per request. See spec/refusals.md.
		name: 'class: beside a class attribute that is an expression',
		source: `${PROPS}<p class={data.a} class:on={data.f}>x</p>`,
	},
	{
		// Svelte joins text and an expression into one value; this reads a single expression.
		name: 'a style directive mixing text and an expression',
		source: `${PROPS}<p style:width="{data.a}px">x</p>`,
	},

	{ name: 'svelte:boundary', source: `${PROPS}<svelte:boundary><p>{data.a}</p></svelte:boundary>` },
	{ name: 'await block', source: `${PROPS}{#await data.p}<p>w</p>{:then v}<p>{v}</p>{/await}` },
	{ name: 'key block', source: `${PROPS}{#key data.k}<p>{data.a}</p>{/key}` },
	{
		name: 'a snippet parameter with a default',
		source: `${PROPS}{#snippet r({ a = 1 })}<p>{a}</p>{/snippet}{@render r(data.o)}`,
	},
	{
		name: 'a snippet rendered with the wrong number of arguments',
		source: `${PROPS}{#snippet r(a, b)}<p>{a}</p>{/snippet}{@render r(data.a)}`,
	},
	{
		// Written inside a component's tag, so it is a prop that component receives. The child calls
		// it, and with what is not visible from here. One with no parameters has nothing to decide,
		// and that one works -- it is what `{@render children()}` is.
		name: 'a snippet passed to a component, with parameters',
		source: `${PROPS}<b>{data.a}</b>{#snippet row(r)}<i>{r}</i>{/snippet}`,
	},
	{
		// The other side of what a component may supply. A parameter only ever rendered is markup
		// the component writes, and needs nothing put in its place; one read as a value does, and
		// there is nothing to put there -- bits-ui's `{#snippet children({ checked })}` is this,
		// with `checked` decided by a state machine inside the package.
		name: 'a snippet a component supplies a value to, not markup',
		beside: { Feeds: '<script>let { row, ...rest } = $props();</script><p>{@render row?.(1)}</p>' },
		source:
			"<script>import Feeds from './Feeds.svelte'; let { data } = $props();</script>" +
			'<Feeds>{#snippet row(n)}<i class={n > 0 ? "up" : "down"}>{data.a}</i>{/snippet}</Feeds>',
	},
	{
		// The same rule a snippet's parameter follows: a default is neither a member nor an index
		// of the element, so there is no way in to write down.
		name: 'an each pattern with a default',
		source: `${PROPS}{#each data.rows as { id = 1 }}<i>{id}</i>{/each}`,
	},
	{
		// Written as the element's content rather than as an attribute, so it replaces the children
		// rather than standing among them. See spec/refusals.md.
		name: 'bind:innerHTML',
		source:
			`${PROPS}<script>let v = $state()</script><div contenteditable bind:innerHTML={v}></div>`.replace(
				'</script><script>',
				'; ',
			),
	},
	{
		// `checked`, computed from this value together with the element's own `value` attribute.
		name: 'bind:group',
		source:
			`${PROPS}<script>let v = $state()</script><input type="radio" value="a" bind:group={v} />`.replace(
				'</script><script>',
				'; ',
			),
	},
	{
		// A snippet that renders itself. Duplicating per call site is what makes a repeated render
		// work, and a recursion has no fixed number of call sites to duplicate for.
		name: 'a snippet that renders itself',
		source: `${PROPS}{#snippet h(v)}<p>{v}</p>{@render h(v)}{/snippet}{@render h(data.a)}`,
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
		name: 'else on an each',
		source: `${PROPS}{#each data.xs as x}<p>{x}</p>{:else}<p>none</p>{/each}`,
	},
	{
		// A rune Svelte has but this does not substitute. `$props.id()` is a value the server and the
		// client each generate, which is the shape spec/derivation.md refuses as ambient.
		name: 'a rune that is not substituted',
		source: '<script>let { data } = $props(); const k = $props.id()</script><p>{data.a}{k}</p>',
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
	{ name: 'translate as a boolean', source: `${PROPS}<p translate={true}>{data.a}</p>` },
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
			'<Chews tag={data.a} />',
	},
];

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
	const file = resolve(staging, `${at}.svelte`);
	for (const [name, source] of Object.entries(one.beside ?? {})) {
		writeFileSync(resolve(staging, `${name}.svelte`), source);
	}
	writeFileSync(file, one.source);
	try {
		const rendered = await skeleton(file, staging, new Map(Object.entries(one.fixed ?? {})));
		const compiled = lower([[one.name, JSON.stringify(rendered)]])[0];
		if (compiled === undefined) return { refusal: 'nothing came back from lowering' };
		if ('error' in compiled) return { refusal: compiled.error };
		return {
			ir: compiled.ir as Parameters<typeof inject>[0],
			derivations: compiled.derivations as Derivation[],
			// The same list `pkgs/compiler` adds, so what the check runs is what a page runs.
			carried: rendered.holes.some((hole) => hole.spread === true)
				? await carry(file, [
						{ local: 'attributes', from: 'svelte/internal/server', kind: 'named' },
					])
				: '',
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

describe('what the compiler accepts, it reproduces byte for byte', () => {
	it.each(accepted.map((one, at) => [one.name, one, at] as const))('%s', async (_name, one, at) => {
		const { ir, derivations, carried, refusal } = await attempt(one, `ok-${at}`);
		expect(refusal, 'it was refused instead, so the surface has moved').toBeUndefined();

		const file = resolve(staging, `ok-${at}.svelte`);
		const out = resolve(staging, `ok-${at}.js`);
		// The same `rootDir` the compiler used. Svelte hashes the filename, relative to it, into a
		// head anchor and into a scoped class, so an oracle rooted elsewhere renders a different
		// component. See spec/build.md.
		let code = compile(one.source, {
			generate: 'server',
			name: 'C',
			filename: file,
			rootDir: staging,
		}).js.code;
		// A sibling the case imports is compiled beside it and every specifier pointed at the
		// result, because Node cannot load a `.svelte` and this oracle is Node. Every file, not
		// only the entry: a child of a child imports its own.
		const siblings = Object.entries(one.beside ?? {}).map(([name, source]) => ({
			name,
			at: resolve(staging, `${name}.js`),
			code: compile(source, {
				generate: 'server',
				name,
				filename: resolve(staging, `${name}.svelte`),
				rootDir: staging,
			}).js.code,
		}));
		const point = (text: string): string => {
			let out = text;
			for (const sibling of siblings) {
				out = out.replace(
					new RegExp(`(['"])\\./${sibling.name}\\.svelte\\1`),
					JSON.stringify(pathToFileURL(sibling.at).href),
				);
			}
			return out;
		};
		for (const sibling of siblings) writeFileSync(sibling.at, point(sibling.code));
		writeFileSync(out, point(code));
		const mod = (await import(pathToFileURL(out).href)) as {
			default: Parameters<typeof render>[0];
		};

		// Through `derive`, not around it. Injecting `{ data }` alone leaves every derived field
		// undefined, so an accepted case that produced one rendered empty and matched nothing --
		// which stayed invisible for as long as every accepted case here happened to have none.
		const derive = compileDerivations(derivations ?? [], carried ?? '');
		for (const data of one.data ?? []) {
			expect(inject(ir as Parameters<typeof inject>[0], derive(data)).body).toBe(
				render(mod.default, { props: { data } as never }).body,
			);
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
	});
});
