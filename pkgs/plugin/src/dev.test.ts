// The sample project under Vite's dev server, as Kit serves it and as the fork does, every page
// asked of both: the fork answers with Kit's render, so the responses are the same bytes but for what
// two servers' files and ports are, and behind each the fork's check holds the program it compiled to
// what Kit wrote. Then the project is edited under both. See spec/build.md, "The dev server answers
// with Kit's render, and CTR is checked behind it".
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FORK, files, linked, outside, URLS, VENDOR, written } from './cases/sample.ts';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '../node_modules/.bin/vite');
const kitDir = resolve(here, '../.build-plugin-dev/kit');
const forkDir = resolve(here, '../.build-plugin-dev/fork');
const KIT_PORT = 4811;
const FORK_PORT = 4812;

/** What only the dev server meets, beside the sample every check shares. */
const devFiles: Record<string, string> = {
	// A `{@html}` block, which the development runtime opens with a hash of its value.
	'src/routes/html/+page.server.js':
		"export function load() { return { h: '<b>bold</b> & more' }; }",
	'src/routes/html/+page.svelte':
		'<script>let { data } = $props();</script><div>{@html data.h}</div>',
	// A component that throws under the dev server alone: `dev` is the compile's to know.
	'src/routes/thrown/+page.svelte':
		"<script>import { dev } from '$app/environment'; if (dev) { throw new Error('thrown in dev'); }</script><p>never</p>",
	// A path the universal `reroute` hook sends to another route, which is the one compiled.
	'src/hooks.js':
		"export const reroute = ({ url }) => (url.pathname === '/elsewhere' ? '/box' : undefined);",
	// A module that throws as it is evaluated: Kit's to answer, as it loads the page.
	'src/routes/broken/bad.js': 'export const bad = globalThis.nothing.here;',
	'src/routes/broken/+page.svelte': "<script>import { bad } from './bad.js';</script><p>{bad}</p>",
	// A select whose options the stylesheet scopes, which under the dev server is every element.
	'src/routes/option/+page.server.js': "export function load() { return { v: 'b' }; }",
	'src/routes/option/+page.svelte':
		'<script>let { data } = $props();</script><select value={data.v}><option value="a">A</option><option value="b">B</option></select><style>select { color: red; }</style>',
	// Kit's `error` called from the markup, which Kit reads by class: the carried module has to import
	// the module Kit's own code does, by the name the page wrote, or the class is another one.
	'src/routes/kit-error/[ok]/+page.server.js':
		"export function load({ params }) { return { ok: params.ok === 'yes' }; }",
	'src/routes/kit-error/[ok]/+page.svelte':
		"<script>import { error } from '@sveltejs/kit'; let { data } = $props();</script><p>{data.ok ? 'fine' : error(410, 'gone in render')}</p>",
	// A `$derived` in a class the page makes, read twice: one value only inside a render, which the
	// program enters through Svelte's own context module, the copy Kit's render runs on.
	'src/routes/derived-class/store.svelte.ts':
		'export class Store {\n\tconstructor(rows) { this.rows = rows; }\n\tbyId = $derived(new Map(this.rows.map((row) => [row.id, row])));\n}',
	'src/routes/derived-class/+page.server.js':
		'export function load() { return { rows: [{ id: 1 }, { id: 2 }] }; }',
	'src/routes/derived-class/+page.svelte':
		"<script>import { Store } from './store.svelte.ts'; let { data } = $props(); const store = new Store(data.rows);</script><p>{store.byId === store.byId}</p><p>{store.byId.size}</p>",
	// A page whose path is also a directory of static assets, which Vite does not answer for it.
	'static/shelf/note.txt': 'a static file',
	'src/routes/shelf/+page.svelte': '<p>shelf</p>',
	// A route whose id escapes a `%`, which Kit matches with `%25` left encoded.
	'src/routes/percent/[x+25]/+page.svelte': '<p>percent</p>',
	// `$app/manifest`, which Kit's dev server fills and the compile's own Vite must not empty.
	'src/routes/listed/+page.svelte':
		"<script>import { routes } from '$app/manifest';</script><p>{routes.length} routes</p>",
	// A misplaced element, which Svelte's `dev` writes a script into the head about, once.
	'src/routes/misplaced/Block.svelte': '<div>block</div>',
	'src/routes/misplaced/+page.svelte':
		"<script>import Block from './Block.svelte';</script><p><Block /></p>",
};

