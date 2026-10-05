// What a route's program asks of the engine it runs in: nothing of Node's. Every corpus case's
// script -- the carried bundle and the program -- is run in QuickJS, with the runtime the program is
// handed bundled the way a backend that is not Node would carry it, and its bytes are held to what
// Node made of the same script. See spec/build.md, "A route is one script, and every backend runs
// it".
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC } from 'quickjs-emscripten';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';
import { carriedBy, carry } from '@seam-js/carry';
import { evaluated } from '@seam-js/injector/runtime';
import { expressionsOf, helpers } from '@seam-js/skeleton';
import { script, type Structure } from './index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = resolve(here, '../../../corpus/cases');
const runtimeEntry = fileURLToPath(import.meta.resolve('@seam-js/injector/runtime'));

/**
 * The runtime as one script assigning `__rt`, with `hydratable`'s record left out: it serialises
 * with Svelte's own devalue and hashes with the host's, and no case here records one.
 */
async function portableRuntime(): Promise<string> {
	const bundle = await rolldown({
		input: runtimeEntry,
		platform: 'neutral',
		plugins: [
			{
				name: 'no-hydratable',
				resolveId: (id) =>
					id.endsWith('/hydratable.ts') || id === './hydratable.ts' ? '\0hydratable' : null,
				load: (id) =>
					id === '\0hydratable'
						? "export const hydratables = () => { throw new Error('no hydratable here'); }; export const script = hydratables;"
						: null,
			},
		],
		logLevel: 'silent',
	});
	try {
		const { output } = await bundle.generate({ format: 'iife', name: '__rt' });
		return output[0]?.code ?? '';
	} finally {
		await bundle.close();
	}
}

const runtime = await portableRuntime();
// The engine's WebAssembly read from where it was installed: the suite resolves packages under the
// browser condition, whose QuickJS fetches its module over the network.
const wasm = readFileSync(
	resolve(
		dirname(
			createRequire(createRequire(import.meta.url).resolve('quickjs-emscripten')).resolve(
				'@jitl/quickjs-wasmfile-release-sync/package.json',
			),
		),
		'dist/emscripten-module.wasm',
	),
);
const quickjs = await newQuickJSWASMModuleFromVariant(
	newVariant(RELEASE_SYNC, {
		wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
	}),
);

const names = readdirSync(cases)
	.filter((one) => one.endsWith('.svelte'))
	.map((one) => one.slice(0, -'.svelte'.length))
	.toSorted();

describe.each(names)('%s', (name) => {
	const structure = JSON.parse(
		readFileSync(resolve(cases, `${name}.ir.json`), 'utf8'),
	) as Structure;
	const payloads = JSON.parse(readFileSync(resolve(cases, `${name}.data.json`), 'utf8')) as {
		label: string;
		data: unknown;
	}[];

	it.each(payloads.map((one) => [one.label, one.data] as const))('%s', async (_label, data) => {
		const skeleton = JSON.parse(
			readFileSync(resolve(cases, `${name}.skeleton.json`), 'utf8'),
		) as Parameters<typeof expressionsOf>[0];
		const carried = await carry(
			resolve(cases, `${name}.svelte`),
			new Map([...carriedBy(cases, expressionsOf(skeleton)), ['*', helpers(skeleton)]]),
		);
		const route = script(structure, carried);
		const inNode = await evaluated(route)({ data });

		const vm = quickjs.newContext();
		try {
			const ran = vm.evalCode(
				`${runtime}\n${route}\n` +
					`const __render = __program(__rt, typeof __carried === 'undefined' ? {} : (__carried.files ?? {}));\n` +
					`JSON.stringify(__render(${JSON.stringify({ data })}));`,
			);
			if (ran.error !== undefined) {
				const thrown = vm.dump(ran.error) as unknown;
				ran.error.dispose();
				throw new Error(`QuickJS threw: ${JSON.stringify(thrown)}`);
			}
			const inQuickJS = JSON.parse(vm.dump(ran.value) as string) as { body: string; head: string };
			ran.value.dispose();
			expect(inQuickJS.body).toBe(inNode.body);
			expect(inQuickJS.head).toBe(inNode.head);
		} finally {
			vm.dispose();
		}
	});
});
