// Guards the one thing this package does not control: Svelte's AST shape. A rename like
// EachBlock.context would otherwise reduce to a null iteration variable and reach lowering as a
// wrong answer rather than as a failure.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { bundle } from './bundle.ts';

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
