/**
 * Runs steps that may wait, synchronously until one does.
 *
 * A step that yields a thenable is resumed with what it settles to. Until one does, this is a loop
 * and returns the value itself, so an artifact with nothing to await injects exactly as it did;
 * the first thenable turns the rest into a promise. One implementation for both, since the
 * alternative is a second injector that has to agree with the first.
 *
 * What yields one is an `await` in a derivation, which an artifact holds only where the project is
 * in Svelte's async mode and the value is one the build can know. See spec/derivation.md.
 */
export function drive<T>(steps: Generator<unknown, T, unknown>): T | Promise<T> {
	let step = steps.next();
	while (step.done !== true) {
		const held = step.value;
		if (thenable(held)) return settled(steps, held);
		step = steps.next(held);
	}
	return step.value;
}

async function settled<T>(
	steps: Generator<unknown, T, unknown>,
	first: PromiseLike<unknown>,
): Promise<T> {
	let step = steps.next(await first);
	while (step.done !== true) {
		const held = step.value;
		step = steps.next(thenable(held) ? await held : held);
	}
	return step.value;
}

/**
 * The mark on a promise a derivation made by awaiting, which is the one kind the injector waits on.
 *
 * A value that is a promise is otherwise just a value: `{#await p}` over a promise the request
 * hands in is a block deciding on it, and waiting on it would take the decision away. Only what
 * `derive` built `async` is waited on, and it says so. See spec/derivation.md.
 */
export const WAITS = Symbol.for('seam.waits');

/** A derivation's promise, marked as one the injector waits on. */
export function waiting<T>(promise: Promise<T>): Promise<T> {
	return Object.assign(promise, { [WAITS]: true });
}

/** Whether a value is a derivation's own promise, which is what the injector waits on. */
export function waited(value: unknown): value is Promise<unknown> {
	return thenable(value) && WAITS in (value as object);
}

/** Whether a value is one `await` would wait on. */
export function thenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === 'object' || typeof value === 'function') &&
		value !== null &&
		typeof (value as { then?: unknown }).then === 'function'
	);
}
