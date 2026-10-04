import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compilerOptions, routes } from './manifest.ts';

// Inside the package, so that the project's `@sveltejs/kit` and `vite` resolve by walking up.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-compiler-options');

describe('the compile options a project sets', () => {
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	// Kit 3 takes them as the plugin's argument, which is how its own `async` app turns the flag on;
	// read off `svelte.config.js` alone, every route of that app was compiled without it and refused.
	it("are read off Kit's plugin, where Kit 3 takes them", async () => {
		rmSync(root, { recursive: true, force: true });
		mkdirSync(resolve(root, 'src/routes'), { recursive: true });
		writeFileSync(
			resolve(root, 'package.json'),
			'{ "name": "sample", "private": true, "type": "module" }',
		);
		writeFileSync(
			resolve(root, 'vite.config.js'),
			"import { sveltekit } from '@sveltejs/kit/vite';\n" +
				'export default { plugins: [sveltekit({ compilerOptions: { experimental: { async: true } } })] };\n',
		);
		writeFileSync(resolve(root, 'src/routes/+page.svelte'), '<p>page</p>');
		writeFileSync(
			resolve(root, 'src/app.html'),
			'<!doctype html><html><head>%sveltekit.head%</head><body>%sveltekit.body%</body></html>',
		);
		expect(await compilerOptions(root)).toEqual({ experimental: { async: true } });
	});
});

describe('the components a universal load imports', () => {
	const project = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-loaded');
	afterAll(() => rmSync(project, { recursive: true, force: true }));

	// Kit's `basics` `load/dynamic-import-styles` returns `(await import('./_/Thing.svelte')).default`
	// from its `+page.js`, and the page renders it with `<svelte:component this={data.Thing}>`.
	it('are read off every level of the branch, statically or dynamically imported', async () => {
		rmSync(project, { recursive: true, force: true });
		const files: Record<string, string> = {
			'package.json': '{ "name": "loaded", "private": true, "type": "module" }',
			'src/app.html': '<html><head>%sveltekit.head%</head><body>%sveltekit.body%</body></html>',
			'src/routes/+layout.js':
				"import Shell from './Shell.svelte';\nexport const load = () => ({ Shell });",
			'src/routes/Shell.svelte': '<i>shell</i>',
			'src/routes/+page.svelte': '<p>home</p>',
			'src/routes/+layout.svelte':
				'<script>let { children } = $props();</script>{@render children()}',
			'src/routes/thing/+page.js':
				"export async function load() { return { Thing: (await import('./_/Thing.svelte')).default }; }",
			'src/routes/thing/+page.svelte':
				'<script>export let data;</script><svelte:component this={data.Thing} />',
			'src/routes/thing/_/Thing.svelte': '<p>thing</p>',
			'src/routes/thing/+page.server.js':
				"import Server from './Server.svelte';\nexport const load = () => ({});",
			'src/routes/thing/Server.svelte': '<p>server</p>',
		};
		for (const [file, source] of Object.entries(files)) {
			mkdirSync(dirname(resolve(project, file)), { recursive: true });
			writeFileSync(resolve(project, file), source);
		}
		const found = await routes(project);
		const thing = found.pages.find((one) => one.id === '/thing');
		// A server `load` returns data that crosses the wire, which no component does.
		expect(thing?.loaded).toEqual(['src/routes/Shell.svelte', 'src/routes/thing/_/Thing.svelte']);
		expect(found.pages.find((one) => one.id === '/')?.loaded).toEqual(['src/routes/Shell.svelte']);
	});
});
