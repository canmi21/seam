// The seam between this package and Svelte. For every case, the IR the compiler produced is
// injected here and rendered by Svelte's own server codegen, and the two are compared byte for
// byte. A Svelte release that changes an anchor or an escaping rule lands here.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile as compileSvelte } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, describe, expect, it } from 'vitest';
import { bindings } from 'ast';
import { carry } from 'carry';
import { compile as compileDerivations, type Derivation } from 'derive';
import { inject } from './index.ts';
import type { ComponentIR } from './ir.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, '../../../conformance/cases');
const staging = resolve(here, '../.build');

// Svelte's compiled output imports 'svelte/internal/server', which only resolves from inside this
// package, so the modules have to be written here rather than to a temporary directory. A case may
// import other components, so the whole tree is compiled and its specifiers rewritten to point at
// what was just written.
function compileTree(file: string, seen: Map<string, string>): string {
	const existing = seen.get(file);
	if (existing !== undefined) return existing;

	const source = readFileSync(file, 'utf8');
	const name = basename(file, '.svelte');
	// The same `rootDir` the compiler used. Svelte hashes the filename, made relative to `rootDir`,
	// into a head anchor and into a scoped class, so an oracle rooted somewhere else is rendering a
	// different component. See spec/build.md.
	let code = compileSvelte(source, { generate: 'server', name, filename: file, rootDir: cases }).js
		.code;

	for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
		const specifier = match[1];
		if (specifier === undefined) continue;
		// A component is compiled and pointed at; anything else the component imports is left alone
		// and pointed at where it already is, because the compiled file lands in a staging directory
		// from which a relative specifier would resolve to nothing.
		const target = resolve(dirname(file), specifier);
		const resolved = specifier.endsWith('.svelte') ? compileTree(target, seen) : target;
		code = code.replaceAll(`'${specifier}'`, JSON.stringify(pathToFileURL(resolved).href));
	}

	mkdirSync(staging, { recursive: true });
	const out = resolve(staging, `${name}-${seen.size}-${Date.now()}.js`);
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
	// `data` is what the load stage would have produced, not the props object: the one name it
	// arrives under is added by the renderer and by `derive`, not written in the fixture.
	const payloads = JSON.parse(readFileSync(resolve(cases, `${name}.data.json`), 'utf8')) as {
		label: string;
		data: unknown;
	}[];

	it.each(payloads.map((one) => [one.label, one.data] as const))('%s', async (_label, data) => {
		// Built here rather than committed. It is an artifact of the compiler and nobody reads one
		// in a diff, and a generated file the formatter then rewrites is a fight between two tasks
		// that only ever produces noise.
		const source = readFileSync(resolve(cases, file), 'utf8');
		const derive = compileDerivations(
			compiled.derivations,
			await carry(resolve(cases, file), new Map([[file, bindings(source).carried]])),
		);
		const mod = (await import(
			pathToFileURL(compileTree(resolve(cases, file), new Map())).href
		)) as { default: Parameters<typeof render>[0] };

		// Both streams, because the injector produces both and comparing one proves half.
		const expected = render(mod.default, { props: { data } as never });
		const actual = inject(compiled.ir, derive(data));
		expect(actual.body).toBe(expected.body);
		expect(actual.head).toBe(expected.head);
	});
});
