/**
 * The runes mode a project's `svelte.config.js` sets, held to Svelte's own output under it.
 *
 * Written as `sv create` writes it -- a function of the file that forces runes everywhere but
 * `node_modules` -- which is the form a boolean-only reading ignored. The same rune-less component
 * sits in both places, so one compile has to come out in runes mode and the other in legacy mode,
 * and the two are told apart by the anchor runes mode writes around a dotted component tag. See
 * spec/pipeline.md.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile as svelte, type CompileOptions } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile as deriving } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { joined, type Structure } from './variants.ts';
import { structures } from './compile.ts';

const staging = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-options');

const CONFIG =
	'export default { compilerOptions: { runes: ({ filename }) =>' +
	" filename.split(/[/\\\\]/).includes('node_modules') ? undefined : true } };\n";
const RUNES: CompileOptions['runes'] = ({ filename }) =>
	filename.split(/[/\\]/).includes('node_modules') ? undefined : true;

const PAGE =
	"<script>import child from './child.svelte'; const components = { child };</script>" +
	'<components.child />';
const CHILD = '<h1>hello</h1>';

beforeAll(() => {
	rmSync(staging, { recursive: true, force: true });
	for (const dir of ['src', 'node_modules/pkg']) {
		mkdirSync(resolve(staging, dir), { recursive: true });
		writeFileSync(resolve(staging, dir, 'page.svelte'), PAGE);
		writeFileSync(resolve(staging, dir, 'child.svelte'), CHILD);
	}
	writeFileSync(resolve(staging, 'svelte.config.js'), CONFIG);
});
afterAll(() => rmSync(staging, { recursive: true, force: true }));

/** Svelte's own render of `<dir>/page.svelte`, compiled with the option given. */
async function oracle(dir: string, runes: CompileOptions['runes']): Promise<string> {
	const tag = String(Math.random()).slice(2);
	const compiled = (name: string): string =>
		svelte(name === 'page' ? PAGE : CHILD, {
			generate: 'server',
			name: name[0]?.toUpperCase() + name.slice(1),
			filename: resolve(staging, dir, `${name}.svelte`),
			rootDir: staging,
			...(runes === undefined ? {} : { runes }),
		}).js.code;
	const child = resolve(staging, dir, `child-${tag}.js`);
	writeFileSync(child, compiled('child'));
	const out = resolve(staging, dir, `oracle-${tag}.js`);
	writeFileSync(
		out,
		compiled('page').replace(`'./child.svelte'`, JSON.stringify(pathToFileURL(child).href)),
	);
	const mod = (await import(pathToFileURL(out).href)) as { default: unknown };
	return render(mod.default as never, { props: {} as never }).body;
}

/** This compiler's bytes for `<dir>/page.svelte`, through the steps a build takes. */
async function ours(dir: string): Promise<string> {
	const runs = await structures({ path: '/', component: `${dir}/page.svelte` }, staging);
	const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
	const structure = joined(
		'page',
		runs.map((one, at) => ({
			fixed: one.fixed,
			decided: one.decided,
			compiled: lowered[at] as unknown as Structure,
		})),
	);
	return (await inject(structure.ir, deriving(structure.derivations, '')({}))).body;
}

describe("a project's runes option written as a function of the file", () => {
	it('forces runes mode on a file the function says so for', async () => {
		const forced = await oracle('src', RUNES);
		// The option is what moves the bytes: without it the same file infers legacy mode.
		expect(forced).not.toBe(await oracle('src', undefined));
		expect(await ours('src')).toBe(forced);
	});

	it('leaves a file under node_modules to what its scripts say', async () => {
		expect(await ours('node_modules/pkg')).toBe(await oracle('node_modules/pkg', RUNES));
	});
});

describe("a project's experimental.async", () => {
	const project = resolve(staging, 'async');
	const AWAITS = "<p>{await Promise.resolve('built')}</p>";

	beforeAll(() => {
		mkdirSync(project, { recursive: true });
		writeFileSync(resolve(project, 'page.svelte'), AWAITS);
		writeFileSync(
			resolve(project, 'svelte.config.js'),
			'export default { compilerOptions: { experimental: { async: true } } };\n',
		);
	});

	it('compiles an await the build can answer, and writes what Svelte writes', async () => {
		const out = resolve(project, 'oracle.js');
		writeFileSync(
			out,
			svelte(AWAITS, {
				generate: 'server',
				name: 'Page',
				filename: resolve(project, 'page.svelte'),
				rootDir: project,
				experimental: { async: true },
			}).js.code,
		);
		const mod = (await import(pathToFileURL(out).href)) as { default: unknown };
		const theirs = (await render(mod.default as never, { props: {} as never })).body;
		const runs = await structures({ path: '/', component: 'page.svelte' }, project);
		const lowered = lower(runs.map((one) => [one.id, JSON.stringify(one.skeleton)] as const));
		const structure = joined(
			'page',
			runs.map((one, at) => ({
				fixed: one.fixed,
				decided: one.decided,
				compiled: lowered[at] as unknown as Structure,
			})),
		);
		expect(theirs).toContain('built');
		expect((await inject(structure.ir, deriving(structure.derivations, '')({}))).body).toBe(theirs);
	});
});

describe('an await in a project in async mode, by what it waits on', () => {
	const project = resolve(staging, 'awaits');
	const write = (name: string, source: string): void =>
		writeFileSync(resolve(project, `${name}.svelte`), source);

	beforeAll(() => {
		mkdirSync(project, { recursive: true });
		writeFileSync(
			resolve(project, 'svelte.config.js'),
			'export default { compilerOptions: { experimental: { async: true } } };\n',
		);
		write(
			'request',
			'<script>let { data } = $props();</script><p>{await Promise.resolve(data.x)}</p>',
		);
	});

	it('refuses one of what the request decides, as async request-time rendering', async () => {
		await expect(structures({ path: '/', component: 'request.svelte' }, project)).rejects.toThrow(
			'an `await` of what the request decides',
		);
	});
});
