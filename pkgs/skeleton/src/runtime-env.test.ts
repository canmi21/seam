import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readsRuntimeEnv } from './dynamic.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-runtime-env');

describe("a module reading the server's environment", () => {
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	// `status`'s `projectUrl()` reads `$app/env/public` from `src/lib/source.ts`, which the layout
	// imports: the build answered it with the empty environment it ran in and wrote that into
	// every page, where Kit wrote the server's.
	it('is one whose functions the request decides, through whatever module it is reached by', () => {
		rmSync(root, { recursive: true, force: true });
		mkdirSync(root, { recursive: true });
		const files: Record<string, string> = {
			'source.ts':
				"import { PUBLIC_URL } from '$app/env/public';\nexport const url = () => PUBLIC_URL;",
			'nearer.ts': "import { url } from './source.js';\nexport const near = () => url();",
			'dynamic.ts': "import { env } from '$env/dynamic/public';\nexport const at = () => env.X;",
			'plain.ts': "import { near } from './static.js';\nexport const p = () => 1;",
			'static.ts': 'export const near = () => 2;',
		};
		for (const [file, source] of Object.entries(files)) writeFileSync(resolve(root, file), source);
		expect(readsRuntimeEnv(resolve(root, 'source.ts'))).toBe(true);
		expect(readsRuntimeEnv(resolve(root, 'nearer.ts'))).toBe(true);
		expect(readsRuntimeEnv(resolve(root, 'dynamic.ts'))).toBe(true);
		expect(readsRuntimeEnv(resolve(root, 'plain.ts'))).toBe(false);
	});
});
