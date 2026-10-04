/**
 * SvelteKit's own test apps, built with the fork as their Kit and driven by Kit's own specs, unedited.
 *
 * Stage two of spec/conformance.md: the specs are the measurement -- what the server sent, and
 * what the client then did with it. The app is staged by `./stage.ts`, and a Playwright config is
 * written beside it that is the app's own with the build and the preview run through the app's
 * own Vite config. See spec/conformance.md, "Stage 2".
 *
 *   node pkgs/apps/src/run.ts --app=basics --spec=server.test.js
 *   node pkgs/apps/src/run.ts --app=basics --spec=server.test.js --plain
 *
 * `--plain` builds the app as Kit alone builds it, which is what a failure is attributed against:
 * a spec that fails both ways is upstream's, or this machine's, and not this compiler's.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bin, stage } from './stage.ts';

/** A `--name=value` argument, or undefined where none was given. */
function argument(name: string): string | undefined {
	return process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const app = argument('app') ?? 'basics';
const spec = argument('spec');
const plain = process.argv.includes('--plain');

const { dir, viteConfig, mode, env } = stage(app, plain);
const modeFlag = mode === undefined ? '' : ` --mode ${mode}`;

// Kit's own `test:build`: `pnpm build && pnpm preview --port <port> --strictPort`.
const playwrightConfig = 'playwright.seam.config.js';
writeFileSync(
	resolve(dir, playwrightConfig),
	[
		"// Written by pkgs/apps: the app's own config with the build and the preview run through",
		'// the Vite config beside it.',
		"import base from './playwright.config.js';",
		'const port = base.webServer.port;',
		'export default {',
		'\t...base,',
		'\twebServer: {',
		'\t\t...base.webServer,',
		`\t\tcommand: \`vite build --config ${viteConfig}${modeFlag} && vite preview --config ${viteConfig} --port \${port} --strictPort\`,`,
		'\t},',
		'};',
		'',
	].join('\n'),
);

const ran = spawnSync(
	resolve(bin, 'playwright'),
	['test', '--config', playwrightConfig, ...(spec === undefined ? [] : [spec])],
	{ cwd: dir, env, stdio: 'inherit' },
);
if (ran.error !== undefined) throw ran.error;
process.exit(ran.status ?? 1);
