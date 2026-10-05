/**
 * What the program is written from, and what every part of writing it shares: the derivations as
 * the lowering names them, what the carried bundle holds, and the places a name is resolved from.
 */
import type { ComponentIR } from './ir.ts';
import { parsedExpression, type Node } from './rewrite.ts';

export type Source = { path: string } | { literal: string };

/** One value the program computes per request, as the lowering names it. */
export interface Derivation {
	name: string;
	expression: string;
	/** Always null: an entry's derivations are over the payload's own keys. */
	scope: Record<string, Source> | null;
	/** Computed where it is used, because it reads a name a block binds. */
	scoped?: boolean;
	/** A prop's default, taken where the payload's property is `undefined`. */
	prop?: boolean;
	/** A `hydratable` call the entry's script makes as it initializes, made whether or not read. */
	eager?: boolean;
	/** The files the expression was written across, innermost first. */
	files?: string[];
}

/** What one route compiled to: the IR and the derivations it reads. */
export interface Structure {
	ir: ComponentIR;
	derivations: readonly Derivation[];
}

/** One name a carried file holds, and whether it stands for Svelte's `hydratable`. */
export interface CarriedName {
	name: string;
	hydratable: boolean;
}

/** What each file of the carried bundle holds, by the file; `*` is the shared helpers. */
export type CarriedNames = Readonly<Record<string, readonly CarriedName[]>>;

/** One derivation as the program writes it. */
export interface Info {
	derivation: Derivation;
	index: number;
	kind: 'prop' | 'eager' | 'scoped' | 'lazy';
	asynchronous: boolean;
	/** The other derivations it awaits before it is evaluated. */
	awaited: readonly string[];
	/** The request's names: what its files mark as Svelte's `hydratable`. */
	marked: ReadonlySet<string>;
	/** A per-item one's: the names a block binds that it reads, which it is called with. */
	params: string[];
	/** Kept per item, where it computes something: a `{@const}` holding a call is computed once. */
	memo: boolean;
}

/** Where a name is being resolved from: one expression of one derivation, or a piece inside it. */
export interface Context {
	chain: readonly string[];
	/** The request's names at this place. */
	marked: ReadonlySet<string>;
	/** A piece's own parameters, which the piece reads as written. */
	pieceLocals?: ReadonlySet<string>;
	/** The derivation a piece sits in, whose data and files it reads after its own. */
	outer?: Context;
	/** A per-item derivation's: the block-bound names it reads, recorded as they are met. */
	params?: Set<string>;
	/** What an async derivation awaited first, by the read's text, read as its settled value. */
	awaitedSites?: ReadonlyMap<string, string>;
	/**
	 * A per-item read made more than once in one evaluation, kept in a variable of the function
	 * evaluating it: what the read is written as, and the declarations the function opens with.
	 */
	reads?: { seen: Map<string, string>; declared: string[] };
}

/** The names a walk has bound at one place: an each's item and index, a call's parameters. */
export interface Env {
	frames: Map<string, string>[];
	/** Whether this is the head stream, where a boundary reads what its body's half came to. */
	head?: boolean;
	/** A fragment's: block-bound names it reads from its caller, recorded as they are met. */
	open: Set<string> | null;
}

/** Where the payload's own object and the render options stand, beside the props. */
export const ROOT_SPECIAL: ReadonlySet<string> = new Set(['$$given', '$$options']);

/** What the runtime puts beside the shared helpers, under names nothing an author writes can be. */
export const RUNTIME: Readonly<Record<string, string>> = {
	$$rethrow: '$rt.rethrow',
	$$loaded: '$rt.loaded',
	$$env: '$rt.env',
};

/**
 * What the language defines, which no payload carries in place of: read as the host's without
 * asking the payload first.
 */
