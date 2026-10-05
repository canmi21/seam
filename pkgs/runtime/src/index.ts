/**
 * What a route's program calls while it writes the bytes: the parts of Svelte's server output that
 * are a rule rather than a value -- escaping, `hydratable`'s script, stepping through what waits --
 * and the few things the program needs of its host. The program is written by `@seam-js/program`
 * and handed this module whole. See spec/ir.md, "A route is one program".
 */
import { thenable, waiting } from './drive.ts';
import { escape } from './escape.ts';
import * as self from './index.ts';

export { drive, thenable, waited, waiting } from './drive.ts';
export { type Csp, hydratables, script } from './hydratable.ts';

/** A value written as character data, as Svelte's `escape_html` writes it. */
export function ec(value: unknown): string {
	return escape(value, 'content');
}

/** A value written inside an attribute's quotes. */
export function ea(value: unknown): string {
	return escape(value, 'attr');
}

/** A value written as it is: an `{@html}`, and the JSON a failed boundary opens with. */
export function es(value: unknown): string {
	return value === undefined || value === null ? '' : String(value);
}

/** Svelte's `replacements`, which has this one entry: `translate={true}` is written `"yes"`. */
export const TRANSLATE: ReadonlyMap<unknown, string> = new Map<unknown, string>([
	[true, 'yes'],
	[false, 'no'],
]);

/** What a lazily computed value holds before it is computed. */
export const UNSET: unique symbol = Symbol('seam.unset');

/**
 * Svelte's `ensure_array_like`, read out of `internal/server/index.js`: a falsy source is an
 * empty list, one with a `length` is itself, and anything else goes through `Array.from`. Null is
 * returned for nothing to iterate, which is what the caller writes nothing for.
 */
export function arrayLike(source: unknown): readonly unknown[] | null {
	if (!source) return null;
	// `.length !== undefined` on the value itself, not on an object -- a **string** has one, and
	// the loop that follows is `array[i]` for `i < array.length`, so a string iterates its
	// characters.
	const length = (source as { length?: unknown }).length;
	if (length !== undefined) {
		if (Array.isArray(source)) return source;
		// Read by index rather than through `Array.from`: a string holding an astral character has
		// a `length` of two and `s[0]` is half of it.
		const held: unknown[] = [];
		for (let at = 0; at < (length as number); at += 1) {
			held.push((source as Record<number, unknown>)[at]);
		}
		return held;
	}
	if (typeof source === 'object' && Symbol.iterator in source) {
		return Array.from(source as Iterable<unknown>);
	}
	return null;
}

/**
 * What a derivation's throw is wrapped in, naming the source that threw: the diagnostic a build's
 * author reads. The throw itself is the `cause`, and a boundary's catch -- which hands the author's
 * own error to the request's `transformError` -- takes the wrapper off by its `name`, so that
 * nothing carried imports this module.
 */
export class DerivationFailed extends Error {
	override name = 'DerivationFailed';
	constructor(source: string, cause: unknown) {
		super(`deriving \`${source}\` failed`, { cause });
	}
}

/** A derivation's value, with a rejection saying which derivation it was, the way a throw does. */
export function failing(value: unknown, source: string, asynchronous: boolean): unknown {
	if (!asynchronous || !thenable(value)) return value;
	return waiting(
		Promise.resolve(value).catch((error: unknown) => {
			throw new DerivationFailed(source, error);
		}),
	);
}

/**
 * The steps of a program that waits, each run inside what `enter` sets up and `leave` takes down:
 * Svelte's render context, which a program resumed after an `await` would otherwise run outside.
 */
export function entered<T>(
	steps: Generator<unknown, T, unknown>,
	enter: () => void,
	leave: () => void,
): Generator<unknown, T, unknown> {
	const step = (go: () => IteratorResult<unknown, T>): IteratorResult<unknown, T> => {
		enter();
		try {
			return go();
		} finally {
			leave();
		}
	};
	const wrapped = {
		next: (value?: unknown) => step(() => steps.next(value)),
		throw: (error?: unknown) => step(() => steps.throw(error)),
		return: (value: T) => steps.return(value),
		[Symbol.iterator]() {
			return wrapped;
		},
	};
	return wrapped as unknown as Generator<unknown, T, unknown>;
}

/** What a boundary's children came to: nothing thrown, or the transformed error and its JSON. */
export type Outcome = { threw: false } | { threw: true; value: unknown; json: string };

/** A boundary whose children threw nothing. */
export const SUCCEEDED: Outcome = Object.freeze({ threw: false });

/**
 * What a boundary's children threw, handed to the request's `transformError` as the author threw
 * it, and the value serialised as `Renderer.#serialize_failed_boundary` writes it: Svelte's own
 * default rethrows, which is what a server passing none gets here too. A promise where the transform
 * returns one. See `renderer.boundary` in Svelte's server renderer.
 */
export function failed(
	thrown: unknown,
	options: { transformError?: (error: unknown) => unknown } | undefined,
): Outcome | Promise<Outcome> {
	let error = thrown;
	while (
		typeof error === 'object' &&
		error !== null &&
		(error as { name?: unknown }).name === 'DerivationFailed' &&
		'cause' in error
	) {
		error = (error as { cause: unknown }).cause;
	}
	const transform =
		options?.transformError ??
		((one: unknown) => {
			throw one;
		});
	const value = transform(error);
	return thenable(value) ? Promise.resolve(value).then(serialised) : serialised(value);
}

