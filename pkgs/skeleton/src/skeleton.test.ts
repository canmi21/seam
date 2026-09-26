// The refusal surface, measured rather than remembered.
//
// `spec/refusals.md` used to carry a table of what the compiler turns away. It was maintained by
// recollection and it was wrong in both directions at once: it listed an each block with a key and
// `{:else}` on an each as unwritten when both compiled, and it did not mention `{@const}` at all,
// which compiled and rendered the wrong bytes. This file is that table, produced by running the
// compiler, so it cannot drift from what the compiler does.
//
// Two rules it enforces, both of them the specification's own:
//
// **An accepted construct has to agree with Svelte, on every payload.** Not on one. `{:else}` on
// an each looked correct against a list with something in it, because the branch it turns on only
// appears when the list is empty. Every case here carries the payload its shape turns on.
//
// **A refusal has to say where the question lives.** `spec/refusals.md` says a refusal owes the
// reader what it is and where it is recorded; a message that names no specification file has told
// the author their code is wrong and nothing else.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { compile, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carriedBy, carry } from 'carry';
import { joined } from 'compiler';
import { compile as compileDerivations, type Derivation } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { expressionsOf, helpers, skeleton } from './skeleton.ts';
import { configureUnnamedComponents } from './components.ts';
import { cases as eachCases } from './cases/each.ts';
import { cases as attributesCases } from './cases/attributes.ts';
import { cases as branchesCases } from './cases/branches.ts';
import { cases as snippetsCases } from './cases/snippets.ts';
import { cases as scriptCases } from './cases/script.ts';
import { cases as bindingsCases } from './cases/bindings.ts';
import { cases as componentsCases } from './cases/components.ts';
import { cases as storesCases } from './cases/stores.ts';
import { cases as boundaryCases } from './cases/boundary.ts';
import { cases as headCases } from './cases/head.ts';
import { cases as awaitsCases } from './cases/awaits.ts';
import { type Case, PROPS } from './cases/case.ts';
import { refused as refusedCases } from './cases/refused.ts';

// Its own directory: `skeleton()` stages Svelte's compiled output in `../.build` and removes it
// when it is done, which would take this with it halfway through a case.
const staging = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-surface');

const accepted: Case[] = [
	...eachCases,
	...attributesCases,
	...branchesCases,
	...snippetsCases,
	...scriptCases,
	...bindingsCases,
	...componentsCases,
	...storesCases,
	...boundaryCases,
	...headCases,
	...awaitsCases,
];

// Each one is a gap rather than a boundary, and the message has to say which.
const refused: Case[] = refusedCases;

/** Where one case's files go: its own directory under the staging root, named for the case. */
function staged(at: string): string {
	return resolve(staging, at);
}

/** Compiles one case, and says either what it produced or why it was turned away. */
async function attempt(
	one: Case,
	at: string,
): Promise<{
	ir?: Parameters<typeof inject>[0];
	derivations?: Derivation[];
	/** What the expressions call into, which a spread needs: `attributes` is Svelte's own. */
	carried?: string;
	refusal?: string;
}> {
	// A directory of its own per case. The siblings a case writes are named by the case, and two
	// cases naming a sibling alike in one directory made the later one overwrite the earlier --
	// silently, and read as an oracle rendering the wrong component. Three times before it was
	// found; the third was a `Calls.svelte` in two cases.
	const dir = staged(at);
	mkdirSync(dir, { recursive: true });
	const file = resolve(dir, 'entry.svelte');
	for (const [name, source] of Object.entries(one.beside ?? {})) {
		writeFileSync(resolve(dir, `${name}.svelte`), source);
	}
	for (const [name, source] of Object.entries(one.alongside ?? {})) {
		writeFileSync(resolve(dir, name), source);
	}
	for (const [name, source] of Object.entries(one.installed ?? {})) {
		const target = resolve(dir, 'node_modules', name);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, source);
	}
	writeFileSync(file, one.source);
	try {
		const rendered = await skeleton(file, staging, new Map(Object.entries(one.fixed ?? {})));
		const lowered = lower([[one.name, JSON.stringify(rendered)]])[0];
		if (lowered === undefined) return { refusal: 'nothing came back from lowering' };
		if ('error' in lowered) return { refusal: lowered.error };
		// Through `joined`, which is what a build goes through even for a component with one
		// structure: it is where the entry's prop defaults become derivations, and skipping it here
		// meant the check and the build compiled the same component two ways.
		const compiled = joined(
			one.name,
			[{ fixed: new Map(), decided: new Map(), compiled: lowered as never }],
			rendered.defaults,
		);
		return {
			ir: compiled.ir as Parameters<typeof inject>[0],
			derivations: compiled.derivations as Derivation[],
			// Gathered by the function the build gathers with, over the same files, so what the
			// check runs is what a page runs rather than a second arrangement of the same parts.
			carried: await carry(
				file,
				new Map([...carriedBy(staging, expressionsOf(rendered)), ['*', helpers(rendered)]]),
			),
		};
	} catch (error) {
		return { refusal: (error as Error).message };
	}
}

