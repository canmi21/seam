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
 * The children's expressions run in order inside one catch, and what they threw handed to the
 * request's `transformError`: `renderer.boundary` with the bytes left out. Svelte's own default
 * rethrows, which is what a server passing none gets here too.
 */
export function caught(
	run: () => unknown,
	options: { transformError?: Transform } | undefined,
): Outcome | Promise<Outcome> {
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
	try {
		const ran = run();
		if (thenable(ran)) return Promise.resolve(ran).then(() => ({ threw: false }), failed);
		return { threw: false };
	} catch (error) {
		return failed(error);
	}
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
 * a throw here means that branch is not written, so there is nothing to answer with.
 */
export function tried(run: () => unknown): unknown {
	try {
		const value = run();
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
