// The sample project under Vite's dev server, as Kit serves it and as the fork does, every page
// asked of both: the responses have to be the same bytes but for what two servers' files and ports
// are, and the one difference the dev server declares. Then the project is edited under both, and
// the fork's answers follow the edit. See spec/build.md, "The dev server compiles a route when it is
// asked for".
//
// The fork's server refuses Kit's own root, so every answer that matches Kit's was rendered from a
// program the dev server compiled.
import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function serve(project: string, mode: 'kit' | 'fork', port: number): ChildProcess {
	const env: NodeJS.ProcessEnv = { ...process.env, SEAM_OUT: '.svelte-kit', SEAM: mode };
	// The dev server's own environment, which `vite dev` sets: the checks run under `production`.
	delete env['NODE_ENV'];
	if (mode === 'fork') env['SEAM_KIT_ROOT'] = 'throw';
	else delete env['SEAM_KIT_ROOT'];
	const log = openSync(resolve(project, 'dev.log'), 'w');
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

/** How many times the fork's server said it compiled `path`. */
function compiled(path: string): number {
	const log = readFileSync(resolve(forkDir, 'dev.log'), 'utf8');
	return log.split('\n').filter((line) => line.includes(`seam: compiled ${path} in `)).length;
}

const servers: ChildProcess[] = [];
const kitAnswers: Record<string, string> = {};
const forkAnswers: Record<string, string> = {};

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

	it('compiled the route the reroute hook named', () => {
		expect(compiled('/box')).toBeGreaterThan(0);
	});
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
		expect(compiled('/')).toBe(before);
	}, 60_000);

	it('answers with an error page where an edit makes a page CTR refuses', async () => {
		// Literal markup in the shape of the compile's own marker, which it cannot tell from one.
		edit(
			'src/routes/store/+page.svelte',
			'<script>let { data } = $props();</script><p>%%s0%% here</p><p>{data}</p>',
		);
		const after = await until('/store', 'could not be compiled');
		expect(after.startsWith('500\n')).toBe(true);
	}, 60_000);
});
