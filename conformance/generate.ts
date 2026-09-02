// Regenerates the fixtures the checks compare against. Run it when a case changes, never as
// part of a check: a generator that runs inside the thing it is checked by proves nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindings } from '../pkgs/ast/src/bindings.ts';
import { bundle } from '../pkgs/ast/src/bundle.ts';
import { carry } from '../pkgs/carry/src/carry.ts';
import { skeleton } from '../pkgs/skeleton/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cases = resolve(here, 'cases');

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted()) {
	const name = file.slice(0, -'.svelte'.length);
	const markup = `${JSON.stringify(bundle(resolve(cases, file)), null, '\t')}\n`;
	writeFileSync(resolve(cases, `${name}.markup.json`), markup);

	// The code the expressions call, bundled to one script with nothing left to import. A
	// separate file rather than a field in the IR, because it is read by people in a diff and a
	// minified library inside JSON is not.
	const script = await carry(
		resolve(cases, file),
		bindings(readFileSync(resolve(cases, file), 'utf8')).carried,
	);
	const carried = resolve(cases, `${name}.carried.js`);
	if (script === '') {
		rmSync(carried, { force: true });
	} else {
		writeFileSync(carried, script);
	}

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

	const ir = execFileSync('cargo', ['run', '-q', '-p', 'lowering', '--', name], {
		cwd: root,
		input,
		encoding: 'utf8',
	});
	writeFileSync(resolve(cases, `${name}.ir.json`), ir);
	console.log(`${name}: markup, ${rendered ? 'render' : 'written'}, ir`);
}
