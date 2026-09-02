// Regenerates the fixtures the checks compare against. Run it when a case changes, never as
// part of a check: a generator that runs inside the thing it is checked by proves nothing.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '../pkgs/ast/src/bundle.ts';
import { lower } from '../pkgs/lowering/src/lower.ts';
import { skeleton } from '../pkgs/skeleton/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, 'cases');

const batch: [string, string, boolean][] = [];

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted()) {
	const name = file.slice(0, -'.svelte'.length);
	const markup = `${JSON.stringify(bundle(resolve(cases, file)), null, '\t')}\n`;
	writeFileSync(resolve(cases, `${name}.markup.json`), markup);

	// The IR comes from the render where one can be made, because that is the pass that does
	// not reproduce Svelte's decisions. The written-bytes pass stays for the shapes the render
	// pass has not reached, and for the test that holds the two against each other.
	let rendered = true;
	let input = markup;
	try {
		const skel = await skeleton(resolve(cases, file));
		input = `${JSON.stringify(skel, null, '\t')}\n`;
		writeFileSync(resolve(cases, `${name}.skeleton.json`), input);
	} catch {
		rendered = false;
		rmSync(resolve(cases, `${name}.skeleton.json`), { force: true });
	}
	batch.push([name, input, rendered]);
}

// One call rather than one per component. Lowering's own work is a fraction of a millisecond
// each; starting a process is not, and starting one per component was the whole of what the step
// used to cost. See pkgs/lowering.
const lowered = lower(batch.map(([name, input]) => [name, input] as const));
for (const [at, [name, , rendered]] of batch.entries()) {
	const one = lowered[at];
	if (one === undefined || 'error' in one) {
		throw new Error(`${name}: ${one === undefined ? 'no result came back' : one.error}`);
	}
	writeFileSync(resolve(cases, `${name}.ir.json`), `${JSON.stringify(one, null, '\t')}\n`);
	console.log(`${name}: markup, ${rendered ? 'render' : 'written'}, ir`);
}
