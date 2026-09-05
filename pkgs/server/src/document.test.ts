// The whole document, under Svelte's own client.
//
// The corpus holds `inject(ir, scope)` against Svelte's server output byte for byte, and where two
// strings are identical a client cannot tell them apart. What the corpus does not cover is the
// document those bytes are placed in: the shell around them, the payload written beside them, and
// whether the data read back off the wire is the data the bytes were rendered from.
//
// **The assertion is differential, not absolute.** Hydration does not leave a correct document
// alone: Svelte removes the anchor that opens a head block on purpose -- `head_anchor.remove()`,
// "in case this component is repeated" -- and `set_style` writes `dom.style.cssText = ''` for an
// empty style, which materialises an attribute the server omitted. Neither is a mismatch, and a
// list of allowances for them would be this project reproducing Svelte's behaviour by hand, which
// is what it decided not to do when it stopped writing the bytes itself. So the same document is
// built twice, once from our IR and once from Svelte's own render, both are hydrated, and the two
// results are compared. See spec/pipeline.md.
//
// What that leaves this checking, which nothing else does: that the payload survives the wire and
// comes back as the value the bytes were rendered from, that the shell's own markup does not
// disturb the walk, and that hydration completes at all.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'devalue';
import { JSDOM } from 'jsdom';
import { compile as compileSvelte } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindings } from 'ast';
import { carry } from 'carry';
import { compile as compileDerivations, type Derivation } from 'derive';
import { inject, type ComponentIR } from 'injector';
import { normalized, rawPaths } from 'normalize';
import { wrap } from './document.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, '../../../corpus/cases');
const shell = readFileSync(resolve(here, '../app.html'), 'utf8');
const staging = resolve(here, '../.build-hydrate');

/**
 * A window, made here rather than by vitest's `jsdom` environment.
 *
 * That environment makes Vite treat the file as browser code and externalise `node:fs`, which this
 * needs in order to read the corpus at all. Building the window here keeps the file in Node, where
 * it belongs: what is under test is a document, not a browser.
 *
 * Svelte's client reads these off the global object, so a fresh window is installed before each
 * hydration rather than shared between them.
 */
const GLOBALS = [
	'window',
	'document',
	'HTMLElement',
	'Element',
	'Node',
	'Comment',
	'Text',
	'DocumentFragment',
	'CustomEvent',
	'Event',
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'getComputedStyle',
	'MutationObserver',
];

let hydrate: typeof import('svelte').hydrate;

beforeAll(async () => {
	install(new JSDOM('<!doctype html><html><head></head><body></body></html>').window);
	({ hydrate } = await import('svelte'));
});

function install(window: JSDOM['window']): Document {
	for (const key of GLOBALS) {
		const value = key === 'window' ? window : (window as unknown as Record<string, unknown>)[key];
		Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
	}
	return window.document as unknown as Document;
}

/**
 * One document, hydrated, and what it looked like afterwards.
 *
 * The payload is read back the way the client reads it -- `devalue.parse` off the embedded script
 * -- rather than passed through from the server, because that round trip is half of the contract
 * and the bytes cannot show it. See spec/payload.md.
 */
function hydrated(
	html: string,
	component: Parameters<typeof hydrate>[0],
): { before: string; after: string; wire: unknown } {
	const document = install(new JSDOM(html, { pretendToBeVisual: true }).window);
	const target = document.getElementById('app');
	expect(target, 'the shell has no mount point').not.toBeNull();

	const script = document.querySelector('[data-payload]');
	expect(script, 'no payload was embedded').not.toBeNull();
	const wire = parse(script?.textContent ?? 'null') as unknown;

	const before = document.documentElement.innerHTML;
	hydrate(component, { target: target as HTMLElement, props: { data: wire } });
	return { before, after: document.documentElement.innerHTML, wire };
}

