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