// The rerouted path first, before anything has asked for the route it renders.
const DEV_URLS = [
	'/elsewhere',
	...URLS,
	'/html',
	'/thrown',
	'/broken',
	'/option',
	'/misplaced',
	'/kit-error/yes',
	'/kit-error/no',
	'/derived-class',
	'/shelf',
	'/percent/%25',
];

/** What Svelte's development runtime writes into the head about a misplaced element. */
const MISPLACED =
	/<script>console\.error\("node_invalid_placement_ssr: (?:[^"\\]|\\.)*"\)<\/script>/g;

function serve(
	project: string,
	mode: 'kit' | 'fork',
	port: number,
	extra: NodeJS.ProcessEnv = {},
	logName = 'dev.log',
): ChildProcess {
	const env: NodeJS.ProcessEnv = { ...process.env, SEAM_OUT: '.svelte-kit', SEAM: mode, ...extra };
	// The dev server's own environment, which `vite dev` sets: the checks run under `production`.
	delete env['NODE_ENV'];
	if (mode === 'fork') env['SEAM_KIT_ROOT'] = 'throw';
	else delete env['SEAM_KIT_ROOT'];
	const log = openSync(resolve(project, logName), 'w');
	// Said, so that what the fork compiled can be counted: the sample's config keeps Vite silent.
	return spawn(bin, ['dev', '--port', String(port), '--strictPort', '--logLevel', 'info'], {
		cwd: project,
		env,
		stdio: ['ignore', log, log],
	});
}

async function answered(port: number): Promise<void> {
	for (let i = 0; i < 300; i += 1) {
		try {
			await fetch(`http://localhost:${String(port)}/__nothing`, { redirect: 'manual' });
			return;
		} catch {
			await new Promise((done) => setTimeout(done, 100));
		}
	}
	throw new Error(`nothing answered on ${String(port)}`);
}

/** The response, with where its server's files and Kit sit and its port written out. */
async function ask(port: number, url: string, project: string, kit: string): Promise<string> {
	const response = await fetch(`http://localhost:${String(port)}${url}`, {
		redirect: 'manual',
		headers: { accept: 'text/html' },
	});
	const text = (await response.text())
		.replace(MISPLACED, '')
		.replaceAll(project, '<project>')
		.replaceAll(`${kit}/src/`, '<kit>/')
		.replace(/localhost:\d+/g, 'localhost:<port>')
		.replace(/([?&]v=)[0-9a-f]{8}\b/g, '$1<v>');
	return `${String(response.status)}\n${text}`;
}

const kit = (url: string): Promise<string> => ask(KIT_PORT, url, kitDir, VENDOR);
const fork = (url: string): Promise<string> => ask(FORK_PORT, url, forkDir, FORK);

/** Writes `source` at `file` in both copies of the project. */
function edit(file: string, source: string): void {
	for (const project of [kitDir, forkDir]) writeFileSync(resolve(project, file), source);
}

/** The fork's answer for `url` once it holds `text`, waiting out the watcher and the compile. */
async function until(url: string, text: string): Promise<string> {
	let last = '';
	for (let i = 0; i < 200; i += 1) {
		last = await fork(url);
		if (last.includes(text)) return last;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`${url} never held ${text}: ${last.slice(0, 400)}`);
}

