/**
 * SvelteKit's own test apps, built with this plugin and driven by Kit's own specs, unedited.
 *
 * Stage two of spec/conformance.md: `vendor/kit/test/apps/<name>` is one whole SvelteKit
 * application with a `test/` of Playwright specs, and the specs are the measurement -- what the
 * server sent, and what the client then did with it. Nothing under `vendor/` is written to, so
 * an app is staged into `.build-apps` first, in upstream's own layout so that every relative
 * import the harness makes still lands (`test/utils.js` reaches for `../../../test-utils`), and
 * the app's `node_modules` is this package's, which declares what upstream's workspace gave it.
 * Two files are written beside the app and nothing in it is touched: a Vite config that is the
 * app's own with `seam()` after `sveltekit()`, and a Playwright config that is the app's own with
 * the build and the preview run through that Vite config. See spec/conformance.md, "Stage 2".
 *
 *   node pkgs/apps/src/run.ts --app=basics --spec=server.test.js
 *   node pkgs/apps/src/run.ts --app=basics --spec=server.test.js --plain
 *
 * `--plain` builds the app as Kit alone builds it, which is what a failure is attributed against:
 * a spec that fails both ways is upstream's, or this machine's, and not this compiler's.
 */
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A `--name=value` argument, or undefined where none was given. */
function argument(name: string): string | undefined {
	return process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const need = createRequire(import.meta.url);
const vendor = resolve(dirname(need.resolve('@sveltejs/kit/package.json')));
const plugin = need.resolve('@canmi/seamjs');

const app = argument('app') ?? 'basics';
const spec = argument('spec');
const plain = process.argv.includes('--plain');

/** Upstream's layout, from the repository root down: `packages/kit/test` and `test-utils`. */
const stage = resolve(pkg, '.build-apps', plain ? 'plain' : 'seam');
const kitTest = resolve(stage, 'packages/kit/test');
const appDir = resolve(kitTest, 'apps', app);

if (!existsSync(resolve(vendor, 'test/apps', app))) {
	throw new Error(`no app named ${app} under ${resolve(vendor, 'test/apps')}`);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(dirname(kitTest), { recursive: true });
cpSync(resolve(vendor, 'test'), kitTest, { recursive: true });
cpSync(resolve(vendor, 'test-utils'), resolve(stage, 'test-utils'), { recursive: true });
// The app's dependencies are this package's: upstream's workspace gave each app `@sveltejs/kit`,
// `svelte`, `vite`, Playwright and the rest by catalog, and `package.json` here declares the same.
symlinkSync(resolve(pkg, 'node_modules'), resolve(appDir, 'node_modules'), 'dir');

const viteConfig = plain ? 'vite.config.js' : 'vite.seam.config.js';
if (!plain) {
	writeFileSync(
		resolve(appDir, viteConfig),
		[
			"// Written by pkgs/apps: the app's own config with the compiler's plugin after Kit's.",
			"import base from './vite.config.js';",
			`import { seam } from ${JSON.stringify(pathToFileURL(plugin).href)};`,
			'const config = typeof base === "function" ? await base({ command: "build", mode: "production" }) : base;',
			'export default { ...config, plugins: [...(config.plugins ?? []), seam()] };',
			'',
		].join('\n'),
	);
}
// Kit's own `test:build`: `pnpm build && pnpm preview --port <port> --strictPort`, with
// `PUBLIC_PRERENDERING=false` in the server's environment, from `playwright.config.js`.
const playwrightConfig = 'playwright.seam.config.js';
writeFileSync(
	resolve(appDir, playwrightConfig),
	[
		"// Written by pkgs/apps: the app's own config with the build and the preview run through",
		'// the Vite config beside it.',
		"import base from './playwright.config.js';",
		'const port = base.webServer.port;',
		'export default {',
		'\t...base,',
		'\twebServer: {',
		'\t\t...base.webServer,',
		`\t\tcommand: \`vite build --config ${viteConfig} && vite preview --config ${viteConfig} --port \${port} --strictPort\`,`,
		'\t},',
		'};',
		'',
	].join('\n'),
);

const bin = resolve(pkg, 'node_modules/.bin');
const env = {
	...process.env,
	PATH: `${bin}:${process.env['PATH'] ?? ''}`,
	PUBLIC_PRERENDERING: 'false',
	ROUTER_RESOLUTION: process.env['ROUTER_RESOLUTION'] ?? 'client',
};

// Upstream's `test:build` runs the app's own setup first, where it has one.
if (existsSync(resolve(appDir, 'test/playwright/setup.js'))) {
	const setup = spawnSync(process.execPath, ['test/playwright/setup.js'], {
		cwd: appDir,
		env,
		stdio: 'inherit',
	});
	if (setup.status !== 0) throw new Error(`the app's setup exited ${String(setup.status)}`);
}

const ran = spawnSync(
	resolve(bin, 'playwright'),
	['test', '--config', playwrightConfig, ...(spec === undefined ? [] : [spec])],
	{ cwd: appDir, env, stdio: 'inherit' },
);
if (ran.error !== undefined) throw ran.error;
process.exit(ran.status ?? 1);
