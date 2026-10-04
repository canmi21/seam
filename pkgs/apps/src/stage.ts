/**
 * One of SvelteKit's own test apps, staged where it can be built and run without writing under
 * `vendor/`.
 *
 * `vendor/kit/test/apps/<name>` is one whole SvelteKit application, and it is staged into
 * `.build-apps` in upstream's own layout so that every relative import the harness makes still
 * lands (`test/utils.js` reaches for `../../../test-utils`), with this package's `node_modules`,
 * which declares what upstream's workspace gave it. Nothing in the app is touched: built as Kit
 * builds it, its `@sveltejs/kit` is `vendor/kit`, and built as this framework builds it, that one
 * dependency is the fork, as the alias would install it. See spec/conformance.md, "Stage 2".
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const pkg = resolve(here, '..');
const need = createRequire(import.meta.url);
export const vendor = resolve(dirname(need.resolve('@sveltejs/kit/package.json')));
/** The fork, which a project installs in Kit's place. See pkgs/framework/FORK.md. */
const fork = resolve(pkg, '../framework');
export const bin = resolve(pkg, 'node_modules/.bin');

export interface Staged {
	/** The app's directory inside the stage. */
	dir: string;
	/** The Vite config a build and a preview of it are run through: the app's own, either way. */
	viteConfig: string;
	/** The app's own Vite config. */
	baseConfig: string;
	/** The `--mode` the app's own `build` script passes, where it passes one. */
	mode: string | undefined;
	/** What the app's own `preview` script sets before it serves: `RUNTIME_ONLY=secret` for `options-2`. */
	previewEnv: Record<string, string>;
	/** What Kit's own `test:build` runs the app's commands with. */
	env: NodeJS.ProcessEnv;
}

/**
 * The config and the mode the app's own `build` script names: `vite build -c vite.custom.config.js
 * --mode custom` for `options`, and Vite's defaults for the rest.
 */
function buildScript(app: string): {
	config: string;
	mode: string | undefined;
	previewEnv: Record<string, string>;
} {
	const manifest = JSON.parse(
		readFileSync(resolve(vendor, 'test/apps', app, 'package.json'), 'utf8'),
	) as {
		scripts?: Record<string, string>;
	};
	const build = manifest.scripts?.['build'] ?? '';
	const preview = manifest.scripts?.['preview'] ?? '';
	// The assignments a script line opens with, before the command: `A=1 B=2 vite preview`.
	const previewEnv: Record<string, string> = {};
	for (const one of /^((?:\w+=\S*\s+)*)/.exec(preview)?.[1]?.trim().split(/\s+/) ?? []) {
		const at = one.indexOf('=');
		if (at > 0) previewEnv[one.slice(0, at)] = one.slice(at + 1);
	}
	return {
		config: /(?:-c|--config)\s+(\S+)/.exec(build)?.[1] ?? 'vite.config.js',
		mode: /--mode\s+(\S+)/.exec(build)?.[1],
		previewEnv,
	};
}

/** Where `app` is staged, and what it runs with, without staging it. */
export function staged(app: string, plain: boolean): Staged {
	const dir = resolve(pkg, '.build-apps', plain ? 'plain' : 'seam', 'packages/kit/test/apps', app);
	const { config, mode, previewEnv } = buildScript(app);
	// Kit's own `test:build` runs with `PUBLIC_PRERENDERING=false` in the server's environment,
	// from `playwright.config.js`.
	const env = {
		...process.env,
		PATH: `${bin}:${process.env['PATH'] ?? ''}`,
		PUBLIC_PRERENDERING: 'false',
		ROUTER_RESOLUTION: process.env['ROUTER_RESOLUTION'] ?? 'client',
	};
	return {
		dir,
		viteConfig: config,
		baseConfig: config,
		mode,
		previewEnv,
		env,
	};
}

/**
 * Stages `app` under `.build-apps`, built as Kit alone builds it when `plain`, and runs the app's
 * own setup where it has one, as upstream's `test:build` does first.
 */
export function stage(app: string, plain: boolean): Staged {
	if (!existsSync(resolve(vendor, 'test/apps', app))) {
		throw new Error(`no app named ${app} under ${resolve(vendor, 'test/apps')}`);
	}
	const { dir, viteConfig, baseConfig, mode, previewEnv, env } = staged(app, plain);
	const root = resolve(pkg, '.build-apps', plain ? 'plain' : 'seam');
	const kitTest = resolve(root, 'packages/kit/test');

	rmSync(root, { recursive: true, force: true });
	mkdirSync(dirname(kitTest), { recursive: true });
	cpSync(resolve(vendor, 'test'), kitTest, { recursive: true });
	cpSync(resolve(vendor, 'test-utils'), resolve(root, 'test-utils'), { recursive: true });
	// The app's dependencies are this package's: upstream's workspace gave each app `@sveltejs/kit`,
	// `svelte`, `vite`, Playwright and the rest by catalog, and `package.json` here declares the same.
	if (plain) symlinkSync(resolve(pkg, 'node_modules'), resolve(dir, 'node_modules'), 'dir');
	else forked(root, dir);

	if (existsSync(resolve(dir, 'test/playwright/setup.js'))) {
		const setup = spawnSync(process.execPath, ['test/playwright/setup.js'], {
			cwd: dir,
			env,
			stdio: 'inherit',
		});
		if (setup.status !== 0) throw new Error(`the app's setup exited ${String(setup.status)}`);
	}
	return { dir, viteConfig, baseConfig, mode, previewEnv, env };
}

/**
 * The app's `node_modules` as a project that swapped Kit for the fork by the alias would have it:
 * this package's, with `@sveltejs/kit` the fork. A package of the app's that imports Kit itself
 * has to reach the fork too, as the alias would make it: `test-redirect-importer` is there to
 * throw Kit's `redirect` from outside the app, and the one it threw from `vendor/kit` is not the
 * class the fork's runtime tests for. It is staged beside the app with the fork as its Kit.
 */
function forked(root: string, dir: string): void {
	const from = resolve(pkg, 'node_modules');
	const into = resolve(dir, 'node_modules');
	const importer = resolve(root, 'test-redirect-importer');
	cpSync(dirname(need.resolve('test-redirect-importer')), importer, {
		recursive: true,
		filter: (one) => !one.includes('/node_modules'),
	});
	mkdirSync(resolve(importer, 'node_modules/@sveltejs'), { recursive: true });
	symlinkSync(fork, resolve(importer, 'node_modules/@sveltejs/kit'), 'dir');
	const instead: Record<string, string> = {
		'@sveltejs/kit': fork,
		'test-redirect-importer': importer,
	};
	mkdirSync(into, { recursive: true });
	for (const name of readdirSync(from)) {
		const names = name.startsWith('@')
			? readdirSync(resolve(from, name)).map((one) => `${name}/${one}`)
			: [name];
		for (const one of names) {
			mkdirSync(dirname(resolve(into, one)), { recursive: true });
			symlinkSync(instead[one] ?? realpathSync(resolve(from, one)), resolve(into, one), 'dir');
		}
	}
}
