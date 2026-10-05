/**
 * Runs steps that may wait, synchronously until one does.
 *
 * A step that yields a thenable is resumed with what it settles to. Until one does, this is a loop
 * and returns the value itself, so an artifact with nothing to await injects exactly as it did;
 * the first thenable turns the rest into a promise. One implementation for both, since the
 * alternative is a second program that has to agree with the first.
 *
 * What yields one is an `await` in a derivation, which an artifact holds only where the project is
 * in Svelte's async mode and the value is one the build can know. See spec/derivation.md.
 */
export function drive<T>(steps: Generator<unknown, T, unknown>): T | Promise<T> {
	let step = steps.next();
	while (step.done !== true) {
		const held = step.value;
		if (thenable(held)) return settled(steps, rejecting(held));
		step = steps.next(held);
	}
	return step.value;
}

async function settled<T>(
	steps: Generator<unknown, T, unknown>,
	first: PromiseLike<unknown>,
): Promise<T> {
	let pending: PromiseLike<unknown> = first;
	for (;;) {
		// A rejection goes back into the steps as a throw where they waited, so that a boundary's
		// `try` around what its children wait on catches it, as `renderer.boundary` does.
		let step: IteratorResult<unknown, T>;
		try {
			step = steps.next(await pending);
		} catch (error) {
			if (!(error instanceof Rejected)) throw error;
			step = steps.throw(error.reason);
		}
		while (step.done !== true && !thenable(step.value)) step = steps.next(step.value);
		if (step.done === true) return step.value;
		pending = rejecting(step.value as PromiseLike<unknown>);
	}
}

/** A rejection told apart from a throw out of the steps themselves. */
class Rejected {
	readonly reason: unknown;
	constructor(reason: unknown) {
		this.reason = reason;
	}
}

function rejecting(value: PromiseLike<unknown>): PromiseLike<unknown> {
	return Promise.resolve(value).catch((reason: unknown) => {
		throw new Rejected(reason);
	});
}

/**
 * The mark on a promise a derivation made by awaiting, which is the one kind the program waits on.
 *
 * A value that is a promise is otherwise just a value: `{#await p}` over a promise the request
 * hands in is a block deciding on it, and waiting on it would take the decision away. Only what
 * the program built `async` is waited on, and it says so. See spec/derivation.md.
 */
export const WAITS = Symbol.for('seam.waits');

/** A derivation's promise, marked as one the program waits on. */
export function waiting<T>(promise: Promise<T>): Promise<T> {
	return Object.assign(promise, { [WAITS]: true });
}

/** Whether a value is a derivation's own promise, which is what the program waits on. */
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
