// The seam between this package and Svelte. For every case, the IR the compiler produced is
// injected here and rendered by Svelte's own server codegen, and the two are compared byte for
// byte. A Svelte release that changes an anchor or an escaping rule lands here.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { inject } from '../src/index.ts';
import type { ComponentIR } from '../src/ir.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, '../../../conformance/cases');
const staging = resolve(here, '.build');

// Svelte's compiled output imports 'svelte/internal/server', which only resolves from inside
// this package, so the module has to be written here rather than to a temporary directory.
async function svelteRenderer(source: string, id: string): Promise<(data: unknown) => string> {
	mkdirSync(staging, { recursive: true });
	const file = resolve(staging, `${id}-${Date.now()}.js`);
	writeFileSync(file, compile(source, { generate: 'server', name: 'Case' }).js.code);
	const mod = await import(pathToFileURL(file).href);
	return (data) => render(mod.default, { props: data as Record<string, unknown> }).body;
}

let failed = 0;
let total = 0;

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.sort()) {
	const name = file.slice(0, -'.svelte'.length);
	const ir = JSON.parse(readFileSync(resolve(cases, `${name}.ir.json`), 'utf8')) as ComponentIR;
	const payloads = JSON.parse(readFileSync(resolve(cases, `${name}.data.json`), 'utf8')) as {
		label: string;
		data: Record<string, unknown>;
	}[];
	const svelte = await svelteRenderer(readFileSync(resolve(cases, file), 'utf8'), name);

	for (const payload of payloads) {
		total += 1;
		const expected = svelte(payload.data);
		const actual = inject(ir, payload.data);
		if (expected === actual) {
			console.log(`match  ${name}: ${payload.label}`);
			continue;
		}
		failed += 1;
		console.log(`DIFF   ${name}: ${payload.label}`);
		console.log(`   svelte: ${JSON.stringify(expected)}`);
		console.log(`   ours:   ${JSON.stringify(actual)}`);
	}
}

rmSync(staging, { recursive: true, force: true });
console.log(`\n${total - failed}/${total} agree with Svelte`);
if (failed > 0) process.exit(1);
