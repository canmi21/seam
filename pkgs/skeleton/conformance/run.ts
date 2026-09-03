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
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { inject } from 'injector';
import { lower } from 'lowering';
import { skeleton } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const staging = resolve(here, '.build');

const PROPS = '<script>let { data } = $props()</script>';

interface Case {
	name: string;
	source: string;
	/**
	 * The payloads the shape turns on. An each block needs an empty list as well as a full one,
	 * an if needs both branches: a construct only has to be wrong on the payload nobody tried.
	 */
	data?: unknown[];
	expect: 'accepted' | 'refused';
}

const cases: Case[] = [
	// Accepted, and held to Svelte's own bytes on every payload below.
	{
		name: 'a value, a branch and a list',
		source: `${PROPS}<p>{data.a}</p>{#if data.f}<b>{data.a}</b>{/if}{#each data.xs as x}<i>{x}</i>{/each}`,
		data: [
			{ a: 'v', f: true, xs: ['q', 'r'] },
			{ a: '<&"', f: false, xs: [] },
		],
		expect: 'accepted',
	},
	{
		name: 'raw html',
		source: `${PROPS}<p>{@html data.a}</p>`,
		data: [{ a: '<b>x</b>' }, { a: '' }],
		expect: 'accepted',
	},
	{
		name: 'the head and a title',
		source: `${PROPS}<svelte:head><meta name="d" content={data.a} /><title>{data.a}</title></svelte:head><p>x</p>`,
		data: [{ a: 'v' }, { a: null }],
		expect: 'accepted',
	},
	{
		name: 'markup that is inert on the server',
		source:
			'<script>function act() {} let { data } = $props()</script>' +
			'<svelte:window /><svelte:body /><div use:act onclick={() => {}}>{data.a}</div>{@debug data}',
		data: [{ a: 'v' }],
		expect: 'accepted',
	},

	// Refused. Each one is a gap rather than a boundary, and the message has to say which.
	{
		name: 'a style block',
		source: `${PROPS}<p class="x">{data.a}</p><style>.x{color:red}</style>`,
		expect: 'refused',
	},
	{ name: 'class: directive', source: `${PROPS}<p class:on={data.f}>x</p>`, expect: 'refused' },
	{ name: 'style: directive', source: `${PROPS}<p style:color={data.a}>x</p>`, expect: 'refused' },
	{ name: 'a spread', source: `${PROPS}<p {...data.attrs}>x</p>`, expect: 'refused' },
	{ name: 'bind:', source: `${PROPS}<input bind:value={data.a} />`, expect: 'refused' },
	{
		name: 'svelte:element',
		source: `${PROPS}<svelte:element this={data.tag}>x</svelte:element>`,
		expect: 'refused',
	},
	{
		name: 'svelte:boundary',
		source: `${PROPS}<svelte:boundary><p>{data.a}</p></svelte:boundary>`,
		expect: 'refused',
	},
	{
		name: 'await block',
		source: `${PROPS}{#await data.p}<p>w</p>{:then v}<p>{v}</p>{/await}`,
		expect: 'refused',
	},
	{ name: 'key block', source: `${PROPS}{#key data.k}<p>{data.a}</p>{/key}`, expect: 'refused' },
	{
		name: 'snippet and render',
		source: `${PROPS}{#snippet r(v)}<p>{v}</p>{/snippet}{@render r(data.a)}`,
		expect: 'refused',
	},
	{
		name: 'const tag',
		source: `${PROPS}{#each data.xs as x}{@const u = x}<p>{u}</p>{/each}`,
		expect: 'refused',
	},
	{
		name: 'an each with an index',
		source: `${PROPS}{#each data.xs as x, i}<p>{i}{x}</p>{/each}`,
		expect: 'refused',
	},
	{
		name: 'an each with a key',
		source: `${PROPS}{#each data.xs as x (x)}<p>{x}</p>{/each}`,
		expect: 'refused',
	},
	{
		name: 'else on an each',
		source: `${PROPS}{#each data.xs as x}<p>{x}</p>{:else}<p>none</p>{/each}`,
		expect: 'refused',
	},
	{
		name: 'translate as a boolean',
		source: `${PROPS}<p translate={true}>{data.a}</p>`,
		expect: 'refused',
	},
	{
		name: 'a block inside an else',
		source: `${PROPS}{#if data.f}<p>a</p>{:else}{#if data.g}<p>b</p>{/if}{/if}`,
		expect: 'refused',
	},
];

let failed = 0;
const say = (ok: boolean, label: string, detail = ''): void => {
	if (ok) console.log(`match  ${label}`);
	else {
		failed += 1;
		console.error(`DIFF   ${label}${detail === '' ? '' : `\n   ${detail}`}`);
	}
};

/** Svelte's own server output, which is what an accepted construct has to reproduce. */
async function svelte(
	source: string,
	file: string,
	at: number,
): Promise<(data: unknown) => string> {
	const code = compile(source, { generate: 'server', name: 'C', filename: file }).js.code;
	const out = resolve(staging, `case-${at}.js`);
	writeFileSync(out, code);
	// Untyped on purpose: what comes back is Svelte's own compiled output, and the module's shape
	// is the compiler's rather than something this file should restate.
	const mod = (await import(pathToFileURL(out).href)) as { default: Parameters<typeof render>[0] };
	return (data) => render(mod.default, { props: { data } as never }).body;
}

mkdirSync(staging, { recursive: true });
for (const [at, one] of cases.entries()) {
	const file = resolve(staging, `case-${at}.svelte`);
	writeFileSync(file, one.source);

	let ir: Parameters<typeof inject>[0] | undefined;
	let refusal: string | undefined;
	try {
		const compiled = lower([[one.name, JSON.stringify(await skeleton(file))]])[0];
		if (compiled === undefined) refusal = 'nothing came back from lowering';
		else if ('error' in compiled) refusal = compiled.error;
		else ir = compiled.ir as Parameters<typeof inject>[0];
	} catch (error) {
		refusal = (error as Error).message;
	}

	if (one.expect === 'refused') {
		if (refusal === undefined) {
			say(false, `${one.name} is refused`, 'it compiled instead, so the surface has moved');
			continue;
		}
		say(true, `${one.name} is refused`);
		// The specification's own rule about what a message owes its reader, checked rather than
		// trusted. Four of these used to be a TypeError escaping from inside the sentinel pass.
		say(
			refusal.includes('spec/'),
			`  and says where the question lives`,
			`the message names no specification file: ${refusal}`,
		);
		continue;
	}

	if (ir === undefined) {
		say(false, `${one.name} compiles`, `it was refused: ${refusal ?? ''}`);
		continue;
	}
	say(true, `${one.name} compiles`);
	const expected = await svelte(one.source, file, at);
	for (const data of one.data ?? []) {
		const ours = inject(ir, { data }).body;
		const theirs = expected(data);
		say(
			ours === theirs,
			`  agrees with Svelte on ${JSON.stringify(data)}`,
			`svelte: ${JSON.stringify(theirs)}\n   ours:   ${JSON.stringify(ours)}`,
		);
	}
}
rmSync(staging, { recursive: true, force: true });

console.log(
	`\n${cases.filter((c) => c.expect === 'refused').length} refused, ${cases.filter((c) => c.expect === 'accepted').length} accepted`,
);
if (failed > 0) process.exit(1);
