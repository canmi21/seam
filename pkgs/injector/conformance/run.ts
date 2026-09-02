// The seam between this package and Svelte. For every case, the IR the compiler produced is
// injected here and rendered by Svelte's own server codegen, and the two are compared byte for
// byte. A Svelte release that changes an anchor or an escaping rule lands here.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile as compileSvelte } from 'svelte/compiler';
import { render } from 'svelte/server';
import { compile as compileDerivations, type Derivation } from 'derive';
import { inject, type Injected } from '../src/index.ts';
import type { ComponentIR } from '../src/ir.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, '../../../conformance/cases');
const staging = resolve(here, '.build');

// Svelte's compiled output imports 'svelte/internal/server', which only resolves from inside
// this package, so the modules have to be written here rather than to a temporary directory.
// A case may import other components, so the whole tree is compiled and its specifiers rewritten
// to point at what was just written.
function compileTree(file: string, seen: Map<string, string>): string {
	const existing = seen.get(file);
	if (existing !== undefined) return existing;

	const source = readFileSync(file, 'utf8');
	const name = basename(file, '.svelte');
	let code = compileSvelte(source, { generate: 'server', name, filename: file }).js.code;

	for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
		const specifier = match[1];
		if (specifier === undefined) continue;
		// A component is compiled and pointed at; anything else the component imports is left
		// alone and pointed at where it already is, because the compiled file lands in a staging
		// directory from which a relative specifier would resolve to nothing.
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

/**
 * Both streams, because the injector now produces both and only comparing one proves half.
 *
 * The load stage's output goes in under the one name the protocol gives it, which is the same
 * arrangement the server uses and the same one the client hydrates with. See spec/payload.md.
 */
async function svelteRenderer(file: string): Promise<(data: unknown) => Injected> {
	const mod = await import(pathToFileURL(compileTree(file, new Map())).href);
	return (data) => {
		const { body, head } = render(mod.default, { props: { data } });
		return { body, head };
	};
}

let failed = 0;
let total = 0;

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted()) {
	const name = file.slice(0, -'.svelte'.length);
	const compiled = JSON.parse(readFileSync(resolve(cases, `${name}.ir.json`), 'utf8')) as {
		ir: ComponentIR;
		derivations: Derivation[];
	};
	// The bundle sits beside the IR when the component's expressions call into one.
	const script = resolve(cases, `${name}.carried.js`);
	const derive = compileDerivations(
		compiled.derivations,
		existsSync(script) ? readFileSync(script, 'utf8') : '',
	);
	// `data` here is what the load stage would have produced, not the props object: the one
	// name it arrives under is added by the renderer and by `derive`, not written in the fixture.
	const payloads = JSON.parse(readFileSync(resolve(cases, `${name}.data.json`), 'utf8')) as {
		label: string;
		data: unknown;
	}[];
	const svelte = await svelteRenderer(resolve(cases, file));

	for (const payload of payloads) {
		total += 1;
		const expected = svelte(payload.data);
		const actual = inject(compiled.ir, derive(payload.data));
		if (expected.body === actual.body && expected.head === actual.head) {
			console.log(`match  ${name}: ${payload.label}`);
			continue;
		}
		failed += 1;
		console.log(`DIFF   ${name}: ${payload.label}`);
		console.log(`   svelte: ${JSON.stringify(expected)}`);
		console.log(`   ours:   ${JSON.stringify(actual)}`);
	}
}

rmSync(staging, { recursive: true, force: true });
console.log(`\n${total - failed}/${total} agree with Svelte`);
if (failed > 0) process.exit(1);
