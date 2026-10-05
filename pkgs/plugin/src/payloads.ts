/**
 * The props a page was rendered with in development, kept per route and per shape, for the build to
 * hold the route's program to Svelte's render over. See spec/together.md, "The props a page was
 * rendered with, kept and replayed".
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, stringify } from 'devalue';

/** Where they are kept, under the artifacts' directory in Kit's output directory. */
export const PAYLOADS = 'payloads';

/** At most this many a route. */
export const MOST = 16;

/** A route's or error tree's directory: its key, encoded, which is one segment whatever it holds. */
export function payloadsOf(artifacts: string, key: string): string {
	return resolve(artifacts, PAYLOADS, encodeURIComponent(key));
}

/** An array's length as one of four: none, one, a few, many. */
function bucket(length: number): string {
	return length === 0 ? '0' : length === 1 ? '1' : length <= 5 ? 'few' : 'many';
}

/**
 * A payload's shape: the types of its values, its objects' keys, its arrays' lengths bucketed, and
 * what the first few items of an array are. Two payloads of one shape are one kind of request.
 */
export function shapeOf(value: unknown, depth = 0): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value !== 'object') return typeof value;
	if (depth > 8) return 'deep';
	if (Array.isArray(value)) {
		const items = [...new Set(value.slice(0, 3).map((one) => shapeOf(one, depth + 1)))];
		return `[${bucket(value.length)}:${items.join('|')}]`;
	}
	const kind = Object.prototype.toString.call(value).slice(8, -1);
	if (kind !== 'Object') return kind;
	return `{${Object.keys(value)
		.toSorted()
		.map((key) => `${key}:${shapeOf((value as Record<string, unknown>)[key], depth + 1)}`)
		.join(',')}}`;
}

/** What became of a payload offered for keeping. */
export type Kept = 'kept' | 'known' | 'full' | 'unwritable';

/** Keeps payloads under `artifacts`, a route at a time, remembering what each directory holds. */
export class Payloads {
	readonly #artifacts: () => string;
	readonly #held = new Map<string, Set<string>>();

	constructor(artifacts: () => string) {
		this.#artifacts = artifacts;
	}

	keep(key: string, payload: Record<string, unknown>): Kept {
		const dir = payloadsOf(this.#artifacts(), key);
		let held = this.#held.get(dir);
		if (held === undefined) {
			held = new Set(
				existsSync(dir)
					? readdirSync(dir)
							.filter((one) => one.endsWith('.devalue'))
							.map((one) => one.slice(0, -'.devalue'.length))
					: [],
			);
			this.#held.set(dir, held);
		}
		const name = createHash('sha256').update(shapeOf(payload)).digest('hex').slice(0, 16);
		if (held.has(name)) return 'known';
		if (held.size >= MOST) return 'full';
		let text: string;
		try {
			text = stringify(payload);
		} catch {
			// A function, a component a universal `load` returned: what devalue cannot write.
			return 'unwritable';
		}
		mkdirSync(dir, { recursive: true });
		writeFileSync(resolve(dir, `${name}.devalue`), text);
		held.add(name);
		return 'kept';
	}
}

/** The payloads kept for a route or error tree, with the file each came from. */
export function keptFor(
	artifacts: string,
	key: string,
): { file: string; payload: Record<string, unknown> }[] {
	const dir = payloadsOf(artifacts, key);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((one) => one.endsWith('.devalue'))
		.toSorted()
		.map((one) => ({
			file: resolve(dir, one),
			payload: parse(readFileSync(resolve(dir, one), 'utf8')) as Record<string, unknown>,
		}));
}
