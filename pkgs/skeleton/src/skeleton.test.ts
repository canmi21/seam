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
		data: [{ a: 'v', b: 'c' }, { a: '', b: null }],
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
		data: [{ a: true, b: true }, { a: false, b: true }, { a: false, b: false }],
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
	{ name: 'style: directive', source: `${PROPS}<p style:color={data.a}>x</p>` },
	{ name: 'a spread', source: `${PROPS}<p {...data.attrs}>x</p>` },
	{
		// A binding the server writes. There is nowhere to plant the marker: `bind:` takes a name
		// rather than an expression. See spec/refusals.md.
		name: 'a bind: the server writes',
		source: `${PROPS}<script>let v = 1</script><input bind:value={v} />`.replace(
			'</script><script>',
			'; ',
		),
	},
	{ name: 'svelte:element', source: `${PROPS}<svelte:element this={data.tag}>x</svelte:element>` },
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
		// The same rule a snippet's parameter follows: a default is neither a member nor an index
		// of the element, so there is no way in to write down.
		name: 'an each pattern with a default',
		source: `${PROPS}{#each data.rows as { id = 1 }}<i>{id}</i>{/each}`,
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
		// Not the const tag: what it holds. A derivation is computed once against the payload, so one
		// that reads a name an each block binds per item has nothing to be computed from. It used to
		// compile and throw at request time. See spec/derivation.md.
		name: 'an expression over what an each binds',
		source: `${PROPS}{#each data.xs as x}<p>{x > 2}</p>{/each}`,
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

];

/** Compiles one case, and says either what it produced or why it was turned away. */
async function attempt(
	one: Case,
	at: string,
): Promise<{
	ir?: Parameters<typeof inject>[0];
	derivations?: Derivation[];
	refusal?: string;
}> {
	const file = resolve(staging, `${at}.svelte`);
	writeFileSync(file, one.source);
	try {
		const compiled = lower([[one.name, JSON.stringify(await skeleton(file, staging))]])[0];
		if (compiled === undefined) return { refusal: 'nothing came back from lowering' };
		if ('error' in compiled) return { refusal: compiled.error };
		return {
			ir: compiled.ir as Parameters<typeof inject>[0],
			derivations: compiled.derivations as Derivation[],
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
		const { ir, derivations, refusal } = await attempt(one, `ok-${at}`);
		expect(refusal, 'it was refused instead, so the surface has moved').toBeUndefined();

		const file = resolve(staging, `ok-${at}.svelte`);
		const out = resolve(staging, `ok-${at}.js`);
		writeFileSync(
			out,
			// The same `rootDir` the compiler used. Svelte hashes the filename, relative to it, into a
			// head anchor and into a scoped class, so an oracle rooted elsewhere renders a different
			// component. See spec/build.md.
			compile(one.source, { generate: 'server', name: 'C', filename: file, rootDir: staging }).js
				.code,
		);
		const mod = (await import(pathToFileURL(out).href)) as {
			default: Parameters<typeof render>[0];
		};

		// Through `derive`, not around it. Injecting `{ data }` alone leaves every derived field
		// undefined, so an accepted case that produced one rendered empty and matched nothing --
		// which stayed invisible for as long as every accepted case here happened to have none.
		const derive = compileDerivations(derivations ?? []);
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
