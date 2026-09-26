/**
 * The values a request hands `hydratable`, and the script Svelte writes them into.
 *
 * Svelte's own `hydratable(key, fn)` records `fn()` under `key` while a render runs, and
 * `#render_async` writes every recorded value into a `<script>` ahead of the head, for the client
 * to read back instead of running `fn` again. A derivation runs outside any render, so the one it
 * calls is this: the same record, kept per request on the scope `derive` builds, and the same
 * script, written here once the page is injected. See spec/derivation.md.
 *
 * The serialization is Svelte's own devalue, resolved from where Svelte sits, because the bytes are
 * Svelte's and its devalue is not necessarily the one this repository pins: 6.0 changed how a
 * shared value is written, and Svelte 5.57 still depends on 5.x.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** Where the record a request's `hydratable` calls fill sits on the scope `derive` builds. */
export const HYDRATABLES = '$$hydratables';

/** One key's entry, as `encode` in Svelte's `internal/server/hydratable.js` makes it. */
interface Entry {
	value: unknown;
	serialized: string;
	promises?: Promise<unknown>[];
}

/** The record a request's `hydratable` calls fill, in the order they were made. */
export type Hydratables = Map<string, Entry>;

/** A content security policy a server hands the render. */
export interface Csp {
	nonce?: string;
	hash?: boolean;
}

type Uneval = (value: unknown, replacer?: (value: unknown, uneval: Uneval) => unknown) => string;

const need = createRequire(import.meta.url);
const svelteAt = need.resolve('svelte/package.json');
const devalue = (await import(pathToFileURL(createRequire(svelteAt).resolve('devalue')).href)) as {
	uneval: Uneval;
};

/**
 * A request's `hydratable`, and the record it fills.
 *
 * The first call under a key runs `fn` and records its value; a later one returns what was
 * recorded, which is what Svelte's does outside development. A promise is written as a placeholder
 * string and replaced with `r(...)` of its value once it settles, exactly as Svelte's `encode` does.
 */
export function hydratables(): {
	record: Hydratables;
	hydratable: (key: string, fn: () => unknown) => unknown;
} {
	const record: Hydratables = new Map();
	const hydratable = (key: string, fn: () => unknown): unknown => {
		const held = record.get(key);
		if (held !== undefined) return held.value;
		const value = fn();
		record.set(key, encode(value));
		return value;
	};
	return { record, hydratable };
}

function encode(value: unknown): Entry {
	const entry: Entry = { value, serialized: '' };
	let uid = 1;
	entry.serialized = devalue.uneval(value, (one, uneval) => {
		if (Object.prototype.toString.call(one) !== '[object Promise]') return undefined;
		const placeholder = `"${String(uid++)}"`;
		const settled = (one as Promise<unknown>).then((resolved) => {
			entry.serialized = entry.serialized.replace(placeholder, () => `r(${uneval(resolved)})`);
		});
		settled.catch(() => {});
		(entry.promises ??= []).push(settled);
		return placeholder;
	});
	return entry;
}

/**
 * The script `#hydratable_block` in Svelte's `internal/server/renderer.js` writes, with the hash a
 * `hash` policy asks for, or null where nothing was recorded. Every promise is waited on first,
 * which is why this is async.
 */
export async function script(
	record: Hydratables,
	csp: Csp | undefined,
): Promise<{ script: string; hash?: string } | null> {
	if (record.size === 0) return null;
	const entries: string[] = [];
	let promised = false;
	for (const [key, entry] of record) {
		if (entry.promises !== undefined) {
			promised = true;
			await Promise.all(entry.promises);
		}
		entries.push(`[${devalue.uneval(key)},${entry.serialized}]`);
	}
	let prelude = `const h = (window.__svelte ??= {}).h ??= new Map();`;
	if (promised) prelude = `const r = (v) => Promise.resolve(v);\n\t\t\t\t${prelude}`;
	const body = `\n\t\t\t{\n\t\t\t\t${prelude}\n\n\t\t\t\tfor (const [k, v] of [\n\t\t\t\t\t${entries.join(',\n\t\t\t\t\t')}\n\t\t\t\t]) {\n\t\t\t\t\th.set(k, v);\n\t\t\t\t}\n\t\t\t}\n\t\t`;
	if (csp?.nonce !== undefined && csp.nonce !== '') {
		return { script: `\n\t\t<script nonce="${csp.nonce}">${body}</script>` };
	}
	const written = `\n\t\t<script>${body}</script>`;
	if (csp?.hash === true) {
		return {
			script: written,
			hash: `sha256-${createHash('sha256').update(body).digest('base64')}`,
		};
	}
	return { script: written };
}
