import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { inject } from '../src/index.ts';
import type { ComponentIR } from '../src/ir.ts';

const here = dirname(fileURLToPath(import.meta.url));

// The IR is read out of the specification rather than kept beside this file. One copy, so the
// prose and the fixture cannot disagree: an example edited into something that does not hold is
// a failing run rather than a document nobody rechecked.
function irFromSpec(): ComponentIR {
	const text = readFileSync(resolvePath(here, '../../../spec/ir.md'), 'utf8');
	const block = /```json\n([\s\S]*?)```/.exec(text);
	if (block?.[1] === undefined) throw new Error('spec/ir.md has no json block');
	return JSON.parse(block[1]) as ComponentIR;
}

// Svelte's compiled output imports 'svelte/internal/server', which only resolves from inside
// this package, so the module has to be written here rather than to a temporary directory.
async function svelteRenderer(source: string): Promise<(data: unknown) => string> {
	const out = compile(source, { generate: 'server', name: 'Case' });
	const dir = resolvePath(here, '.build');
	mkdirSync(dir, { recursive: true });
	const file = resolvePath(dir, `case-${Date.now()}.js`);
	writeFileSync(file, out.js.code);
	const mod = await import(pathToFileURL(file).href);
	rmSync(dir, { recursive: true, force: true });
	return (data) => render(mod.default, { props: data as Record<string, unknown> }).body;
}

const ir = irFromSpec();
const source = readFileSync(resolvePath(here, 'cases/product.svelte'), 'utf8');
const cases = JSON.parse(readFileSync(resolvePath(here, 'cases/product.data.json'), 'utf8')) as {
	label: string;
	data: Record<string, unknown>;
}[];

const svelte = await svelteRenderer(source);
let failed = 0;
for (const testCase of cases) {
	const expected = svelte(testCase.data);
	const actual = inject(ir, testCase.data);
	const ok = expected === actual;
	if (!ok) failed += 1;
	console.log(`${ok ? 'match' : 'DIFF '}  ${testCase.label}`);
	if (!ok) {
		console.log(`   svelte: ${JSON.stringify(expected)}`);
		console.log(`   ours:   ${JSON.stringify(actual)}`);
	}
}
console.log(`\n${cases.length - failed}/${cases.length} agree with Svelte`);
if (failed > 0) process.exit(1);
