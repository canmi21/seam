import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ENTRY, scaffold } from './scaffold.ts';

describe('scaffold', () => {
	const root = mkdtempSync(join(tmpdir(), 'seam-create-'));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('writes a project that installs the entry and none of the adapters', () => {
		const dir = join(root, 'plain');
		scaffold({ dir, adapter: 'none' });
		const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
			name: string;
			devDependencies: Record<string, string>;
		};
		expect(manifest.name).toBe('plain');
		expect(manifest.devDependencies[ENTRY]).toMatch(/^\^\d/);
		expect(manifest.devDependencies['@sveltejs/adapter-node']).toBeUndefined();
		expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toContain('sveltekit(), seam()');
		// Carried unprefixed, since npm drops a `.gitignore` from what it publishes.
		expect(existsSync(join(dir, '.gitignore'))).toBe(true);
		expect(existsSync(join(dir, 'gitignore'))).toBe(false);
	});

	it('hands the node adapter to Kit when it is asked for', () => {
		const dir = join(root, 'node');
		scaffold({ dir, adapter: 'node' });
		const manifest = readFileSync(join(dir, 'package.json'), 'utf8');
		expect(manifest).toContain('@sveltejs/adapter-node');
		expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toContain(
			'sveltekit({ adapter: adapter() })',
		);
	});

	it('refuses a directory that already holds something', () => {
		const dir = join(root, 'taken');
		scaffold({ dir, adapter: 'none' });
		writeFileSync(join(dir, 'kept.txt'), 'mine');
		expect(() => scaffold({ dir, adapter: 'none' })).toThrow('is not empty');
	});
});
