import { readFileSync } from 'node:fs';
import { reduce } from './reduce.ts';

const [file] = process.argv.slice(2);
if (file === undefined) {
	console.error('usage: node pkgs/ast/src/main.ts <component.svelte>');
	process.exit(2);
}
process.stdout.write(`${JSON.stringify(reduce(readFileSync(file, 'utf8')), null, '\t')}\n`);
