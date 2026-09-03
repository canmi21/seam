// The two things a DOM implementation cannot settle, in a real browser.
//
// The hydration check runs Svelte's client over every corpus document in jsdom, which is enough for
// anything whose signal is a DOM difference. Two claims are not that:
//
// **That a browser's parser agrees with parse5.** The normalisation stage puts what `{@html}`
// writes through parse5 so the fragment cannot rearrange the page around it, and jsdom parses with
// parse5 as well -- so it would be wrong in the same direction and agree anyway. Only a browser is
// the other party to that agreement.
//
// **That the scoped class selects anything.** The class is a hash of a filename that the compiler
// and the client build each give to Svelte, and a check can compare the two strings, which one
// does. Whether a rule then applies to an element is the cascade's answer, not a string's.
//
// It also runs the real client bundle rather than calling `hydrate` directly, so the entry the
// plugin generates, the tags the compiler wrote and the files the build emitted are all on the path
// for once. It is not part of `verify`: it needs a browser on the machine, and it is one step
// rather than the suite. See spec/build.md.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { compile as compileDerivations, type Derivation } from 'derive';
import type { ComponentIR } from 'injector';
import { seam } from 'plugin';
import { createServer } from './index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-browser');
const out = resolve(root, 'dist');

// The fragment from spec/refusals.md: written as it arrived it ends the container early and takes
// the closing anchor with it, which is the hydration failure normalisation exists to prevent.
const RAW = '</article><em>escaped';

const data = { name: 'Alice', html: RAW, available: true };

let browser: Browser;
let page: Page;
let close: () => Promise<void>;
const errors: string[] = [];

beforeAll(async () => {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(resolve(root, 'src'), { recursive: true });
	writeFileSync(
		resolve(root, 'src/Page.svelte'),
		`<script>let { data } = $props()</script>` +
			`<article class="card"><h1>{data.name}</h1>` +
			`<span class="raw">{@html data.html}</span><span class="after">after</span>` +
			// The handler writes to the document rather than to component state: local `$state` read
			// from markup is refused, since the server cannot render a value the payload does not
			// carry. What is being shown here is that the handler is attached at all.
			`{#if data.available}<button onclick={() => { document.body.dataset.clicked = 'yes' }}>buy</button>{/if}` +
			`</article>\n<style>.card { color: rgb(1, 2, 3) }</style>\n`,
	);
	writeFileSync(
		resolve(root, 'app.html'),
		'<!doctype html><html lang="en"><head><meta charset="utf-8" />%head%</head>' +
			'<body><div id="app">%body%</div></body></html>\n',
	);

	await build({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [seam({ entries: [{ path: '/', component: 'src/Page.svelte' }] })],
	});

	// A browser asks for this whether or not a page mentions it, and a 404 for it would be the only
	// thing in the console. Serving it keeps the assertion below strict: anything else that fails to
	// load is the build's own doing, which is what this is watching for.
	writeFileSync(resolve(out, 'client/favicon.ico'), '');

	const manifest = JSON.parse(readFileSync(resolve(out, 'server/manifest.json'), 'utf8')) as {
		routes: Record<string, { id: string; ir: string; carried: string | null; head: string }>;
	};
	const entry = manifest.routes['/'];
	if (entry === undefined) throw new Error('the build produced no route');
	const compiled = JSON.parse(readFileSync(resolve(out, 'server', entry.ir), 'utf8')) as {
		ir: ComponentIR;
		derivations: Derivation[];
	};

	const http = createServer({
		shell: readFileSync(resolve(out, 'server/app.html'), 'utf8'),
		staticRoot: resolve(out, 'client'),
		routes: {
			'/': {
				ir: compiled.ir,
				head: entry.head,
				derive: compileDerivations(compiled.derivations),
				data,
			},
		},
	});
	await new Promise<void>((done) => http.listen(0, done));
	const address = http.address();
	const port = typeof address === 'object' && address !== null ? address.port : 0;
	close = () => new Promise<void>((done) => http.close(() => done()));

	browser = await chromium.launch({ channel: 'chrome' });
	page = await browser.newPage();
	// Anything the client throws, including a hydration failure, arrives here.
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (one) => {
		if (one.type() === 'error') errors.push(one.text());
	});
	await page.goto(`http://localhost:${port}/`);
	await page.waitForSelector('button');
}, 120_000);

afterAll(async () => {
	await browser?.close();
	await close?.();
	rmSync(root, { recursive: true, force: true });
});

it('loads and hydrates without the client complaining', () => {
	expect(errors).toEqual([]);
});

// The cascade's answer, not a string comparison. The compiler and the client build each hand Svelte
// a filename and the class is a hash of it, so this is the two halves agreeing where it counts.
it('applies the scoped stylesheet to the element the compiler classed', async () => {
	const colour = await page.evaluate(
		() => getComputedStyle(document.querySelector('.card') as Element).color,
	);
	expect(colour).toBe('rgb(1, 2, 3)');
});

// A browser is the other party to the agreement parse5 stands in for everywhere else.
it('keeps a hostile raw fragment inside the element it was written into', async () => {
	const shape = await page.evaluate(() => {
		const raw = document.querySelector('.raw');
		const after = document.querySelector('.after');
		return {
			inside: raw?.parentElement?.tagName ?? null,
			// The sibling Svelte's client walks to when it looks for the end of a raw block.
			followed: raw?.nextElementSibling === after,
			escaped: document.querySelector('article > em') !== null,
		};
	});
	expect(shape.inside).toBe('ARTICLE');
	expect(shape.followed).toBe(true);
	expect(shape.escaped).toBe(false);
});

// The bundle ran, the entry the plugin generated found its payload, and the handler is attached:
// the whole client path, rather than `hydrate` called by hand.
it('is interactive once hydrated', async () => {
	expect(await page.evaluate(() => document.body.dataset['clicked'])).toBeUndefined();
	await page.click('button');
	await page.waitForFunction(() => document.body.dataset['clicked'] === 'yes');
	expect(await page.evaluate(() => document.body.dataset['clicked'])).toBe('yes');
});
