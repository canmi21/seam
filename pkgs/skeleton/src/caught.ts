/**
 * What a derivation reads of a `<svelte:boundary>` whose children may throw, carried into the
 * route's bundle beside Svelte's own helpers. See spec/ir.md, "A boundary that may throw is a block
 * of its own, lowered to an `if`".
 */

type Transform = (error: unknown) => unknown;
type Outcome = { threw: false } | { threw: true; value: unknown; json: string };

const thenable = (value: unknown): value is PromiseLike<unknown> =>
	typeof (value as { then?: unknown } | null)?.then === 'function';

/** Whether a throw is `derive`'s account of a derivation failing, carrying the throw as `cause`. */
const isWrapped = (value: unknown): value is { cause: unknown } =>
	typeof value === 'object' &&
	value !== null &&
	(value as { name?: unknown }).name === 'DerivationFailed' &&
	'cause' in value;

/**
 * What a boundary's run computed, per request: the outcome under the boundary's key, and each value
 * under its guard's. Keyed by the request's own object, which `derive` binds as `$$request` for every
 * derivation of one request and for no other, so a table lives exactly as long as its request. See
 * spec/ir.md, "A value is computed once, by the run, and the hole reads it".
 */
const tables = new WeakMap<object, Map<string, unknown>>();

const table = (request: unknown): Map<string, unknown> | null => {
	if (typeof request !== 'object' || request === null) return null;
	let found = tables.get(request);
	if (found === undefined) {
		found = new Map();
		tables.set(request, found);
	}
	return found;
};

/**
 * The children's expressions run in order inside one catch, and what they threw handed to the
 * request's `transformError`: `renderer.boundary` with the bytes left out. Svelte's own default
 * rethrows, which is what a server passing none gets here too.
 *
 * Once per request where it has a key: the test, the JSON and the `failed` snippet's value each
 * read the outcome, and every read ran the children again and called `transformError` again. A
 * null key is a boundary computed once per item, which one key per request cannot tell apart.
 */
export function caught(
	request: unknown,
	key: string | null,
	run: () => unknown,
	options: { transformError?: Transform } | undefined,
): Outcome | Promise<Outcome> {
	const held = key === null ? null : table(request);
	const at = `caught:${String(key)}`;
	if (held?.has(at) === true) return held.get(at) as Outcome | Promise<Outcome>;
	const transform: Transform =
		options?.transformError ??
		((error) => {
			throw error;
		});
	const failed = (thrown: unknown): Outcome | Promise<Outcome> => {
		// What the children threw, not the derivation evaluator's account of it: a value the run
		// reads as a held reference is a derivation, and one that throws is wrapped by `derive` in
		// a `DerivationFailed` naming its source, for the author of a build to read. Svelte hands
		// `transformError` the author's own error, so the wrapper comes off, by its name rather
		// than by class: this file is carried into the bundle and evaluated apart from `derive`,
		// so it imports nothing of it and shares no `Error` with it to test `instanceof` against.
		let error = thrown;
		while (isWrapped(error)) error = error.cause;
		const value = transform(error);
		return thenable(value) ? Promise.resolve(value).then(serialised) : serialised(value);
	};
	let outcome: Outcome | Promise<Outcome>;
	try {
		const ran = run();
		outcome = thenable(ran)
			? Promise.resolve(ran).then((): Outcome => ({ threw: false }), failed)
			: { threw: false };
	} catch (error) {
		outcome = failed(error);
	}
	held?.set(at, outcome);
	return outcome;
}

/**
 * One of the children's values as the run computes it: the value the run already computed under
 * this key for this request, or computed now and kept, a promise as the promise. A throw is not
 * kept: it is the run's answer, and the branch that would read the value is not taken.
 */
export function kept(request: unknown, key: string, run: () => unknown): unknown {
	const held = table(request);
	const at = `kept:${key}`;
	if (held?.has(at) === true) return held.get(at);
	const value = run();
	held?.set(at, value);
	return value;
}

/**
 * `Renderer.#serialize_failed_boundary`, which is private to Svelte's renderer and so written again:
 * `JSON.stringify` with `>` and `<` escaped, so nothing in it closes the comment it goes into. Held
 * to Svelte's bytes by the suite's escaping samples.
 */
function serialised(value: unknown): Outcome {
	const json = JSON.stringify(value) as string;
	return { threw: true, value, json: json.replace(/>/g, '\\u003e').replace(/</g, '\\u003c') };
}

/**
 * One of the children's values, where the branch that writes it is the one taken when nothing threw:
 * a throw here means that branch is not written, so there is nothing to answer with. Where the run
 * computed it under this key, it is that value, not a second call.
 */
export function tried(request: unknown, key: string | null, run: () => unknown): unknown {
	const held = key === null ? null : table(request);
	const at = `kept:${String(key)}`;
	try {
		const value = held?.has(at) === true ? held.get(at) : run();
		return thenable(value) ? Promise.resolve(value).catch(() => undefined) : value;
	} catch {
		return undefined;
	}
}

/**
 * Whether a component the request handed in renders, where the source names none it could be:
 * nothing for a value that is nothing, and a throw for anything else, which the artifact holds no
 * bytes for. Svelte renders whatever it is handed; the project may ask for this refused at the build
 * instead. See spec/payload.md.
 */
export function unnamed(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	throw new Error(
		'a component the source does not name reached `<svelte:component>` at request time, and this ' +
			'artifact renders only the components the source names. Name it in the source, or set ' +
			'`refuseUnnamedComponents` to have it refused at the build.',
	);
}
