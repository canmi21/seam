import { isNode } from './scope.ts';

/** Members of an allowed global that are not themselves deterministic. */
const AMBIENT_MEMBERS: Record<string, ReadonlySet<string>> = {
	Math: new Set(['random']),
	Date: new Set(['now']),
};

/**
 * Globals whose call does not return the same value twice, so substituting one duplicates it.
 *
 * `Symbol()` is the one that found this: `const s = Symbol()` beside `s in obj` substituted the
 * call at both reads, made two different symbols, and wrote `false` where Svelte wrote `true`. It
 * is `Math.random` again in a shape a member test cannot see -- a bare call rather than a member.
 * `Symbol.for` is interned and is not one of these, which is why the test is on the callee being
 * the bare name.
 */
const AMBIENT_CALLS: ReadonlySet<string> = new Set(['Symbol']);

/** Globals whose call reads a clock when it is given nothing, and a value when it is given one. */
const AMBIENT_EMPTY: ReadonlySet<string> = new Set(['Date']);

/**
 * What in one expression does not read the same twice: a clock, randomness, a fresh symbol. Read per
 * request and never at the build; see spec/derivation.md, "Ambient input is read at request time,
 * never at the build".
 *
 * A global on the list can still hold something that is not: `Math` is fine and `Math.random` is a
 * clock by another name. A bare call is the other shape, `Symbol()`.
 */
export function ambientIn(expression: unknown): string[] {
	const found: string[] = [];
	walkMembers(expression, (object, property) => {
		if (AMBIENT_MEMBERS[object]?.has(property) === true) found.push(`${object}.${property}`);
	});
	walkCalls(expression, (name, empty) => {
		if (AMBIENT_CALLS.has(name) || (empty && AMBIENT_EMPTY.has(name))) found.push(`${name}()`);
	});
	return found;
}

/** Every call whose callee is a bare name, by that name and whether it was given nothing. */
function walkCalls(node: unknown, found: (name: string, empty: boolean) => void): void {
	if (!isNode(node)) return;
	if (node['type'] === 'CallExpression' || node['type'] === 'NewExpression') {
		const callee = node['callee'];
		const args = node['arguments'];
		if (isNode(callee) && callee['type'] === 'Identifier' && typeof callee['name'] === 'string') {
			found(callee['name'], Array.isArray(args) && args.length === 0);
		}
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const one of value) walkCalls(one, found);
		} else {
			walkCalls(value, found);
		}
	}
}

function walkMembers(node: unknown, found: (object: string, property: string) => void): void {
	if (!isNode(node)) return;
	if (node['type'] === 'MemberExpression' && node['computed'] !== true) {
		const object = node['object'];
		const property = node['property'];
		if (
			isNode(object) &&
			object['type'] === 'Identifier' &&
			typeof object['name'] === 'string' &&
			isNode(property) &&
			typeof property['name'] === 'string'
		) {
			found(object['name'], property['name']);
		}
	}
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) {
			for (const child of value) walkMembers(child, found);
		} else if (isNode(value)) {
			walkMembers(value, found);
		}
	}
}