export const GLOBALS: ReadonlySet<string> = new Set([
	'undefined',
	'NaN',
	'Infinity',
	'globalThis',
	'Math',
	'JSON',
	'Object',
	'Array',
	'String',
	'Number',
	'Boolean',
	'Symbol',
	'BigInt',
	'Date',
	'RegExp',
	'Error',
	'TypeError',
	'RangeError',
	'SyntaxError',
	'ReferenceError',
	'Map',
	'Set',
	'WeakMap',
	'WeakSet',
	'WeakRef',
	'Promise',
	'Reflect',
	'Proxy',
	'Intl',
	'parseInt',
	'parseFloat',
	'isNaN',
	'isFinite',
	'encodeURIComponent',
	'decodeURIComponent',
	'encodeURI',
	'decodeURI',
	'console',
	'structuredClone',
	'URL',
	'URLSearchParams',
	'ArrayBuffer',
	'DataView',
	'Uint8Array',
	'Int8Array',
	'Uint16Array',
	'Int16Array',
	'Uint32Array',
	'Int32Array',
	'Float32Array',
	'Float64Array',
	'BigInt64Array',
	'BigUint64Array',
	'Uint8ClampedArray',
	'TextEncoder',
	'TextDecoder',
	'arguments',
]);

/** `import.meta.env` written as a read of `$$env()`: a script's body cannot hold `import.meta`. */
export const metaFree = (code: string): string =>
	code.replace(/\bimport\.meta\.env\b/g, () => '$$env()');

export const json = (value: unknown): string => JSON.stringify(value);

/** The variable a name a block binds is held in. */
export const local = (name: string): string => `$L_${name}`;

/** A node with the parentheses around it taken off. */
export function unwrapped(node: Node): Node {
	let at = node;
	while (at.type === 'ParenthesizedExpression') at = at['expression'] as Node;
	return at;
}

/** An expression's text with its outer parentheses and spacing taken off, under its files. */
export function textKey(files: readonly string[], text: string): string | null {
	let tree: Node;
	try {
		tree = unwrapped(parsedExpression(text));
	} catch {
		return null;
	}
	return `${files.join('\u0000')}\u0001${text.slice(tree.start, tree.end)}`;
}

/**
 * A derivation that is a whole keyless guard -- `$$tried($$request, null, () => (value))`, what a
 * boundary's child writes -- as the source it was read from and the node of the value; null for any
 * other.
 */
export function guarded(derivation: Derivation): { source: string; inner: Node } | null {
	const source = metaFree(derivation.expression);
	let tree: Node;
	try {
		tree = unwrapped(parsedExpression(source));
	} catch {
		return null;
	}
	if (tree.type !== 'CallExpression') return null;
	const callee = tree['callee'] as Node;
	const args = tree['arguments'] as Node[];
	const [, key, body] = args;
	if (
		callee.type !== 'Identifier' ||
		callee['name'] !== '$$tried' ||
		args.length !== 3 ||
		key?.type !== 'Literal' ||
		key['value'] !== null ||
		body?.type !== 'ArrowFunctionExpression' ||
		(body['params'] as unknown[]).length !== 0 ||
		(body['body'] as Node).type === 'BlockStatement'
	) {
		return null;
	}
	return { source, inner: body['body'] as Node };
}

/**
 * Which derivations wait, and on which others: one whose expression holds an `await`, and one that
 * reads one that waits, to the fixed point. See spec/derivation.md.
 */
export function waits(derivations: readonly Derivation[]): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const one of derivations) {
		if (/\bawait\b/.test(one.expression)) found.set(one.name, []);
	}
	for (let moved = true; moved;) {
		moved = false;
		for (const one of derivations) {
			const reads = [...found.keys()].filter(
				(name) =>
					name !== one.name &&
					new RegExp(`(?<![\\w$])${escaped(name)}(?![\\w$])`).test(one.expression),
			);
			const held = found.get(one.name);
			if (
				reads.length === 0 ||
				(held !== undefined && reads.every((name) => held.includes(name)))
			) {
				continue;
			}
			found.set(one.name, [...new Set([...(held ?? []), ...reads])]);
			moved = true;
		}
	}
	return found;
}

function escaped(name: string): string {
	return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
