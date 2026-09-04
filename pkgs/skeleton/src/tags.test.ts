// The copied lists, held against the thing they were copied from.
//
// `tags.ts` names what a tag decides about the bytes around it: whether the element writes
// children and a closing tag, whether an empty comment precedes that closing tag, and whether
// Svelte will write the tag at all. All three are read by `element()` in Svelte's server runtime,
// and all three are copied here because the compiler writes them into an expression rather than
// into a runtime. A copy goes stale quietly, so each name is rendered and held to what it does.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, describe, expect, it } from 'vitest';
import { RAW_TEXT_ELEMENTS, VALID_TAG_NAME, VOID_ELEMENTS } from './tags.ts';

const staging = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-tags');

let at = 0;
async function bytes(tag: unknown): Promise<string> {
	mkdirSync(staging, { recursive: true });
	const source =
		'<script>let { t } = $props()</script><svelte:element this={t}>x</svelte:element>';
	const code = compile(source, { generate: 'server', name: 'C', filename: 'c.svelte' }).js.code;
	const out = resolve(staging, `c${at++}.js`);
	writeFileSync(out, code);
	const mod = (await import(pathToFileURL(out).href)) as { default: Parameters<typeof render>[0] };
	return render(mod.default, { props: { t: tag } as never }).body;
}

afterAll(() => rmSync(staging, { recursive: true, force: true }));

describe('a tag the list calls void writes no children and no closing tag', () => {
	it.each([...VOID_ELEMENTS])('%s', async (tag) => {
		expect(await bytes(tag)).toBe(`<!--[--><!----><${tag}><!----><!--]-->`);
	});
});

describe('a tag the list calls raw text writes children with no comment before the close', () => {
	it.each([...RAW_TEXT_ELEMENTS])('%s', async (tag) => {
		expect(await bytes(tag)).toBe(`<!--[--><!----><${tag}>x</${tag}><!----><!--]-->`);
	});
});

// The other direction, so a list that only ever grows is caught: an ordinary tag has to write
// both the children and the empty comment the other two leave out.
describe('a tag on neither list writes both', () => {
	it.each(['h2', 'div', 'span', 'p'])('%s', async (tag) => {
		expect(await bytes(tag)).toBe(`<!--[--><!----><${tag}>x<!----></${tag}><!----><!--]-->`);
	});
	it('and a falsy tag writes nothing between the comments', async () => {
		expect(await bytes(null)).toBe('<!--[--><!----><!----><!--]-->');
	});
});

// The regex decides which names Svelte will write at all. It is copied as source, because it is
// written into an expression the artifact carries, so what it accepts has to be what Svelte
// accepts -- and what it rejects, Svelte throws for, where a compiled artifact writes nothing.
describe('the tag name regex is the one Svelte tests against', () => {
	const pattern = new RegExp(
		VALID_TAG_NAME.slice(1, VALID_TAG_NAME.lastIndexOf('/')),
		VALID_TAG_NAME.slice(VALID_TAG_NAME.lastIndexOf('/') + 1),
	);

	it.each(['h2', 'div', 'my-element', 'x'])('accepts %s, and so does Svelte', async (tag) => {
		expect(pattern.test(tag)).toBe(true);
		await expect(bytes(tag)).resolves.toContain(`<${tag}`);
	});

	// The empty string is not one of them: it is falsy, so `element()` never reaches the regex and
	// writes nothing between the comments, which is the same answer from a different branch.
	it.each(['a<b', '1h', 'a b'])('rejects %s, where Svelte throws', async (tag) => {
		expect(pattern.test(tag)).toBe(false);
		await expect(bytes(tag)).rejects.toThrow();
	});
});
