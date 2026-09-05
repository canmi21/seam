// The development server, reading what the compiler wrote.
//
// It used to read a fixture out of the conformance corpus and call `compile` with one argument,
// which meant a component carrying an imported function failed at request time with a
// `ReferenceError` and nothing anywhere could have prevented it: no step wrote a carried bundle to
// a file. This reads the manifest instead, so it consumes the artifact rather than a rehearsal of
// it. See spec/build.md.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile as compileDerivations, type Derivation } from 'derive';
import type { ComponentIR } from 'injector';
import { createServer, type Route } from './index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');

interface Manifest {
	/** Whether anything here has to be evaluated rather than walked. See spec/ir.md. */
	expressions: boolean;
	/** Keyed by URL, which is what a request arrives holding. See spec/build.md. */
	routes: Record<string, { id: string; ir: string; carried: string | null; head: string }>;
}

const manifest = JSON.parse(read('dist/server/manifest.json')) as Manifest;

// Parsed once, here, rather than per request. That is the whole difference from v1, which
// re-tokenized the skeleton on every request because the skeleton was a string.
const routes: Record<string, Route> = {};
for (const [path, entry] of Object.entries(manifest.routes)) {
	const compiled = JSON.parse(read(`dist/server/${entry.ir}`)) as {
		ir: ComponentIR;
		derivations: Derivation[];
	};
	routes[path] = {
		ir: compiled.ir,
		head: entry.head,
		// The carried bundle is read from the artifact rather than built here, which is the point
		// of the artifact: a backend that is not Node reads this same file.
		derive: compileDerivations(
			compiled.derivations,
			entry.carried === null ? '' : read(`dist/server/${entry.carried}`),
		),
		// A placeholder, not a design. This is where server functions will produce a payload the
		// slots can be filled from, and that contract is not settled yet, so the corpus payload
		// stands in for one. See spec/payload.md.
		data: (
			JSON.parse(read(`corpus/cases/${entry.id}.data.json`)) as {
				data: Record<string, unknown>;
			}[]
		)[0]?.data as Record<string, unknown>,
	};
}

const port = Number(process.env['PORT'] ?? 5100);
createServer({
	// The shell the compiler wrote, not the one in this package: it is an artifact both backends
	// read, and reading a different copy is how two servers come to disagree. See spec/build.md.
	shell: read('dist/server/app.html'),
	routes,
	staticRoot: resolve(here, '..', 'static'),
}).listen(port, () => {
	console.log(`serving on http://localhost:${port}`);
	for (const path of Object.keys(routes).toSorted()) console.log(`  ${path}`);
});
