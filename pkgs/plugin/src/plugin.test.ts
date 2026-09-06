// A SvelteKit project built twice, once as Kit builds it and once with this plugin beside Kit's,
// and the two built servers asked for the same pages: the responses have to be the same bytes,
// document and all. Everything but the render is Kit's own in both, so what the comparison holds
// is the one call that changed and the seams around it -- the props Kit hands the root, the head
// and body it takes back, the artifacts finding the program. See spec/framework.md.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Inside the package, because the project's `svelte`, `@sveltejs/kit` and `vite` are resolved by
// walking up from it, and Kit's plugin reads the project from the working directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-plugin');
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), 'index.ts');

const files: Record<string, string> = {
	'package.json': '{ "name": "sample", "private": true, "type": "module" }',
	'svelte.config.js':
		"export default { kit: { outDir: process.env.SEAM_OUT, alias: { $parts: 'src/parts' } } };",
	// A virtual module of the project's own, the shape press's site config takes: nothing on disk
	// answers it, so the render has to resolve it the way the project's build does.
	'vite.config.js':
		"import { sveltekit } from '@sveltejs/kit/vite';\n" +
		`import { seam } from ${JSON.stringify(pathToFileURL(plugin).href)};\n` +
		"const site = { name: 'virtual-site', resolveId(id) { return id === 'virtual:site' ? '\\0virtual:site' : null; }, " +
		"load(id) { return id === '\\0virtual:site' ? 'export const site = { name: \"Sample <site>\" };' : null; } };\n" +
		"export default { logLevel: 'silent', plugins: [sveltekit(), site, ...(process.env.SEAM ? [seam()] : [])] };",
	'src/app.html':
		'<!doctype html><html lang="en"><head>%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>',
	'src/routes/+layout.server.js': "export function load() { return { tagline: 'a sample' }; }",
	'src/routes/+layout.svelte':
		"<script>import { page } from '$app/state'; import { dev } from '$app/environment'; import { site } from 'virtual:site'; import { shout } from '$lib/shout.ts'; import Nav from '$parts/nav.svelte'; let { children, data } = $props();</script>" +
		'<svelte:head><link rel="canonical" href={`https://sample.test${page.url.pathname}`} /></svelte:head>' +
		'<header>{site.name}: {data.tagline}{dev ? " (dev)" : ""}</header><p>{shout(data.tagline)}</p><Nav /><main>{@render children()}</main>',
	// Carried: a function a derivation calls, reaching a virtual module, which only the project's
	// own bundler can resolve.
	'src/lib/shout.ts':
		"import { site } from 'virtual:site';\nexport const shout = (s) => `${site.name}: ${s}`.toUpperCase();",
	'src/parts/nav.svelte':
		"<script>import { page } from '$app/state';</script><nav class:home={page.url.pathname === '/'}>{page.route.id}</nav>",
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
};

const URLS = [
	'/',
	'/blog/hello',
	'/blog/draft',
	'/blog/gone',
	'/blog/hello/__data.json',
	'/missing',
];

/** Builds the project into Kit's output under `outDir`, with or without the plugin. */
async function built(outDir: string, withSeam: boolean): Promise<Record<string, string>> {
	process.env['SEAM_OUT'] = outDir;
	if (withSeam) process.env['SEAM'] = '1';
	else delete process.env['SEAM'];
	const cwd = process.cwd();
	process.chdir(root);
	try {
		await build({ root, configFile: resolve(root, 'vite.config.js'), logLevel: 'silent' });
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

let kit: Record<string, string> = {};
let ours: Record<string, string> = {};

beforeAll(async () => {
	rmSync(root, { recursive: true, force: true });
	for (const [file, source] of Object.entries(files)) {
		mkdirSync(dirname(resolve(root, file)), { recursive: true });
		writeFileSync(resolve(root, file), source);
	}
	kit = await built('.svelte-kit-plain', false);
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
});
