// Guards the one thing this package does not control: Svelte's AST shape. A rename like
// EachBlock.context would otherwise reduce to a null iteration variable and reach lowering as a
// wrong answer rather than as a failure.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { bundle } from './bundle.ts';
import { configureAliases } from './packages.ts';

const cases = resolve(dirname(fileURLToPath(import.meta.url)), '../../../corpus/cases');

describe('the corpus reduces to its fixtures', () => {
	const files = readdirSync(cases)
		.filter((f) => f.endsWith('.svelte'))
		.toSorted();

	it.each(files)('%s', (file) => {
		const name = file.slice(0, -'.svelte'.length);
		const actual = `${JSON.stringify(bundle(resolve(cases, file), cases), null, '\t')}\n`;
		expect(actual, 'regenerate with: node corpus/generate.ts').toBe(
			readFileSync(resolve(cases, `${name}.markup.json`), 'utf8'),
		);
	});
});

// A case cannot cover a refusal, there being no fixture for a component that does not compile, so
// the refusals are written here. Each was a real failure before this pass existed, and each failed
// differently: silently, at request time, and inside Svelte's own renderer.
describe('a name that cannot resolve is refused, by name', () => {
	const staging = mkdtempSync(join(tmpdir(), 'seam-bindings-'));
	afterAll(() => rmSync(staging, { recursive: true, force: true }));

	const refusals: [label: string, source: string, named: string][] = [
		[
			'a name that is neither a prop nor an import',
			'<script>let { data } = $props()</script><b>{helpers[data.k](data.v)}</b>',
			'helpers',
		],
		['a clock', '<script>let { data } = $props()</script><b>{Date.now()}</b>', 'Date'],
		[
			'a rest element, which is neither a member nor an index',
			'<script>let { data } = $props(); const { a, ...rest } = data.t</script><b>{rest}</b>',
			'rest',
		],
		[
			'a default inside a pattern',
			'<script>let { data } = $props(); const { a = 1 } = data.t</script><b>{a}</b>',
			'a',
		],
		['randomness', '<script>let { data } = $props()</script><b>{Math.random()}</b>', 'Math.random'],
	];

	it.each(refusals)('%s', (_label, source, named) => {
		const file = join(staging, 'component.svelte');
		writeFileSync(file, source);
		// Named rather than merely thrown: a refusal the author cannot act on is the failure this
		// pass exists to replace. See spec/refusals.md.
		expect(() => bundle(file, staging)).toThrow(`\`${named}\``);
	});
});

// A bundler resolves `$lib` before it resolves anything, and completes an extension the way Vite
// does, so `$lib/x.svelte` may be a component or may be the runes module `x.svelte.ts`. The file
// decides which, not the specifier: the second is not composed and never parsed as markup.
describe('an aliased import is resolved as Vite resolves it', () => {
	const staging = mkdtempSync(join(tmpdir(), 'seam-alias-'));
	afterAll(() => {
		rmSync(staging, { recursive: true, force: true });
		configureAliases({});
	});

	it('follows a component through $lib and leaves a runes module alone', () => {
		mkdirSync(join(staging, 'src/lib/x'), { recursive: true });
		writeFileSync(
			join(staging, 'src/lib/x/kid.svelte'),
			'<script>let { t } = $props();</script><i>{t}</i>',
		);
		writeFileSync(
			join(staging, 'src/lib/x/reads.svelte.ts'),
			'export type Reads = { n: number };\nexport const count = () => 1;',
		);
		const entry = join(staging, 'src/routes/page.svelte');
		mkdirSync(dirname(entry), { recursive: true });
		writeFileSync(
			entry,
			"<script>import Kid from '$lib/x/kid.svelte'; import { count } from '$lib/x/reads.svelte'; let { data } = $props();</script><Kid t={data.t} /><b>{count()}</b>",
		);
		configureAliases({ $lib: join(staging, 'src/lib') });
		const found = bundle(entry, staging);
		expect(Object.keys(found.components).toSorted()).toEqual(['src/lib/x/kid', 'src/routes/page']);
		expect(found.components['src/routes/page']?.imports).toEqual({ Kid: 'src/lib/x/kid' });
	});
});
