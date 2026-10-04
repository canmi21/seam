// A SvelteKit project built twice, once as Kit builds it and once with this plugin beside Kit's,
// and the two built servers asked for the same pages: the responses have to be the same bytes,
// document and all. Everything but the render is Kit's own in both, so what the comparison holds
// is the one call that changed and the seams around it -- the props Kit hands the root, the head
// and body it takes back, the artifacts finding the program. See spec/framework.md.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vite from 'vite';
import { load_vite_config } from '@sveltejs/kit/src/core/config/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Inside the package, because the project's `svelte`, `@sveltejs/kit` and `vite` are resolved by
// walking up from it, and Kit's plugin reads the project from the working directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-plugin');
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts');

const files: Record<string, string> = {
	// `#lib` is Kit 3's spelling of `$lib`: a subpath import the project declares.
	'package.json':
		'{ "name": "sample", "private": true, "type": "module", "imports": { "#lib/*": "./src/lib/*" } }',
	// A virtual module of the project's own, the shape press's site config takes: nothing on disk
	// answers it, so the render has to resolve it the way the project's build does.
	'vite.config.js':
		"import { sveltekit } from '@sveltejs/kit/vite';\n" +
		`import { seam } from ${JSON.stringify(pathToFileURL(plugin).href)};\n` +
		"const site = { name: 'virtual-site', resolveId(id) { return id === 'virtual:site' ? '\\0virtual:site' : null; }, " +
		"load(id) { return id === '\\0virtual:site' ? 'export const site = { name: \"Sample <site>\" };' : null; } };\n" +
		// Kit 3 takes its options as the plugin's argument; a `svelte.config.js` is an error.
		"export default { logLevel: 'silent', plugins: [sveltekit({ outDir: process.env.SEAM_OUT, alias: { $parts: 'src/parts' } }), site, ...(process.env.SEAM ? [seam()] : [])] };",
	'src/app.html':
		'<!doctype html><html lang="en"><head>%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>',
	'src/routes/+layout.server.js': "export function load() { return { tagline: 'a sample' }; }",
	'src/routes/+layout.svelte':
		"<script>import { page } from '$app/state'; import { dev } from '$app/environment'; import { site } from 'virtual:site'; import { shout } from '#lib/shout.ts'; import Nav from '$parts/nav.svelte'; let { children, data } = $props();</script>" +
		'<svelte:head><link rel="canonical" href={`https://sample.test${page.url.pathname}`} /></svelte:head>' +
		'<header>{site.name}: {data.tagline}{dev ? " (dev)" : ""}</header><p>{shout(data.tagline)}</p><Nav /><main>{@render children()}</main>',
	// Carried: a function a derivation calls, reaching a virtual module, which only the project's
	// own bundler can resolve.
	'src/lib/shout.ts':
		"import { site } from 'virtual:site';\nexport const shout = (s) => `${site.name}: ${s}`.toUpperCase();",
	// A link through Kit's own `resolve`, which with `paths.relative` on writes `..` per segment of the
	// URL being answered, so every page at every depth writes a different one.
	'src/parts/nav.svelte':
		"<script>import { page } from '$app/state'; import { resolve } from '$app/paths';</script><nav class:home={page.url.pathname === '/'}><a href={resolve('/run')}>run</a>{page.route.id}</nav>",
	'src/routes/+page.server.js':
		"export function load() { return { title: 'Home & away', items: ['a', '<b>', 'c'] }; }",
	'src/routes/+page.svelte':
		'<script>let { data } = $props();</script><svelte:head><title>{data.title}</title></svelte:head>' +
		'<h1>{data.title}</h1><ul>{#each data.items as item}<li>{item}</li>{/each}</ul>',
	'src/routes/+error.svelte':
		"<script>import { page } from '$app/state';</script><h1>{page.status}: {page.error?.message}</h1>",
	// A load that throws under a matched route renders the error page under that route's id.
	'src/routes/blog/[slug]/+page.server.js':
		"import { error } from '@sveltejs/kit';\nexport function load({ params }) { if (params.slug === 'gone') error(404, 'no such post'); return { body: `post ${params.slug}`, draft: params.slug.startsWith('d') }; }",
	'src/routes/blog/[slug]/+page.svelte':
		'<script>let { data, params } = $props();</script><article>{params.slug}: {data.body}</article>{#if data.draft}<em>draft</em>{/if}',
	// A page whose script changes a name over the request's data: substitution cannot follow it, so
	// the page's script runs as Svelte compiled it, carried through the project's own Vite. The page
	// is a child of Kit's generated root, which is every page an author writes.
	'src/routes/run/+page.server.js': 'export function load() { return { count: 21 }; }',
	'src/routes/run/+page.svelte':
		'<script>let { data } = $props(); let n = data.count; n = n * 2;</script><p>run: {n}</p>',
	// A store a relative module exports, beside a binding that module changes, read as `$mode`: the
	// shape of Kit's `load/invalidation/multiple/redirect`, where the read was left as `$mode` and
	// named nothing at request time.
	'src/routes/store/state.js':
		"import { writable } from 'svelte/store';\nlet count = 0;\nexport const mode = writable('initial');\nexport function bump() { count++; }",
	// A worker's URL, which Kit's build writes under `_app/immutable/workers/`: Kit's `no-csr` app
	// links one, and the carried bundle wrote the library build's `/assets/` path instead.
	'src/routes/worker/work.js': 'self.onmessage = () => {};',
	'src/routes/worker/+page.svelte':
		"<script>import url from './work.js?worker&url';</script><a href={url}>worker</a>",
	'src/routes/store/+page.svelte':
		"<script>import { mode, bump } from './state.js'; function go() { mode.set('x'); bump(); }</script><button onclick={go}>go</button><p>mode: {$mode}</p>",
};

