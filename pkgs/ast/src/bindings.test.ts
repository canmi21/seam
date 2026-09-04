import { describe, expect, it } from 'vitest';
import { bindings } from './bindings.ts';
import { apply, type Edit } from './edits.ts';
import { mentions } from './locals.ts';
import { reduce } from './reduce.ts';

// A name a script declares is substituted into the expression that uses it, which is what makes a
// module constant and one reading props the same mechanism. `LIMIT` becomes what it was declared
// to be; `total` becomes an expression over the data, which is a derivation. See
// spec/derivation.md.
describe('a declared name is substituted into the expression that reads it', () => {
	const substitutions: [label: string, source: string, expands: string][] = [
		[
			'a module constant',
			'<script module>export const LIMIT = 10</script><script>let { data } = $props()</script><b>{data.p > LIMIT}</b>',
			'data.p > (10)',
		],
		[
			'a constant reading props',
			'<script>let { data } = $props(); const total = data.x * 2</script><b>{total}</b>',
			'(data.x * 2)',
		],
		[
			'a chain of them',
			'<script>let { data } = $props(); const a = data.x * 2; const b = a + 1</script><b>{b}</b>',
			'((data.x * 2) + 1)',
		],
		[
			'a function declaration',
			'<script>let { data } = $props(); function f(v) { return v }</script><b>{f(data.x)}</b>',
			'(function f(v) { return v })(data.x)',
		],
		[
			'an object destructuring, renamed',
			'<script>let { data } = $props(); const { a: b } = data.t</script><b>{b}</b>',
			'((data.t).a)',
		],
		[
			'an array destructuring',
			'<script>let { data } = $props(); const [x] = data.t</script><b>{x}</b>',
			'((data.t)[0])',
		],
	];

	it.each(substitutions)('%s', (_label, source, expands) => {
		expect(JSON.stringify(reduce(source).markup)).toContain(JSON.stringify(expands).slice(1, -1));
	});
});

// An imported name is legal and is reported for bundling rather than refused, and the three import
// forms are not interchangeable when it comes to asking for the name again: a default export is
// not a named one, and a namespace is neither.
describe('an import is carried in the form it was written', () => {
	const imports: [label: string, statement: string, carried: string][] = [
		['a named import', "import { cn } from './u.ts'", 'named:cn'],
		['a renamed import', "import { cn as c } from './u.ts'", 'named:c'],
		['a default import', "import cn from './u.ts'", 'default:cn'],
		['a namespace import', "import * as u from './u.ts'", 'namespace:u'],
	];

	it.each(imports)('%s', (_label, statement, expected) => {
		const name = expected.split(':')[1] ?? '';
		const source = `<script>${statement}; let { data } = $props()</script><b>{${name}.x ?? ${name}(data.v)}</b>`;
		const carried = bindings(source)
			.carried.map((one) => `${one.kind}:${one.local}`)
			.join(',');
		expect(carried).toBe(expected);
	});
});

describe('rewriting a source file', () => {
	// Two replacements over the same characters mean one place was recorded twice. Applying both
	// writes the second into the middle of the first and hands Svelte a file nobody wrote; it
	// happened, and it surfaced as an undefined variable naming nothing anybody could act on.
	it('refuses two edits over one place rather than applying them', () => {
		const overlapping: Edit[] = [
			[17, 23, '{}'],
			[17, 23, '{}'],
		];
		expect(() => apply('const { a, b } = data.t;', overlapping)).toThrow('recorded twice');
	});

	// Adjacent is not overlapping, and refusing it would refuse ordinary work.
	it('applies adjacent edits', () => {
		expect(
			apply('abcd', [
				[0, 1, 'X'],
				[1, 2, 'Y'],
			]),
		).toBe('XYcd');
	});
});

describe('what an expression reaches for', () => {
	it('reads an expression that carries a TypeScript annotation', () => {
		// Svelte chooses its parser from the script tag rather than from the expression, so an
		// annotation in the markup of a `lang="ts"` component is a syntax error without one. A parse
		// failure here is read as "assume it reaches the payload", which is safe and, for a value
		// that is the same every request, wrong: a marker went into `<PersistQueryClientProvider
		// persistOptions={...}>` and the package was handed a string.
		expect(mentions('({ f: (q: { s: string }) => q.s })', new Set(['data']))).toBe(false);
		expect(mentions('({ f: (q: { s: string }) => data.x })', new Set(['data']))).toBe(true);
	});
});
