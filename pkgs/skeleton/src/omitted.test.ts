// The copied list, held against the thing it was copied from.
//
// `omitted.ts` names the bindings Svelte's server writes nothing for. It is a copy of a table in
// Svelte's compiler, and a copy goes stale quietly: the day one of these starts writing a byte,
// this compiler would drop it and the page would be missing something with nothing to say so.
//
// So each name is rendered twice, with the binding and without it, and the two have to be the same
// bytes. That is the same arrangement as everywhere else here that depends on Svelte's behaviour --
// borrow the answer rather than reproduce it, then hold it to what it does.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, describe, expect, it } from 'vitest';
import { OMITTED_IN_SSR } from './omitted.ts';

const staging = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-omitted');
// Truthy on purpose. A boolean attribute is absent for a falsy value, so comparing the bytes with
// and without the binding would compare nothing to nothing and pass for the wrong reason.
const PROPS = '<script>let { data } = $props(); let v = 1; let el = null</script>';

// Tried in order until one compiles. Which element a binding is legal on is Svelte's business, and
// finding out by trying is what keeps this from being a second copied table.
const HOSTS: [name: string, open: string, close: string][] = [
	['window', '<svelte:window', ' />'],
	['document', '<svelte:document', ' />'],
	['video', '<video', '></video>'],
	['img', '<img', ' />'],
	['input', '<input', ' />'],
	['file input', '<input type="file"', ' />'],
	['div', '<div', '>x</div>'],
];

let at = 0;
async function bytes(source: string): Promise<string> {
	mkdirSync(staging, { recursive: true });
	const code = compile(source, { generate: 'server', name: 'C', filename: 'c.svelte' }).js.code;
	const out = resolve(staging, `c${at++}.js`);
	writeFileSync(out, code);
	const mod = (await import(pathToFileURL(out).href)) as { default: Parameters<typeof render>[0] };
	return render(mod.default, { props: { data: { a: 'v' } } as never }).body;
}

/** The bytes with the binding and the bytes without it, on the first host that accepts it. */
async function bothWays(binding: string): Promise<{ with: string; without: string } | null> {
	for (const [, open, close] of HOSTS) {
		const bound = `${PROPS}${open} bind:${binding}={${binding === 'this' ? 'el' : 'v'}}${close}<p>{data.a}</p>`;
		try {
			compile(bound, { generate: 'server', name: 'C', filename: 'c.svelte' });
		} catch {
			continue;
		}
		return {
			with: await bytes(bound),
			without: await bytes(`${PROPS}${open}${close}<p>{data.a}</p>`),
		};
	}
	return null;
}

afterAll(() => rmSync(staging, { recursive: true, force: true }));

describe('a binding the list calls omitted writes nothing', () => {
	it.each([...OMITTED_IN_SSR])('bind:%s', async (binding) => {
		const seen = await bothWays(binding);
		expect(
			seen,
			`no element accepts bind:${binding}, so the name is not what it was`,
		).not.toBeNull();
		expect(seen?.with).toBe(seen?.without);
	});
});

// The other direction. This half is spot checks rather than an enumeration: the list of bindings
// Svelte *does* write is not one this compiler keeps, so there is nothing to iterate. Each is
// written out with the element it is legal on, and has to both stay off the list and change the
// bytes -- a list that only ever grows is one that eventually swallows a binding that matters.
describe('a binding the list leaves out writes something', () => {
	const written: [name: string, bound: string, plain: string][] = [
		['value', '<input bind:value={v} />', '<input />'],
		['checked', '<input type="checkbox" bind:checked={v} />', '<input type="checkbox" />'],
		['open', '<details bind:open={v}><p>x</p></details>', '<details><p>x</p></details>'],
		['value on a textarea', '<textarea bind:value={v}></textarea>', '<textarea></textarea>'],
		['innerHTML', '<div contenteditable bind:innerHTML={v}></div>', '<div contenteditable></div>'],
	];

	it.each(written)('bind:%s', async (name, bound, plain) => {
		expect(OMITTED_IN_SSR.has(name.split(' ')[0] ?? name)).toBe(false);
		expect(await bytes(`${PROPS}${bound}`)).not.toBe(await bytes(`${PROPS}${plain}`));
	});
});
