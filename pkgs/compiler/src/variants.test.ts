/**
 * A route compiled once per value of a declared domain, held to Svelte's own output for each.
 *
 * The claim is not that the join produces something well shaped. It is that **each structure is
 * the one Svelte renders for that value**, which only an oracle can say -- so every value is
 * injected and compared against a real render with the matching payload.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile as svelte } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile as deriving } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { combinations, joined, type Structure } from './variants.ts';
import { prepare } from './compile.ts';

const staging = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-variants');

// A package the walk cannot enter -- its `$props()` gathers a rest -- which decides on the value
// it is given rather than writing it out. A marker there is a string nobody chose.
const CHILD =
	'<script>let { tag, ...rest } = $props();</script>' +
	"{#if tag === 'en'}<i>hello</i>{:else if tag === 'fr'}<i>bonjour</i>{:else}<i>{tag}</i>{/if}";

const PAGE =
	"<script>import Greet from './greet.svelte'; let { data } = $props();" +
	' const loc = data.locale.code;</script>' +
	'<Greet tag={loc} /><p>{data.title}</p>' +
	'{#each data.tags as t}<b>{t}</b>{/each}';

const LOCALES = ['en', 'fr', 'de'];

beforeAll(() => {
	mkdirSync(staging, { recursive: true });
	writeFileSync(resolve(staging, 'greet.svelte'), CHILD);
	writeFileSync(resolve(staging, 'page.svelte'), PAGE);
});
afterAll(() => rmSync(staging, { recursive: true, force: true }));

async function oracle(data: unknown): Promise<string> {
	const out = resolve(staging, `oracle-${String(Math.random()).slice(2)}.js`);
	const child = resolve(staging, `greet-${String(Math.random()).slice(2)}.js`);
	writeFileSync(
		child,
		svelte(CHILD, {
			generate: 'server',
			name: 'Greet',
			filename: resolve(staging, 'greet.svelte'),
			rootDir: staging,
		}).js.code,
	);
	writeFileSync(
		out,
		svelte(PAGE, {
			generate: 'server',
			name: 'Page',
			filename: resolve(staging, 'page.svelte'),
			rootDir: staging,
		}).js.code.replace(/'\.\/greet\.svelte'/, JSON.stringify(pathToFileURL(child).href)),
	);
	const mod = (await import(pathToFileURL(out).href)) as { default: unknown };
	return render(mod.default as never, { props: { data } as never }).body;
}

describe('a route compiled once per value of a declared domain', () => {
	it('renders what Svelte renders, for every value in it', async () => {
		const domain = { 'data.locale.code': LOCALES };
		const runs = [];
		for (const fixed of combinations(domain)) {
			const one = await prepare(resolve(staging, 'page.svelte'), staging, fixed);
			runs.push({ fixed, skeleton: one.skeleton, id: one.id });
		}
		const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
		for (const one of lowered) {
			expect(one !== undefined && 'error' in one ? one.error : undefined).toBeUndefined();
		}
		const structure = joined(
			'page',
			runs.map((one, at) => ({ fixed: one.fixed, compiled: lowered[at] as unknown as Structure })),
		);

		// One if, one branch per value, and no else: a value the build did not declare has no
		// structure here, and handing it somebody else's would be the one thing this compiler must
		// not do. Measured before it was changed: `ja` rendered the German page.
		const [top] = structure.ir.body;
		expect(top?.t).toBe('if');
		expect(top?.t === 'if' && top.branches.length).toBe(LOCALES.length);
		expect(top?.t === 'if' && top.branches.every((one) => one.test !== null)).toBe(true);

		const derive = deriving(structure.derivations, '');
		for (const code of LOCALES) {
			const data = { locale: { code }, title: '<&', tags: ['x', 'y'] };
			expect(inject(structure.ir, derive(data)).body, `locale ${code}`).toBe(await oracle(data));
		}

		const outside = { locale: { code: 'ja' }, title: 'x', tags: [] };
		expect(inject(structure.ir, derive(outside)).body).toBe('');
	});
});