/** The fork's check log, once its checks have all ended: the last line it wrote is `idle`. */
async function quiet(): Promise<string> {
	const at = resolve(forkDir, '.svelte-kit/seam/dev.log');
	const read = (): string => {
		try {
			return readFileSync(at, 'utf8');
		} catch {
			return '';
		}
	};
	for (let i = 0; i < 600; i += 1) {
		const before = read();
		if (before.trimEnd().endsWith(' idle')) {
			await new Promise((done) => setTimeout(done, 500));
			if (read() === before) return before;
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	return read();
}

/** Waits until `ready` holds, a tenth of a second at a time, for at most thirty seconds. */
async function eventually(ready: () => boolean): Promise<void> {
	for (let i = 0; i < 300 && !ready(); i += 1) await new Promise((done) => setTimeout(done, 100));
}

/** How many times the fork's server said it compiled `path`. */
function compiled(path: string): number {
	const log = readFileSync(resolve(forkDir, 'dev.log'), 'utf8');
	return log.split('\n').filter((line) => line.includes(`seam: compiled ${path} in `)).length;
}

const servers: ChildProcess[] = [];
const kitAnswers: Record<string, string> = {};
const forkAnswers: Record<string, string> = {};
let checks = '';

beforeAll(async () => {
	for (const [project, mode] of [
		[kitDir, 'kit'],
		[forkDir, 'fork'],
	] as const) {
		written(project, { ...files, ...devFiles });
		outside(project);
		linked(project, mode);
	}
	servers.push(serve(kitDir, 'kit', KIT_PORT), serve(forkDir, 'fork', FORK_PORT));
	await Promise.all([answered(KIT_PORT), answered(FORK_PORT)]);
	for (const url of DEV_URLS) {
		kitAnswers[url] = await kit(url);
		forkAnswers[url] = await fork(url);
	}
	// Each route was compiled behind its first render; the second is the one held to Kit's.
	await quiet();
	for (const url of DEV_URLS) await fork(url);
	checks = await quiet();
}, 300_000);
afterAll(() => {
	for (const one of servers) one.kill();
	rmSync(resolve(here, '../.build-plugin-dev'), { recursive: true, force: true });
});

describe("the dev server answers as Kit's does", () => {
	it.each(DEV_URLS)('%s', (url) => {
		expect(forkAnswers[url]).toBe(kitAnswers[url]);
	});

	it('wrote the misplaced element only to the terminal', () => {
		const log = readFileSync(resolve(forkDir, 'dev.log'), 'utf8');
		expect(log).toContain('node_invalid_placement_ssr');
		expect(forkAnswers['/misplaced']).not.toContain('node_invalid_placement_ssr');
	});

	it("left `$app/manifest` as Kit's dev server wrote it, once the compile's own Vite was made", async () => {
		const ours = await fork('/listed');
		expect(ours).toBe(await kit('/listed'));
		expect(ours).not.toContain('<p>0 routes</p>');
		// Left alone rather than put back: a write is a full reload of the server.
		expect(readFileSync(resolve(forkDir, 'dev.log'), 'utf8')).not.toContain('app-manifest.js');
	});

	it('compiled the route the reroute hook named', () => {
		expect(compiled('/box')).toBeGreaterThan(0);
	});

	it("held every render to Kit's, and none disagreed", () => {
		for (const key of [
			'/',
			'/box',
			'/html',
			'/option',
			'/derived-class',
			'/kit-error/[ok]',
			'/shelf',
		]) {
			expect(checks).toContain(`held ${key}\n`);
		}
		expect(checks).not.toContain('disagreed');
		expect(checks).not.toContain('fault');
		// What the build renders by SSR, said while developing: the page it refuses, and the
		// component its author declared.
		expect(checks).toContain('ssr /marker');
		expect(checks).toContain('ssr /clocked: src/lib/twice.svelte renders by SSR');
	});
});

describe('a program that writes the wrong bytes', () => {
	it("is answered with Kit's bytes, compiled again, and then started over", async () => {
		const port = 4813;
		const child = serve(forkDir, 'fork', port, { SEAM_DEV_FAULT: '/box' }, 'fault.log');
		await answered(port);
		const expected = await kit('/box');
		const answers: string[] = [];
		for (let i = 0; i < 8; i += 1) {
			answers.push(await ask(port, '/box', forkDir, FORK));
			await new Promise((done) => setTimeout(done, 1000));
		}
		const alive = child.exitCode === null;
		child.kill();
		for (const one of answers) expect(one).toBe(expected);
		expect(alive).toBe(true);
		const log = readFileSync(resolve(forkDir, '.svelte-kit/seam/dev.log'), 'utf8');
		expect(log).toMatch(/disagreed \d+ \/box/);
		expect(log).toContain('fault: the program for /box still disagrees');
		const said = readFileSync(resolve(forkDir, 'fault.log'), 'utf8');
		expect(said).toContain(`The log is ${resolve(forkDir, '.svelte-kit/seam/dev.log')}`);
	}, 120_000);
});

describe('the dev server follows an edit', () => {
	it('compiles a page again once its component changes', async () => {
		const before = compiled('/');
		edit(
			'src/routes/+page.svelte',
			`${files['src/routes/+page.svelte'] ?? ''}<p class="edited">edited</p>`,
		);
		const after = await until('/', 'edited');
		expect(after).toBe(await kit('/'));
		await eventually(() => compiled('/') > before);
		expect(compiled('/')).toBeGreaterThan(before);
	}, 60_000);

	it("renders a server load's new data without compiling again", async () => {
		const before = compiled('/');
		edit(
			'src/routes/+page.server.js',
			"export function load() { return { title: 'Home again', items: ['x'] }; }",
		);
		const after = await until('/', 'Home again');
		expect(after).toBe(await kit('/'));
		await quiet();
		expect(compiled('/')).toBe(before);
	}, 60_000);

	it('says a page the build will render by SSR, and answers with it all the same', async () => {
		// Literal markup in the shape of the compile's own marker, which it cannot tell from one.
		edit(
			'src/routes/store/+page.svelte',
			'<script>let { data } = $props();</script><p>%%s0%% here</p><p>{data}</p>',
		);
		const after = await until('/store', '%%s0%% here');
		expect(after).toBe(await kit('/store'));
		expect(after.startsWith('200\n')).toBe(true);
		await eventually(() =>
			readFileSync(resolve(forkDir, '.svelte-kit/seam/dev.log'), 'utf8').includes('ssr /store'),
		);
		expect(readFileSync(resolve(forkDir, '.svelte-kit/seam/dev.log'), 'utf8')).toContain(
			'ssr /store',
		);
	}, 60_000);

	it("held what it rendered after the edits to Kit's as well", async () => {
		await quiet();
		const log = readFileSync(resolve(forkDir, '.svelte-kit/seam/dev.log'), 'utf8');
		const wrong = log
			.split('\n')
			.filter((line) => / disagreed \d+ /.test(line) && !line.includes(' /box:'));
		expect(wrong).toEqual([]);
	}, 60_000);
});

/** Builds the fork's copy as `vite build` does, with `env` beside the sample's; its exit and output. */
function build(env: NodeJS.ProcessEnv): { status: number | null; output: string } {
	const ran = spawnSync(bin, ['build', '--logLevel', 'info'], {
		cwd: forkDir,
		env: { ...process.env, SEAM_OUT: '.svelte-kit', SEAM: 'fork', NODE_ENV: 'production', ...env },
		encoding: 'utf8',
		maxBuffer: 1 << 28,
	});
	return { status: ran.status, output: `${ran.stdout}\n${ran.stderr}` };
}

function coverage(): Record<string, { render: string; why?: string }> {
	return (
		JSON.parse(
			readFileSync(resolve(forkDir, '.svelte-kit/output/server/seam/manifest.json'), 'utf8'),
		) as { coverage: Record<string, { render: string; why?: string }> }
	).coverage;
}

describe('the build, over the props kept in development', () => {
	beforeAll(() => {
		for (const one of servers) one.kill();
	});

	it('kept the props of the routes it rendered, one per shape', () => {
		const kept = readdirSync(
			resolve(forkDir, '.svelte-kit/seam/payloads', encodeURIComponent('/')),
		);
		expect(kept.length).toBeGreaterThan(0);
		expect(kept.length).toBeLessThanOrEqual(16);
	});

	it("holds each route's program to Svelte's render over them", () => {
		const { status, output } = build({});
		expect(status, output).toBe(0);
		expect(coverage()['/']?.render).toBe('ctr');
		expect(coverage()['/box']?.render).toBe('ctr');
	}, 300_000);

	it('renders a route that disagrees by SSR, and says so', () => {
		const { status, output } = build({ SEAM_VERIFY_FAULT: '/box' });
		expect(status, output).toBe(0);
		expect(coverage()['/box']?.render).toBe('ssr');
		expect(coverage()['/box']?.why).toContain('disagreed with Svelte');
		expect(output).toContain('/box renders by SSR');
	}, 300_000);

	it('fails the build instead, under strict', () => {
		const { status } = build({ SEAM_VERIFY_FAULT: '/box', SEAM_STRICT: '1' });
		expect(status).not.toBe(0);
	}, 300_000);
});
