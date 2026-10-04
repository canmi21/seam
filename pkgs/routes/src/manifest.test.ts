import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compilerOptions } from './manifest.ts';

// Inside the package, so that the project's `@sveltejs/kit` and `vite` resolve by walking up.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-compiler-options');

describe('the compile options a project sets', () => {
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	// Kit 3 takes them as the plugin's argument, which is how its own `async` app turns the flag on;
	// read off `svelte.config.js` alone, every route of that app was compiled without it and refused.
	it("are read off Kit's plugin, where Kit 3 takes them", async () => {
		rmSync(root, { recursive: true, force: true });
		mkdirSync(resolve(root, 'src/routes'), { recursive: true });
		writeFileSync(resolve(root, 'package.json'), '{ "name": "sample", "private": true, "type": "module" }');
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
