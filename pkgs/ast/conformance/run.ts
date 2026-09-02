// Guards the one thing pkgs/ast does not control: Svelte's AST shape. A rename like
// EachBlock.context would otherwise reduce to a null iteration variable and reach lowering as a
// wrong answer rather than a failure.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '../src/bundle.ts';

const cases = resolve(dirname(fileURLToPath(import.meta.url)), '../../../conformance/cases');
let failed = 0;

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted()) {
	const name = file.slice(0, -'.svelte'.length);
	const actual = `${JSON.stringify(bundle(resolve(cases, file)), null, '\t')}\n`;
	const expected = readFileSync(resolve(cases, `${name}.markup.json`), 'utf8');
	if (actual === expected) {
		console.log(`match  ${name} reduces to its fixture`);
	} else {
		failed += 1;
		console.error(`DIFF   ${name} no longer reduces to its fixture`);
	}
}

// The other half of what this package decides: which names resolve. A case cannot cover a
// refusal, there being no fixture for a component that does not compile, so the refusals are
// written here. Each was a real failure before the pass existed, and each failed differently:
// silently, at request time, and inside Svelte's own renderer.
const refusals: [string, string, string][] = [
	[
		'a local read as if it were data',
		'<script>let { data } = $props(); const total = data.x * 2</script><b>{total}</b>',
		'total',
	],
	[
		'a module constant',
		'<script>const LIMIT = 10; let { data } = $props()</script>{#if data.p > LIMIT}<b>y</b>{/if}',
		'LIMIT',
	],
	[
		'an imported function',
		"<script>import { cn } from 'x'; let { data } = $props()</script><div class={cn(data.c)}></div>",
		'cn',
	],
	['a clock', '<script>let { data } = $props()</script><b>{Date.now()}</b>', 'Date'],
	['randomness', '<script>let { data } = $props()</script><b>{Math.random()}</b>', 'Math.random'],
];

const staging = mkdtempSync(join(tmpdir(), 'seam-bindings-'));
for (const [label, source, name] of refusals) {
	const file = join(staging, 'component.svelte');
	writeFileSync(file, source);
	let message = '';
	try {
		bundle(file);
	} catch (error) {
		message = (error as Error).message;
	}
	if (message.includes(`\`${name}\``)) {
		console.log(`match  ${label} is refused, naming ${name}`);
	} else {
		failed += 1;
		console.error(`MISS   ${label} was not refused by name: ${message || '(it compiled)'}`);
	}
}
rmSync(staging, { recursive: true, force: true });

if (failed > 0) {
	console.error('regenerate with: node conformance/generate.ts');
	process.exit(1);
}
