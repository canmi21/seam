// Guards the one thing pkgs/ast does not control: Svelte's AST shape. A rename like
// EachBlock.context would otherwise reduce to a null iteration variable and reach lowering as a
// wrong answer rather than a failure.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

if (failed > 0) {
	console.error('regenerate with: node conformance/generate.ts');
	process.exit(1);
}