const URLS = [
	'/',
	'/blog/hello',
	'/blog/draft',
	'/blog/gone',
	'/blog/hello/__data.json',
	'/missing',
	'/run',
	'/store',
	'/worker',
];

/** Builds the project into Kit's output under `outDir`, with or without the plugin. */
async function built(outDir: string, withSeam: boolean): Promise<Record<string, string>> {
	process.env['SEAM_OUT'] = outDir;
	if (withSeam) process.env['SEAM'] = '1';
	else delete process.env['SEAM'];
	const cwd = process.cwd();
	process.chdir(root);
	try {
		// As `vite build` runs Kit 3: through the builder, whose `buildApp` Kit's plugin drives, the
		// server environment first and the client from inside it.
		const builder = await vite.createBuilder({
			root,
			configFile: resolve(root, 'vite.config.js'),
			logLevel: 'silent',
		});
		await builder.buildApp();
	} finally {
		process.chdir(cwd);
	}
	const server = resolve(root, outDir, 'output/server');
	const { Server } = (await import(pathToFileURL(resolve(server, 'index.js')).href)) as {
		Server: new (manifest: unknown) => {
			init: (options: { env: Record<string, string> }) => Promise<void>;
			respond: (request: Request, options: { getClientAddress: () => string }) => Promise<Response>;
		};
	};
	const { manifest } = (await import(pathToFileURL(resolve(server, 'manifest-full.js')).href)) as {
		manifest: unknown;
	};
	const instance = new Server(manifest);
	await instance.init({ env: {} });
	const answered = await Promise.all(
		URLS.map(async (url) => {
			const response = await instance.respond(new Request(`http://sample.test${url}`), {
				getClientAddress: () => '127.0.0.1',
			});
			return [url, `${String(response.status)}\n${await response.text()}`] as const;
		}),
	);
	return Object.fromEntries(answered);
}

/**
 * The config read the way `svelte-kit sync` reads it, which a generated project's `prepare` runs
 * at install: resolved for `build` and never built, under the `development` NODE_ENV Vite defaults
 * to there. The plugin compiled on any `build` resolution, so sync ran a compile that loaded
 * Svelte's development runtime and refused. Whether it left anything behind is the answer.
 */
async function synced(): Promise<boolean> {
	process.env['SEAM_OUT'] = '.svelte-kit';
	process.env['SEAM'] = '1';
	const environment = process.env['NODE_ENV'];
	delete process.env['NODE_ENV'];
	const cwd = process.cwd();
	process.chdir(root);
	try {
		await load_vite_config(resolve(root, 'vite.config.js'), vite);
	} finally {
		process.chdir(cwd);
		process.env['NODE_ENV'] = environment;
	}
	return existsSync(resolve(root, '.svelte-kit/seam'));
}

let kit: Record<string, string> = {};
let compiledOnSync = true;
let ours: Record<string, string> = {};

beforeAll(async () => {
	rmSync(root, { recursive: true, force: true });
	for (const [file, source] of Object.entries(files)) {
		mkdirSync(dirname(resolve(root, file)), { recursive: true });
		writeFileSync(resolve(root, file), source);
	}
	kit = await built('.svelte-kit-plain', false);
	compiledOnSync = await synced();
	ours = await built('.svelte-kit', true);
}, 120_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the built server answers as Kit's does", () => {
	it.each(URLS)('%s', (url) => {
		expect(ours[url]).toBe(kit[url]);
	});

	it('rendered the page from the artifacts rather than from the components', () => {
		// The one thing that differs between the two builds is on disk: the artifacts beside the
		// program, and a page Kit's own render could not have written from them.
		expect(kit['/']).toContain('Home &amp; away');
		expect(ours['/']).toContain('Home &amp; away');
	});

	it('compiled when Kit built, and not when Kit only read the config', () => {
		expect(compiledOnSync).toBe(false);
	});

	// The project's cache holds what its dev server optimized, under the development condition.
	it("kept its dependency cache apart from the project's", () => {
		expect(existsSync(resolve(root, '.svelte-kit/seam/vite'))).toBe(true);
		expect(existsSync(resolve(root, 'node_modules/.vite/deps_ssr'))).toBe(false);
	});

	it("ran the page's script where substitution could not follow it", () => {
		expect(kit['/run']).toContain('run: 42');
		expect(ours['/run']).toContain('run: 42');
	});
});
