/**
 * Awaits: a value awaited at the build, and one the request decides awaited per request.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
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
		// `await_block` in `internal/server/index.js` branches on `is_promise(promise)`, which is
		// `typeof value?.then === 'function'` -- the same words this walk writes. A test the request
		// does not decide is the render's to answer, the way an if's is, and the answer holds for
		// every request: `{#await p}` over a promise this file makes writes the pending branch
		// always, and the then branch is markup nobody reaches.
		name: 'an `{#await}` over a promise this file makes',
		source:
			'<script>export let a; const held = Promise.resolve([1, 2]);</script>' +
			'{#await held}<p>waiting</p>{:then rows}{#each rows.filter((r) => r > 1) as r}<i>{r}</i>{/each}{/await}<b>{a}</b>',
		props: [{ a: 'x' }],
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
];
