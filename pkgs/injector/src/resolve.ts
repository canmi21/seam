export type Scope = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

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

	for (const key of rest) {
		if (!isRecord(value)) return undefined;
		value = value[key];
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