/**
 * The component, compiled for one side and imported.
 *
 * Svelte's compiled output imports `svelte/internal/client` or `.../server`, which resolve from a
 * directory where svelte is a dependency, so the modules are written here. A case may import other
 * components, so the tree is compiled and its specifiers pointed at what was written.
 */
function compileTree(
	file: string,
	generate: 'client' | 'server',
	seen: Map<string, string>,
): string {
	const existing = seen.get(file);
	if (existing !== undefined) return existing;

	const source = readFileSync(file, 'utf8');
	const name = basename(file, '.svelte');
	// The same `rootDir` the compiler passed. Svelte hashes the filename into the anchor that opens
	// a `<svelte:head>` block, and the client compares what it finds against that hash.
	let code = compileSvelte(source, {
		generate,
		name,
		filename: file,
		rootDir: cases,
		dev: false,
	}).js.code;

	for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
		const specifier = match[1];
		if (specifier === undefined) continue;
		const target = resolve(dirname(file), specifier);
		const resolved = specifier.endsWith('.svelte') ? compileTree(target, generate, seen) : target;
		code = code.replaceAll(`'${specifier}'`, JSON.stringify(pathToFileURL(resolved).href));
	}

	mkdirSync(staging, { recursive: true });
	const out = resolve(staging, `${name}-${generate}-${seen.size}-${Date.now()}.js`);
	writeFileSync(out, code);
	seen.set(file, out);
	return out;
}

afterAll(() => rmSync(staging, { recursive: true, force: true }));

const files = readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted();

describe.each(files)('%s', (file) => {
	const name = file.slice(0, -'.svelte'.length);
	const compiled = JSON.parse(readFileSync(resolve(cases, `${name}.ir.json`), 'utf8')) as {
		ir: ComponentIR;
		derivations: Derivation[];
	};
	const payloads = JSON.parse(readFileSync(resolve(cases, `${name}.data.json`), 'utf8')) as {
		label: string;
		data: unknown;
	}[];

	it.each(payloads.map((one) => [one.label, one.data] as const))('%s', async (_label, data) => {
		const source = readFileSync(resolve(cases, file), 'utf8');
		const derive = compileDerivations(
			compiled.derivations,
			await carry(resolve(cases, file), new Map([[file, bindings(source).carried]])),
		);

		// What the server does, in the order it does it. The raw values go through a parser before
		// either the bytes or the wire see them, which is the only place that works: both are read
		// from the same object. See spec/refusals.md.
		const clean = normalized({ data }, rawPaths(compiled.ir))['data'];

		const client = (await import(
			pathToFileURL(compileTree(resolve(cases, file), 'client', new Map())).href
		)) as { default: Parameters<typeof hydrate>[0] };
		const server = (await import(
			pathToFileURL(compileTree(resolve(cases, file), 'server', new Map())).href
		)) as { default: Parameters<typeof render>[0] };

		const ours = inject(compiled.ir, derive(clean));
		const theirs = render(server.default, { props: { data: clean } as never });

		const mine = hydrated(wrap(shell, ours.body, clean, ours.head), client.default);
		const svelte = hydrated(wrap(shell, theirs.body, clean, theirs.head), client.default);

		// The payload came back as the value the bytes were rendered from. devalue rather than JSON,
		// because a Date, a Set or an undefined does not survive the other one, and a value that did
		// not survive is one the client renders from while the server rendered from another.
		expect(mine.wire).toEqual(clean);

		// The two documents are the same document. This is the assertion with teeth: a difference in
		// our bytes is repaired by the client, silently and in the direction of the payload, so both
		// documents converge and comparing only what they became would let it through. Measured, by
		// changing a word in the served bytes: the comparison below fails and the one after it does
		// not.
		expect(mine.before).toBe(svelte.before);

		// And they are still the same document once the client has run, which is what tolerates the
		// mutations hydration makes on purpose.
		expect(mine.after).toBe(svelte.after);
	});
});