beforeAll(() => mkdirSync(staging, { recursive: true }));
afterAll(() => rmSync(staging, { recursive: true, force: true }));

// Svelte hashes a component's filename into the anchor that opens a `<svelte:head>` block and into
// the class that scopes a `<style>`, after making it relative to `rootDir` -- which defaults to
// `process.cwd()`. Left at the default, the directory the build ran from would be in the response
// bytes, and two people building one commit from different places would get different artifacts.
it('renders the same bytes from any working directory', async () => {
	const source = `${PROPS}<svelte:head><title>{data.a}</title></svelte:head><p>{data.a}</p>`;
	const file = resolve(staging, 'rooted.svelte');
	mkdirSync(staging, { recursive: true });
	writeFileSync(file, source);

	const before = process.cwd();
	const here = await skeleton(file, staging);
	process.chdir(tmpdir());
	try {
		expect(await skeleton(file, staging)).toEqual(here);
	} finally {
		process.chdir(before);
	}
});

// A default stands over the payload's key, not over each read of it, and this is the difference
// measured. Rewriting the reads is correct and was written first: `data_0.title` became
// `(typeof data_0 === 'undefined' ? null : data_0).title`, which is no longer a path, so every read
// of every prop with a default became a derivation -- and Kit's generated root declares
// `data_0 = null` per level of the route, so that was every read on every page of a real site. The
// bytes agree either way, which is why this asks the artifact rather than the output.
it('a default leaves a read of the prop a path, and costs one derivation', async () => {
	const source =
		'<script>let { form, page, data_0 = null } = $props();</script>' +
		'<h1>{data_0.title}</h1><p>{data_0.body}</p><a href={page.url}>{data_0.tag}</a>';
	const dir = staged('paths');
	mkdirSync(dir, { recursive: true });
	const file = resolve(dir, 'entry.svelte');
	writeFileSync(file, source);

	const rendered = await skeleton(file, staging);
	const lowered = lower([['paths', JSON.stringify(rendered)]])[0];
	if (lowered === undefined || 'error' in lowered) throw new Error('it did not compile');
	const compiled = joined(
		'paths',
		[{ fixed: new Map(), decided: new Map(), compiled: lowered as never }],
		rendered.defaults,
	);

	// One per prop, however many times the markup reads it: the one with a default holds it, and
	// the rest stand over their key holding `undefined`, which is what puts the name in scope for
	// a request that did not send it. Only the first compiles an expression.
	expect(compiled.derivations.map((one) => one.name)).toEqual(['form', 'page', 'data_0']);
	expect(compiled.derivations.filter((one) => one.expression !== 'undefined')).toHaveLength(1);
	const text = JSON.stringify(compiled.ir);
	for (const path of ['data_0.title', 'data_0.body', 'data_0.tag', 'page.url']) {
		expect(text, `\`${path}\` stopped being a path`).toContain(`"path":"${path}"`);
	}
});

