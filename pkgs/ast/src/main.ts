import { dirname } from 'node:path';
import { bundle } from './bundle.ts';

const [file, root] = process.argv.slice(2);
if (file === undefined) {
	console.error('usage: node pkgs/ast/src/main.ts <component.svelte> [project-root]');
	process.exit(2);
}
// The root decides what component ids are relative to, and defaults to the entry's directory
// because a single component read from the command line is its own project.
process.stdout.write(`${JSON.stringify(bundle(file, root ?? dirname(file)), null, '\t')}\n`);
