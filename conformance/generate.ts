// Regenerates the fixtures the checks compare against. Run it when a case changes, never as
// part of a check: a generator that runs inside the thing it is checked by proves nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduce } from '../pkgs/ast/src/reduce.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cases = resolve(here, 'cases');

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.sort()) {
	const name = file.slice(0, -'.svelte'.length);
	const markup = `${JSON.stringify(reduce(readFileSync(resolve(cases, file), 'utf8')), null, '\t')}\n`;
	writeFileSync(resolve(cases, `${name}.markup.json`), markup);

	const component = name.charAt(0).toUpperCase() + name.slice(1);
	const ir = execFileSync('cargo', ['run', '-q', '-p', 'seam-lowering', '--', component], {
		cwd: root,
		input: markup,
		encoding: 'utf8',
	});
	writeFileSync(resolve(cases, `${name}.ir.json`), ir);
	console.log(`${name}: markup and ir regenerated`);
}
