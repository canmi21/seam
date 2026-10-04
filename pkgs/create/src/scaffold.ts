/**
 * A new project written to disk: the template copied, and the two files that depend on what was
 * asked -- the manifest and the Vite config -- written from the answers. See spec/publish.md,
 * "`create-seamjs`".
 */
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package a generated project installs the plugin from. See spec/publish.md. */
export const ENTRY = '@canmi/seamjs';

export const ADAPTERS = ['none', 'node'] as const;
export type Adapter = (typeof ADAPTERS)[number];

export interface Answers {
	/** Where the project goes, relative to the working directory or absolute. */
	dir: string;
	adapter: Adapter;
}

/** The template, beside `src/` here and beside `dist/` once compiled. */
const TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '../template');

/**
 * This package's version, which is the entry's: the two are released together, so the dependency
 * this writes names the entry released beside it. See spec/publish.md.
 */
function version(): string {
	const at = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
	return (JSON.parse(readFileSync(at, 'utf8')) as { version: string }).version;
}

/** Whether a directory can take a project: absent, or present and empty. */
export function usable(dir: string): boolean {
	return !existsSync(dir) || readdirSync(dir).length === 0;
}

function manifest(name: string, adapter: Adapter): string {
	const dependencies: Record<string, string> = {
		[ENTRY]: `^${version()}`,
		'@sveltejs/kit': '3.0.0',
		'@sveltejs/vite-plugin-svelte': '^7.3.1',
		svelte: '^5.57.1',
		typescript: '^6.0.3',
		vite: '^8.3.2',
	};
	if (adapter === 'node') dependencies['@sveltejs/adapter-node'] = '^6.0.0';
	return `${JSON.stringify(
		{
			name,
			private: true,
			version: '0.0.1',
			type: 'module',
			scripts: {
				dev: 'vite dev',
				build: 'vite build',
				preview: 'vite preview',
				prepare: "svelte-kit sync || echo ''",
			},
			devDependencies: Object.fromEntries(
				Object.entries(dependencies).toSorted(([a], [b]) => a.localeCompare(b)),
			),
		},
		null,
		'\t',
	)}\n`;
}

function viteConfig(adapter: Adapter): string {
	const node = adapter === 'node';
	return [
		...(node ? ["import adapter from '@sveltejs/adapter-node';"] : []),
		"import { sveltekit } from '@sveltejs/kit/vite';",
		`import { seam } from '${ENTRY}';`,
		"import { defineConfig } from 'vite';",
		'',
		'export default defineConfig({',
		`\tplugins: [sveltekit(${node ? '{ adapter: adapter() }' : ''}), seam()],`,
		'});',
		'',
	].join('\n');
}

/** Writes the project. The directory has to be `usable`. */
export function scaffold({ dir, adapter }: Answers): void {
	const target = resolve(dir);
	if (!usable(target)) throw new Error(`${dir} is not empty`);
	cpSync(TEMPLATE, target, { recursive: true });
	// npm drops a `.gitignore` from a published package, so the template carries it unprefixed.
	renameSync(resolve(target, 'gitignore'), resolve(target, '.gitignore'));
	writeFileSync(resolve(target, 'package.json'), manifest(basename(target), adapter));
	writeFileSync(resolve(target, 'vite.config.ts'), viteConfig(adapter));
}
