// Regenerates the fixtures the checks compare against. Run it when a case changes, never as
// part of a check: a generator that runs inside the thing it is checked by proves nothing.
//
// The passes are not sequenced here. `prepare` is the compiler's own per-component half and this
// calls it, so the fixtures are made by the thing the product runs rather than by a second
// arrangement of the same parts that could drift from it. What is left here is the writing, which
// is the one thing fixtures and artifacts genuinely disagree about: these are named after the case
// and sit beside it, and an artifact is named after its route and sits under `dist`.
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from 'compiler';
import { lower } from 'lowering';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, 'cases');

const batch: [string, string][] = [];

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted()) {
	const name = file.slice(0, -'.svelte'.length);
	const one = await prepare(resolve(cases, file), cases);

	writeFileSync(
		resolve(cases, `${name}.markup.json`),
		`${JSON.stringify(one.markup, null, '\t')}\n`,
	);
	const skeleton = `${JSON.stringify(one.skeleton, null, '\t')}\n`;
	writeFileSync(resolve(cases, `${name}.skeleton.json`), skeleton);
	batch.push([name, skeleton]);
}

// One call rather than one per component. Lowering's own work is a fraction of a millisecond
// each; starting a process is not, and starting one per component was the whole of what the step
// used to cost. See pkgs/lowering.
const lowered = lower(batch);
for (const [at, [name]] of batch.entries()) {
	const one = lowered[at];
	if (one === undefined || 'error' in one) {
		throw new Error(`${name}: ${one === undefined ? 'no result came back' : one.error}`);
	}
	writeFileSync(resolve(cases, `${name}.ir.json`), `${JSON.stringify(one, null, '\t')}\n`);
	console.log(`${name}: markup, skeleton, ir`);
}
