// The compiler, from a command line. It stands where the plugin will. Given no pairs, the routes
// are found: `src/routes` read the way SvelteKit reads it, and one root generated per route as
// the entry; given pairs, they are named, which is what a project with no routes directory does.
// See spec/build.md and spec/framework.md.
import { relative, resolve } from 'node:path';
import { entries as found } from 'routes';
import { compile, type Entry } from './compile.ts';

const [root, out, shell, ...pairs] = process.argv.slice(2);
if (root === undefined || out === undefined || shell === undefined) {
	console.error(
		'usage: node pkgs/compiler/src/main.ts <root> <out> <shell.html> [<url>=<component.svelte>...]',
	);
	process.exit(2);
}

// A URL and a component, not a component alone. Deriving the URL from the file is a routing
// convention, and inventing one here is how the development server came to serve every artifact
// at `/<id>` without anybody deciding it should. Where none are named, the convention is Kit's.
const entries: Entry[] =
	pairs.length === 0
		? found(root).map((one) => ({ path: one.path, component: one.component }))
		: pairs.map((pair) => {
				const at = pair.indexOf('=');
				if (at < 1) {
					console.error(`\`${pair}\` is not <url>=<component.svelte>`);
					process.exit(2);
				}
				return { path: pair.slice(0, at), component: pair.slice(at + 1) };
			});

// No asset tags: nothing here ran a client build, so a document served from this has the
// component's own head and nothing to hydrate it with. The plugin is what fills that in.
const reports = await compile({ root, entries, out, shell });
for (const one of reports) {
	console.log(`${one.path} -> ${one.id}: ${one.files.join(', ')}`);
}
console.log(`${reports.length} route(s) into ${relative(process.cwd(), resolve(out))}`);
