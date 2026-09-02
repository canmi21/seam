// Manual, and deliberately not wired into any task. It stands in for the CLI's build step so
// hydration can be tried against real injector output before the compiler exists. Run it by
// hand: `node pkgs/server/scripts/build-client.ts`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const component = resolve(root, '../injector/conformance/cases/product.svelte');

// Staged inside the package, not in a temporary directory: esbuild resolves an import from
// the importing file's location, and `svelte` only resolves from here.
const staging = resolve(root, '.build');
mkdirSync(staging, { recursive: true });
const compiled = join(staging, 'Component.js');
writeFileSync(
	compiled,
	compile(readFileSync(component, 'utf8'), { generate: 'client', name: 'Component' }).js.code,
);

const entry = join(staging, 'entry.js');
writeFileSync(
	entry,
	`import { hydrate } from 'svelte';
import Component from ${JSON.stringify(compiled)};

const script = document.querySelector('[data-seam-payload]');
const target = document.getElementById('seam');
if (script === null || target === null) throw new Error('no payload or no target');

hydrate(Component, { target, props: JSON.parse(script.textContent ?? '{}') });
`,
);

await build({
	entryPoints: [entry],
	bundle: true,
	format: 'esm',
	outfile: resolve(root, 'static/client.js'),
	// Resolved from this package, which is where svelte is a dependency.
	absWorkingDir: root,
	logLevel: 'info',
});
rmSync(staging, { recursive: true, force: true });
