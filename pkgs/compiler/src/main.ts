// The compiler, from a command line. It stands where the plugin will: routing does not exist, so
// the routes are named rather than found, and naming them is the one thing the plugin's
// configuration will do that this does. See spec/build.md.
import { relative, resolve } from 'node:path';
import { compile, type Entry } from './compile.ts';

const [root, out, ...pairs] = process.argv.slice(2);
if (root === undefined || out === undefined || pairs.length === 0) {
	console.error('usage: node pkgs/compiler/src/main.ts <root> <out> <url>=<component.svelte>...');
	process.exit(2);
}

// A URL and a component, not a component alone. Deriving the URL from the file is a routing
// convention, and inventing one here is how the development server came to serve every artifact
// at `/<id>` without anybody deciding it should.
const entries: Entry[] = pairs.map((pair) => {
	const at = pair.indexOf('=');
	if (at < 1) {
		console.error(`\`${pair}\` is not <url>=<component.svelte>`);
		process.exit(2);
	}
	return { path: pair.slice(0, at), component: pair.slice(at + 1) };
});

const reports = await compile({ root, entries, out });
for (const one of reports) {
	console.log(`${one.path} -> ${one.id}: ${one.files.join(', ')}`);
}
console.log(`${reports.length} route(s) into ${relative(process.cwd(), resolve(out))}`);
