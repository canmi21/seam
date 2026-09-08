export type Scope = Record<string, unknown>;

// Innermost scope first, so an `each` binding shadows an outer name the way a reader expects.
export function resolve(scopes: readonly Scope[], path: string): unknown {
	const [head, ...rest] = path.split('.');
	if (head === undefined) return undefined;

	let value: unknown;
	let found = false;
	for (let i = scopes.length - 1; i >= 0; i -= 1) {
		const scope = scopes[i];
		if (scope !== undefined && head in scope) {
			value = scope[head];
			found = true;
			break;
		}
	}
	if (!found) return undefined;

	// A property read, which is what the author wrote. It used to stop at anything that was not an
	// object, so `{data.title.length}` -- a path whose last step reads a string's own property --
	// resolved to nothing while Svelte wrote the number. A path is a member chain rooted at a name
	// the payload carries, and nothing in it says which steps land on data and which on a string,
	// an array or a number; JavaScript's own answer is the one the expression had.
	for (const key of rest) {
		if (value === null || value === undefined) return undefined;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}

/**
 * A derivation that reads a name a block binds, and so is computed where it is used.
 *
 * Every other derivation is a pure function of the payload and is computed once, before anything
 * is injected. One that reads what an each block binds is the same pure function with one more
 * input, and that input only exists inside the loop -- so it is carried into the scope as a
 * function and called at the point of use instead. The tag is what says so: a value that resolves
 * to a function is otherwise just a value, and this pass does not guess.
 */
export const SCOPED = Symbol.for('seam.scoped');

/** What a resolved value is once a scoped derivation has been given the scopes it reads. */
export function settle(value: unknown, scopes: readonly Scope[]): unknown {
	if (typeof value !== 'function' || !(SCOPED in value)) return value;
	return (value as unknown as (scopes: readonly Scope[]) => unknown)(scopes);
}
