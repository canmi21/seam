/**
 * The Rust half, called from the TypeScript one.
 *
 * Lowering runs at build time beside a compiler that is already Node. Shipping it as a native
 * binary would mean a package per platform, and esbuild ships twenty six of them; rewriting it
 * would mean maintaining the same thing twice. WebAssembly is neither, and the runtime that would
 * host it is already installed, being the same one running this file.
 *
 * There is no bindings generator and no glue. Those exist to carry structs and closures across a
 * boundary, and what goes across here is bytes, so the host side is this file and nothing is
 * generated to be named.
 *
 * **The unit is the project.** Measured over a thousand components, lowering's own work is 49ms
 * and starting a process a thousand times is 2.1 seconds. One call with the whole batch in it
 * costs 0.32ms for five megabytes, which is a `memcpy`.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Exports {
	memory: WebAssembly.Memory;
	allocate: (len: number) => number;
	lower: (ptr: number, len: number) => number;
	out_ptr: () => number;
	out_len: () => number;
}

/** What the compiler emits for one component. Shaped by `crates/lowering/src/ir.rs`. */
export interface Compiled {
	ir: unknown;
	derivations: unknown[];
}

export type Lowered = Compiled | { name: string; error: string };

let loaded: Exports | undefined;

function instance(): Exports {
	if (loaded !== undefined) return loaded;
	const file = resolve(dirname(fileURLToPath(import.meta.url)), '../lowering.wasm');
	// Synchronous, because compiling once at first use is simpler to reason about than a promise
	// every caller has to thread, and the module is small enough that it does not matter.
	const module = new WebAssembly.Module(readFileSync(file));
	loaded = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
	return loaded;
}

/** Compiles every skeleton in one call, in the order they were given. */
export function lower(batch: readonly (readonly [string, string])[]): Lowered[] {
	if (batch.length === 0) return [];
	const wasm = instance();
	const input = Buffer.from(JSON.stringify(batch));

	const at = wasm.allocate(input.length);
	// A view rather than a copy of the buffer: `memory.buffer` is detached and replaced whenever
	// the module grows its memory, so it is read again after every call into it.
	new Uint8Array(wasm.memory.buffer, at, input.length).set(input);

	if (wasm.lower(at, input.length) !== 0) {
		throw new Error('the batch handed to lowering could not be read');
	}
	const out = Buffer.from(new Uint8Array(wasm.memory.buffer, wasm.out_ptr(), wasm.out_len()));
	const lowered = JSON.parse(out.toString('utf8')) as Lowered[];
	for (const one of lowered) {
		if ('error' in one) continue;
		for (const derivation of one.derivations) {
			if (typeof derivation === 'object' && derivation !== null && 'expression' in derivation) {
				const held = derivation as { expression: unknown };
				if (typeof held.expression === 'string') held.expression = javascript(held.expression);
			}
		}
	}
	return lowered;
}

/**
 * The expression as JavaScript, which is what the IR carries and what every evaluator runs.
 *
 * A component written with `<script lang="ts">` writes its expressions with annotations and `as`
 * in them, and the walk copies them as written -- a derivation is the author's source, recorded
 * rather than rewritten. Svelte strips the types on its own way to the render; nothing did on the
 * way to the IR, and `new Function` then stopped at the first colon. This is the one point every
 * derivation passes through between the skeleton and the IR, so it is stripped here, with the
 * same stripper Node loads a `.ts` file with: types become whitespace and nothing else moves.
 * Wrapped in parentheses so an object literal is an expression rather than a block.
 */
export function javascript(expression: string): string {
	try {
		const stripped = stripTypeScriptTypes(`(${expression})`, { mode: 'strip' });
		return stripped.slice(1, -1);
	} catch {
		// Not TypeScript the stripper can read, so it is left as written and fails where it did.
		return expression;
	}
}
