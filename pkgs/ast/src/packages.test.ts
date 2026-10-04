import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveBare } from './packages.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-packages');

describe('a specifier resolved as a bundler resolves it', () => {
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	// TypeScript has a module imported by what it compiles to, and `status` imports
	// `#lib/source.js` for `src/lib/source.ts`: resolved to the `.js` that is not there, nothing
	// read the module, and what it reads of the server's environment went unseen.
	it('takes a `.js` that is not there for the `.ts` that is', () => {
		rmSync(root, { recursive: true, force: true });
		mkdirSync(resolve(root, 'src/lib'), { recursive: true });
		writeFileSync(
			resolve(root, 'package.json'),
			'{ "name": "sample", "type": "module", "imports": { "#lib/*": "./src/lib/*" } }',
		);
		writeFileSync(resolve(root, 'src/lib/source.ts'), 'export const a = 1;');
		writeFileSync(resolve(root, 'src/lib/plain.js'), 'export const b = 2;');
		const from = resolve(root, 'src/routes/+page.svelte');
		expect(resolveBare('#lib/source.js', from)).toBe(resolve(root, 'src/lib/source.ts'));
		expect(resolveBare('../lib/source.js', from)).toBe(resolve(root, 'src/lib/source.ts'));
		expect(resolveBare('#lib/plain.js', from)).toBe(resolve(root, 'src/lib/plain.js'));
	});
});
