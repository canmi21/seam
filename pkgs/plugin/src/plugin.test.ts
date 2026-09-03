// The two halves of a build, held against each other.
//
// Vite builds the client and this plugin runs the compiler, and the things they have to agree
// about are not visible in either half alone: a scoped class is a hash of a filename that both
// sides give to Svelte, and the tags a document needs are named by one and concatenated by the
// other. A check that only looked at the server artifacts would pass while the page rendered with
// a class no rule selects. See spec/build.md.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seam } from './plugin.ts';

// Inside the package, because the generated entry imports `svelte` and `devalue` and a bundler
// resolves those by walking up from the importer.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-project');
const out = resolve(root, 'dist');

beforeAll(async () => {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(resolve(root, 'src'), { recursive: true });
	writeFileSync(
		resolve(root, 'src/Page.svelte'),
		'<script>let { data } = $props()</script><article class="card"><h1>{data.name}</h1></article>\n' +
			'<style>.card { color: red }</style>\n',
	);
	writeFileSync(
		resolve(root, 'app.html'),
		'<!doctype html><html><head>%head%</head><body><div id="app">%body%</div></body></html>\n',
	);
	await build({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [seam({ entries: [{ path: '/', component: 'src/Page.svelte' }] })],
	});
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Manifest {
	routes: Record<string, { id: string; ir: string; carried: string | null; head: string }>;
	client: string | null;
}

const manifest = (): Manifest =>
	JSON.parse(readFileSync(resolve(out, 'server/manifest.json'), 'utf8')) as Manifest;

it('writes a server artifact for the route, keyed by its URL', () => {
	const route = manifest().routes['/'];
	expect(route?.id).toBe('src/Page');
	expect(readFileSync(resolve(out, 'server', route?.ir ?? ''), 'utf8')).toContain('"component"');
});

it('copies the shell, because a backend that is not Node cannot read a function', () => {
	expect(readFileSync(resolve(out, 'server/app.html'), 'utf8')).toContain('%body%');
});

// The one that could not be caught by looking at either half. Svelte hashes the filename, made
// relative to `rootDir`, into the class it scopes a `<style>` with. The server bytes come from the
// compiler and the stylesheet from the client build, so a difference in what either passes shows
// up as a page styled by nothing at all, with no error anywhere.
it('scopes the bytes with the class the stylesheet defines', () => {
	const route = manifest().routes['/'];
	const ir = readFileSync(resolve(out, 'server', route?.ir ?? ''), 'utf8');
	const assets = resolve(out, 'client/assets');
	const sheet = readdirSync(assets).find((one) => one.endsWith('.css'));
	expect(sheet).toBeDefined();
	const css = readFileSync(resolve(assets, sheet ?? ''), 'utf8');

	const inBytes = /svelte-[a-z0-9]+/.exec(ir)?.[0];
	expect(inBytes, 'the IR carries no scoped class').toBeDefined();
	expect(css).toContain(inBytes ?? '');
});

// Written by the compiler rather than composed by a server: two backends spelling a script tag
// identically is a byte-level agreement of the kind this protocol exists to avoid.
it('names the client assets as a finished string', () => {
	const head = manifest().routes['/']?.head ?? '';
	expect(head).toMatch(/<script type="module" src="\/assets\/[^"]+\.js"><\/script>/);
	expect(head).toMatch(/<link rel="stylesheet" href="\/assets\/[^"]+\.css">/);
	// Every file it names is one the build actually wrote.
	for (const href of head.matchAll(/(?:src|href)="([^"]+)"/g)) {
		const file = href[1]?.slice(1) ?? '';
		expect(() => readFileSync(resolve(out, 'client', file)), `missing ${file}`).not.toThrow();
	}
});