describe('what the compiler accepts, it reproduces byte for byte', () => {
	it.each(accepted.map((one, at) => [one.name, one, at] as const))('%s', async (_name, one, at) => {
		const { ir, derivations, carried, refusal } = await attempt(one, `ok-${at}`);
		expect(refusal, 'it was refused instead, so the surface has moved').toBeUndefined();

		const dir = staged(`ok-${at}`);
		const file = resolve(dir, 'entry.svelte');
		const out = resolve(dir, 'entry.js');
		// The same `rootDir` the compiler used. Svelte hashes the filename, relative to it, into a
		// head anchor and into a scoped class, so an oracle rooted elsewhere renders a different
		// component. See spec/build.md.
		let code = compile(one.source, {
			generate: 'server',
			name: 'C',
			filename: file,
			rootDir: staging,
		}).js.code;
		// Bundled the way a page is, because Node cannot load a `.svelte` and this oracle is Node:
		// every component the entry reaches -- a sibling, a package's through its `exports` under
		// the `svelte` condition -- is compiled where it sits and its runes modules with it, and
		// Svelte's own runtime stays external so the render runs one copy of it.
		writeFileSync(out, code);
		const bundle = await rolldown({
			input: out,
			platform: 'node',
			resolve: { conditionNames: ['svelte', 'import', 'default'] },
			external: [/^svelte(?:\/|$)/],
			logLevel: 'silent',
			plugins: [
				{
					name: 'svelte',
					load(id) {
						if (id.endsWith('.svelte')) {
							return compile(readFileSync(id, 'utf8'), {
								generate: 'server',
								name: basename(id, '.svelte'),
								filename: id,
								rootDir: staging,
							}).js.code;
						}
						if (/\.svelte\.(?:js|ts)$/.test(id)) {
							const text = readFileSync(id, 'utf8');
							const source = id.endsWith('.ts') ? stripTypeScriptTypes(text) : text;
							return compileModule(source, { generate: 'server', filename: id }).js.code;
						}
						return null;
					},
				},
			],
		});
		const { output } = await bundle.generate({ format: 'es' });
		await bundle.close();
		const [chunk] = output;
		if (chunk === undefined) throw new Error('nothing came out of bundling the oracle');
		writeFileSync(out, chunk.code);
		const mod = (await import(pathToFileURL(out).href)) as {
			default: Parameters<typeof render>[0];
		};

		// Through `derive`, not around it. Injecting `{ data }` alone leaves every derived field
		// undefined, so an accepted case that produced one rendered empty and matched nothing --
		// which stayed invisible for as long as every accepted case here happened to have none.
		const derive = compileDerivations(derivations ?? [], carried ?? '');
		const payloads = one.props ?? (one.data ?? []).map((data) => ({ data }));
		for (const props of payloads) {
			// Both streams. The head used to go uncompared, and a headed component inside a body
			// block compiled to a head that held its block whichever branch the request took.
			const options =
				one.transformError === undefined ? {} : { transformError: one.transformError };
			const ours = await inject(ir as Parameters<typeof inject>[0], derive(props, options));
			const theirs = render(mod.default, { props: props as never, ...options });
			expect(ours.body).toBe(theirs.body);
			expect(ours.head).toBe(theirs.head);
		}
	});
});

describe('a component the request hands in that the source names none of', () => {
	const unnamed: Case = {
		name: 'unnamed',
		source: '<script>let { data } = $props();</script><svelte:component this={data.c} />',
	};

	it('throws per request for a value that is something', async () => {
		const { ir, derivations, carried, refusal } = await attempt(unnamed, 'unnamed-off');
		expect(refusal).toBeUndefined();
		const derive = compileDerivations(derivations ?? [], carried ?? '');
		let thrown: unknown;
		try {
			await inject(ir as Parameters<typeof inject>[0], derive({ data: { c: () => {} } }));
		} catch (error) {
			thrown = error;
		}
		// Through `derive`, which names the derivation and keeps the cause.
		const chain = [thrown, (thrown as { cause?: unknown } | undefined)?.cause]
			.map((one) => String((one as Error | undefined)?.message))
			.join(' <- ');
		expect(chain).toContain('a component the source does not name');
	});

	it('is refused at the build where the project asks for that', async () => {
		configureUnnamedComponents(true);
		try {
			const { refusal } = await attempt(unnamed, 'unnamed-on');
			expect(refusal).toContain('the source names none it could be');
		} finally {
			configureUnnamedComponents(false);
		}
	});
});

describe('what it refuses, it refuses by saying where the question lives', () => {
	it.each(refused.map((one, at) => [one.name, one, at] as const))('%s', async (_name, one, at) => {
		const { refusal } = await attempt(one, `no-${at}`);
		expect(refusal, 'it compiled instead, so the surface has moved').toBeDefined();
		// Checked rather than trusted. Four of these used to be a TypeError escaping from inside
		// the sentinel pass, which is an internal stack rather than anything an author can act on.
		expect(refusal, 'the message names no specification file').toContain('spec/');
		// Once. A message that already names a file has said where the question lives, and appending
		// the pointer anyway wrote two of them at the end of ten refusals.
		expect(
			(refusal ?? '').match(/See spec\/[\w-]+\.md/g) ?? [],
			'the message names two specification files, one after the other',
		).toHaveLength(1);
		if (one.says !== undefined) expect(refusal).toContain(one.says);
	});
});
