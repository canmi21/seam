// The compiler, from a command line. It stands where the plugin will: routing does not exist, so
// the entries are named rather than found, and naming them is the one thing the configuration will
// do that this does. See spec/build.md.
import { relative, resolve } from 'node:path';
import { compile } from './compile.ts';

const [root, out, ...entries] = process.argv.slice(2);
if (root === undefined || out === undefined || entries.length === 0) {
	console.error('usage: node pkgs/compiler/src/main.ts <root> <out> <entry.svelte>...');
	process.exit(2);
}

const reports = await compile({ root, entries, out });
for (const one of reports) {
	console.log(`${one.id}: ${one.files.join(', ')}`);
}
console.log(`${reports.length} component(s) into ${relative(process.cwd(), resolve(out))}`);
