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
		name: 'markup that is inert on the server',
		source:
			'<script>function act() {} let { data } = $props()</script>' +
			'<svelte:window /><svelte:body /><div use:act onclick={() => {}}>{data.a}</div>{@debug data}',
		data: [{ a: 'v' }],
	},
];

// Each one is a gap rather than a boundary, and the message has to say which.
const refused: Case[] = [
	{ name: 'class: directive', source: `${PROPS}<p class:on={data.f}>x</p>` },
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
		name: 'snippet and render',
		source: `${PROPS}{#snippet r(v)}<p>{v}</p>{/snippet}{@render r(data.a)}`,
	},
	{ name: 'const tag', source: `${PROPS}{#each data.xs as x}{@const u = x}<p>{u}</p>{/each}` },
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
		name: 'a block inside an else',
		source: `${PROPS}{#if data.f}<p>a</p>{:else}{#if data.g}<p>b</p>{/if}{/if}`,
	},
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