function serialised(value: unknown): Outcome {
	const json = JSON.stringify(value) as string;
	return { threw: true, value, json: json.replace(/>/g, '\\u003e').replace(/</g, '\\u003c') };
}

/**
 * `$$rethrow(make)`: throws what `make` returns. A component throwing at the top of its script is
 * not entered and stands at its call site as a hole whose value is this, so the request throws what
 * Svelte's render of the component would have. See `./thrown.ts` in the skeleton package.
 */
export function rethrow(make: () => unknown): never {
	throw make();
}

/**
 * `$$html(value)`: a `{@html}` block's value with the anchor Svelte's development runtime opens it
 * with, a hash of the value -- what the dev server writes, where a build writes `<!---->` and the
 * IR holds it. Svelte's `hash`: djb2 over the text with carriage returns taken out, in base 36.
 * See spec/build.md, "How the dev server compiles a route".
 */
export function html(value: unknown): string {
	const text = String(value ?? '');
	const str = text.replace(/\r/g, '');
	let hash = 5381;
	let i = str.length;
	while (i--) hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
	return `<!--${(hash >>> 0).toString(36)}-->${text}`;
}

/** What a server render returns, as far as `ssr` reads it. */
interface Rendered {
	body: string;
	head: string;
}

/**
 * `$$ssr(Component, props, render, request, options)`: a component rendered by Svelte per request,
 * in the bytes the program writes -- declared SSR by its author, or degraded to it by a refusal. The
 * render is handed Kit's request context and the request's `transformError`, and what it writes is
 * the component's own bytes, the pair `render()` writes around a root taken off. See
 * spec/together.md, "Where SSR starts".
 */
export function ssr(
	component: unknown,
	props: Record<string, unknown>,
	render: (component: unknown, options: Record<string, unknown>) => Rendered | Promise<Rendered>,
	request: unknown,
	options?: { transformError?: unknown },
): string | Promise<string> {
	const done = render(component, {
		props,
		context: new Map([['__request__', request]]),
		...(options?.transformError === undefined ? {} : { transformError: options.transformError }),
	});
	const bare = ({ body }: Rendered): string => {
		const open = '<!--[-->';
		const close = '<!--]-->';
		return body.startsWith(open) && body.endsWith(close)
			? body.slice(open.length, body.length - close.length)
			: body;
	};
	// Read as it returns outside Svelte's async mode, where a render's result is its bytes; inside
	// it, reading them throws, and the result is awaited instead.
	try {
		return bare(done as Rendered);
	} catch (error) {
		if (typeof (done as Promise<Rendered>).then !== 'function') throw error;
		return (done as Promise<Rendered>).then(bare);
	}
}

const handed = (): Record<string, unknown> | undefined =>
	(globalThis as Record<symbol, unknown>)[Symbol.for('seam.kit')] as
		| Record<string, unknown>
		| undefined;

/**
 * `$$loaded(value)`: the path of the component a universal `load` imported that `value` is, or
 * null where it is none of them. The dispatcher hands a map from each such module to its path,
 * under `seam:loaded` on the framework's global. See spec/framework.md, "A component a `load`
 * returns".
 */
export function loaded(value: unknown): string | null {
	const map = handed()?.['seam:loaded'];
	return map instanceof Map ? ((map.get(value) as string | undefined) ?? null) : null;
}

/**
 * `import.meta.env`, written as `$$env()`: what the project's build replaced it with, which the
 * dispatcher, bundled by that build, hands under `import.meta.env` on the framework's global. See
 * spec/derivation.md, "`import.meta.env` is the build's".
 */
export function env(): Record<string, unknown> {
	return (handed()?.['import.meta.env'] as Record<string, unknown> | undefined) ?? {};
}

/** What a route's program is, once evaluated: the bytes for one request. */
export type Render = (
	props: Record<string, unknown>,
	options?: Record<string, unknown>,
	inject?: { csp?: { nonce?: string; hash?: boolean }; bare?: boolean },
) => Injected | Promise<Injected>;

/**
 * The bytes: the body and the head, what a `hash` policy has to allow, and whether the body was
 * handed without the pair `render()` writes around a root, which `bare` asks for.
 */
export interface Injected {
	body: string;
	head: string;
	hashes?: { script: string[] };
	bare?: true;
}

/**
 * A route's script evaluated: the carried bundle, then the program over its files. Once a process,
 * and handed this module whole, so the script imports nothing. See spec/build.md.
 */
export function evaluated(script: string, files?: Record<string, Record<string, unknown>>): Render {
	if (files !== undefined) {
		// The carried files as modules a host already loaded, which the dev server's are: the script is
		// the program alone. See spec/build.md, "How the dev server compiles a route".
		// eslint-disable-next-line no-new-func
		const make = new Function('$rt', '$files', `${script}\nreturn __program($rt, $files);`) as (
			runtime: unknown,
			files: unknown,
		) => Render;
		return make(self, files);
	}
	// eslint-disable-next-line no-new-func
	const make = new Function(
		'$rt',
		`${script}\nreturn __program($rt, typeof __carried === 'undefined' ? {} : (__carried.files ?? {}));`,
	) as (runtime: unknown) => Render;
	return make(self);
}
