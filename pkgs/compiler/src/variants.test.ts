/**
 * A route compiled once per value of a declared domain, held to Svelte's own output for each.
 *
 * The claim is not that the join produces something well shaped. It is that **each structure is
 * the one Svelte renders for that value**, which only an oracle can say -- so every value is
 * injected and compared against a real render with the matching payload.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile as svelte } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile as deriving } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { combinations, joined, type Structure } from './variants.ts';
import { compile as compileRoutes, prepare, structures } from './compile.ts';

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

// A table of components where the entry holds the component beside what is written next to it, so
// the tag reads one field off the lookup. The domain is still the table's keys; the access is part
// of the choice rather than something left outside it. press's article chooses its summary
// provider's icon this way.
const AY = '<i>A</i>';
const BEE = '<b>B</b>';
const TABLE =
	"<script>import Ay from './ay.svelte'; import Bee from './bee.svelte'; let { data } = $props();" +
	" const ICONS = { a: { icon: Ay, name: 'Ay' }, b: { icon: Bee, name: 'Bee' } };" +
	' const found = $derived(data.k ? ICONS[data.k] : undefined);' +
	' const Pick = $derived(found?.icon);</script>' +
	// Guarded, and the guard is what makes the read inside it safe -- which is how press writes
	// it. Where the table lacks the key the test is two constants and the branch is never taken,
	// but a render made to ask what the test is worth takes it and reads `found.name` off nothing.
	'{#if Pick && found}<Pick /><span>{found.name}</span>{/if}<p>{data.title}</p>';

// A helper only one structure calls. The block's test is a constant once the locale is fixed, so
// the walk enters the child in that structure and in no other -- and only there does the child's
// `{shout(t)}` become a derivation. The domain puts that structure last, because a bundle built
// from the first one would otherwise hold the name by luck.
const SHOUT = 'export const shout = (s) => `${s}!`;';
const LOUD =
	"<script>import { shout } from './shout.ts'; let { t } = $props();</script><b>{shout(t)}</b>";
const ONESIDED =
	"<script>import Loud from './loud.svelte'; let { data } = $props();</script>" +
	"{#if data.locale.code === 'en'}<Loud t={data.title} />{/if}<p>{data.title}</p>";
const SPOKEN = ['fr', 'de', 'en'];

beforeAll(() => {
	mkdirSync(staging, { recursive: true });
	writeFileSync(resolve(staging, 'greet.svelte'), CHILD);
	writeFileSync(resolve(staging, 'page.svelte'), PAGE);
	writeFileSync(resolve(staging, 'say.svelte'), CALLER);
	writeFileSync(resolve(staging, 'choosing.svelte'), CHOOSING);
	writeFileSync(resolve(staging, 'ay.svelte'), AY);
	writeFileSync(resolve(staging, 'bee.svelte'), BEE);
	writeFileSync(resolve(staging, 'table.svelte'), TABLE);
	writeFileSync(resolve(staging, 'shout.ts'), SHOUT);
	writeFileSync(resolve(staging, 'loud.svelte'), LOUD);
	writeFileSync(resolve(staging, 'onesided.svelte'), ONESIDED);
});
afterAll(() => rmSync(staging, { recursive: true, force: true }));

/** Svelte's own render of a page and the children it imports, which every structure owes. */
async function oracle(
	page: [name: string, source: string],
	children: [name: string, source: string][],
	data: unknown,
): Promise<string> {
	const tag = String(Math.random()).slice(2);
	const out = resolve(staging, `oracle-${tag}.js`);
	const named = (name: string): string => name[0]?.toUpperCase() + name.slice(1);
	let code = svelte(page[1], {
		generate: 'server',
		name: named(page[0]),
		filename: resolve(staging, `${page[0]}.svelte`),
		rootDir: staging,
	}).js.code;
	for (const child of children) {
		const compiled = resolve(staging, `${child[0]}-${tag}.js`);
		writeFileSync(
			compiled,
			svelte(child[1], {
				generate: 'server',
				name: named(child[0]),
				filename: resolve(staging, `${child[0]}.svelte`),
				rootDir: staging,
			}).js.code,
		);
		code = code.replace(`'./${child[0]}.svelte'`, JSON.stringify(pathToFileURL(compiled).href));
	}
	writeFileSync(out, code);
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
				await oracle(['page', PAGE], [['greet', CHILD]], data),
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
				await oracle(['choosing', CHOOSING], [['say', CALLER]], data),
			);
		}
	});
});

describe('a component chosen through a table, read off the entry', () => {
	it('is compiled once per key, and each renders what Svelte renders', async () => {
		const runs = await structures({ path: '/', component: 'table.svelte' }, staging);
		const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
		for (const one of lowered) {
			expect(one !== undefined && 'error' in one ? one.error : undefined).toBeUndefined();
		}
		const structure = joined(
			'table',
			runs.map((one, at) => ({
				fixed: one.fixed,
				decided: one.decided,
				compiled: lowered[at] as unknown as Structure,
			})),
		);

		const derive = deriving(structure.derivations, '');
		// Both keys, a key the table lacks, and a falsy one that never reaches the lookup: the
		// arm for a missing key is what `<svelte:component>` writes `<!--[!--><!--]-->` for.
		for (const k of ['a', 'b', 'zz', '']) {
			const data = { k, title: `t-${k}` };
			expect(inject(structure.ir, derive({ data })).body, `k ${JSON.stringify(k)}`).toBe(
				await oracle(
					['table', TABLE],
					[
						['ay', AY],
						['bee', BEE],
					],
					data,
				),
			);
		}
	});
});

describe("a route's carried bundle", () => {
	// One route, several structures, one bundle. Built from the first structure's names it answers
	// for a page the server may never be asked for: press's article called `contentLanguageHref`
	// in the structure where a translation exists and in no other, compiled clean, and threw
	// `ReferenceError` at request time on the page it did ship. See `Prepared.names`.
	it('holds what every structure of it calls, not what the first one does', async () => {
		const out = resolve(staging, 'out-carried');
		rmSync(out, { recursive: true, force: true });
		await compileRoutes({
			root: staging,
			out,
			entries: [
				{
					path: '/',
					component: 'onesided.svelte',
					enumerate: { 'data.locale.code': SPOKEN },
				},
			],
		});
		const carried = readFileSync(resolve(out, 'server/onesided.js'), 'utf8');
		expect(carried, 'the helper one structure calls').toContain('shout');
	});
});
