import { defineConfig } from 'tsdown';

/**
 * The packages npm gets, by directory, each compiled one file per source file into its `dist/`.
 * Not bundled, because the code hands its own files to other programs by path. See
 * spec/publish.md, "The layout is Kit's, compiled".
 */
const PUBLISHED = [
	'ast',
	'carry',
	'compiler',
	'program',
	'runtime',
	'lowering',
	'routes',
	'skeleton',
	'stream',
	'plugin',
	'create',
];

export default defineConfig(
	PUBLISHED.map((dir) => ({
		name: dir,
		cwd: `pkgs/${dir}`,
		entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/cases/**'],
		unbundle: true,
		platform: 'node',
		format: 'esm',
		fixedExtension: false,
		dts: true,
		copy: [{ from: '../../LICENSE' }],
	})),
);
