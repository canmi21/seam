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
import { prepare, structures } from './compile.ts';

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

// A package the walk cannot enter which *calls* what it is given. A marker there is a string
// where a function was expected, and the render stops inside the package.
const CALLER = '<script>let { say, ...rest } = $props();</script><i>{say()}</i>';

// The value is chosen by a `?:` over the request, between three functions, two of them one
// ternary deeper. Every branch is the same every request once chosen, so each is left for Svelte
// to evaluate rather than marked.
const CHOOSING =
	"<script>import Say from './say.svelte'; let { data } = $props();" +
	" const none = () => 'none'; const one = () => 'one'; const many = () => 'many';" +
	' const pick = $derived(data.n === 0 ? none : data.n === 1 ? one : many);</script>' +
	'<Say say={pick} /><p>{data.title}</p>';

beforeAll(() => {
	mkdirSync(staging, { recursive: true });
	writeFileSync(resolve(staging, 'greet.svelte'), CHILD);
	writeFileSync(resolve(staging, 'page.svelte'), PAGE);
	writeFileSync(resolve(staging, 'say.svelte'), CALLER);
	writeFileSync(resolve(staging, 'choosing.svelte'), CHOOSING);
});
afterAll(() => rmSync(staging, { recursive: true, force: true }));

/** Svelte's own render of a page importing one child, which is the bytes every structure owes. */
async function oracle(
	page: [name: string, source: string],
	child: [name: string, source: string],
	data: unknown,
): Promise<string> {
	const tag = String(Math.random()).slice(2);
	const out = resolve(staging, `oracle-${tag}.js`);
	const compiled = resolve(staging, `${child[0]}-${tag}.js`);
	const named = (name: string): string => name[0]?.toUpperCase() + name.slice(1);
	writeFileSync(
		compiled,
		svelte(child[1], {
			generate: 'server',
			name: named(child[0]),
			filename: resolve(staging, `${child[0]}.svelte`),
			rootDir: staging,
		}).js.code,
	);
	writeFileSync(
		out,
		svelte(page[1], {
			generate: 'server',
			name: named(page[0]),
			filename: resolve(staging, `${page[0]}.svelte`),
			rootDir: staging,
		}).js.code.replace(`'./${child[0]}.svelte'`, JSON.stringify(pathToFileURL(compiled).href)),
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
			runs.map((one, at) => ({
				fixed: one.fixed,
				decided: new Map(),
				compiled: lowered[at] as unknown as Structure,
			})),
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
			expect(inject(structure.ir, derive({ data })).body, `locale ${code}`).toBe(
				await oracle(['page', PAGE], ['greet', CHILD], data),
			);
		}

		const outside = { locale: { code: 'ja' }, title: 'x', tags: [] };
		expect(inject(structure.ir, derive({ data: outside })).body).toBe('');
	});
});

describe('a `?:` in a value handed to a component the walk cannot enter', () => {
	it('is compiled once per branch, and each branch renders what Svelte renders', async () => {
		const runs = await structures({ path: '/', component: 'choosing.svelte' }, staging);
		// A tree rather than a product: the outer ternary's taken branch holds no further choice,
		// so it is one structure, and only the other branch is asked about again.
		expect(runs.map((one) => [...one.decided.values()])).toEqual([
			[true],
			[false, true],
			[false, false],
		]);

		const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
		for (const one of lowered) {
			expect(one !== undefined && 'error' in one ? one.error : undefined).toBeUndefined();
		}
		const structure = joined(
			'choosing',
			runs.map((one, at) => ({
				fixed: one.fixed,
				decided: one.decided,
				compiled: lowered[at] as unknown as Structure,
			})),
		);
		const [top] = structure.ir.body;
		expect(top?.t).toBe('if');
		expect(top?.t === 'if' && top.branches.length).toBe(3);

		const derive = deriving(structure.derivations, '');
		for (const n of [0, 1, 2]) {
			const data = { n, title: `t${String(n)}` };
			expect(inject(structure.ir, derive({ data })).body, `n ${String(n)}`).toBe(
				await oracle(['choosing', CHOOSING], ['say', CALLER], data),
			);
		}
	});
});
