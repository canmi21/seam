/**
 * A choice the source holds the domain of, written out as the choice it is.
 *
 * The claim under every case is the same one: **the rewrite is the expression**. So each is
 * evaluated both ways over every key -- one the table holds, one it does not, and one that never
 * reaches the table at all -- and the two have to agree, a thrown `TypeError` included, because a
 * lookup that throws where the key is missing has to keep throwing there.
 */
import { describe, expect, it } from 'vitest';
import { unfolded } from './locals.ts';

const TABLE = "{ a: { icon: Ay, name: 'Ay' }, b: { icon: Bee, name: 'Bee' } }";
const KEYS = ['a', 'b', 'zz', '', undefined];

/** Both ways over one payload, as a value or as the error it threw. */
function ran(expression: string, k: unknown): string {
	try {
		const value = new Function('d', 'Ay', 'Bee', `return (${expression})`)({ k }, 'AY', 'BEE');
		return JSON.stringify(value) ?? 'undefined';
	} catch (error) {
		return `threw ${(error as Error).constructor.name}`;
	}
}

function agrees(expression: string): void {
	const rewritten = unfolded(expression);
	expect(rewritten, 'nothing was unfolded').not.toBeNull();
	for (const k of KEYS) {
		expect(ran(rewritten as string, k), `k ${JSON.stringify(k)}`).toBe(ran(expression, k));
	}
}

describe('a lookup in a table of components', () => {
	it('is the chain of `?:` its keys make', () => {
		expect(unfolded(`${TABLE}[d.k]`)).toContain('(d.k) === "a" ?');
		agrees(`${TABLE}[d.k]`);
	});

	// What is read off the entry is part of the lookup: an entry holding a component beside its
	// name is what a table of icons is, and the read is where the component comes out of it.
	it('carries what is read off the entry into every arm', () => {
		for (const form of [
			`${TABLE}[d.k]?.icon`,
			`(${TABLE}[d.k])?.icon`,
			`(${TABLE}[d.k]).icon`,
			`${TABLE}[d.k]?.icon.length`,
			`${TABLE}[d.k].icon?.length`,
		]) {
			agrees(form);
		}
	});

	// A plain read of a key the table lacks throws, and an optional one does not. Neither is this
	// rewrite's to change, so the arm for a missing key keeps whichever it was.
	it('keeps what a missing key does', () => {
		expect(unfolded(`${TABLE}[d.k].icon`)).toContain(': (undefined).icon)');
		expect(unfolded(`${TABLE}[d.k]?.icon`)).toContain(': undefined)');
	});
});

describe('a read off a `?:`', () => {
	// Until the read is inside the branches the expression is a member access over a ternary
	// rather than a ternary, so nothing looks for the choice written in it. press's article is
	// this shape with the table underneath, which is why the two unfold inside out.
	it('goes inside both branches, and the branch is unfolded again', () => {
		const written = `(d.k ? ${TABLE}[d.k] : undefined)?.icon`;
		expect(unfolded(written)).toContain('(d.k) === "a" ?');
		agrees(written);
	});
});

describe('the TypeScript written around an expression', () => {
	// `as const` on the table and a cast on the key are how press writes both, and neither is part
	// of the expression at runtime. Read as though they were, the table is not a table.
	it('is not part of the expression', () => {
		const written = `(d.k ? (${TABLE} as const)[d.k as keyof typeof T] : undefined)?.icon`;
		const rewritten = unfolded(written);
		expect(rewritten).toContain('(d.k) === "a" ?');
		expect(rewritten).not.toContain('keyof');
		expect(rewritten).not.toContain('as const');
		for (const k of KEYS) {
			expect(ran(rewritten as string, k), `k ${JSON.stringify(k)}`).toBe(
				ran(`(d.k ? ${TABLE}[d.k] : undefined)?.icon`, k),
			);
		}
	});
});

describe('an expression holding no choice to unfold', () => {
	it('is left alone', () => {
		for (const one of ['d.k', 'd.a ? d.b : d.c', 'T[d.k].icon', 'f(d.k)?.icon']) {
			expect(unfolded(one), one).toBeNull();
		}
	});
});

describe('a read that is then called', () => {
	// Both rewrites move a read off the thing it is read from, and a read that is then called is a
	// method: taking `slice` off the array and calling it alone loses what it was called on.
	// press's article found this, its footnotes calling `slice` on a default.
	it('is left attached to what it is called on', () => {
		expect(unfolded('(d.k ? [1, 2, 3] : []).slice(1)')).toBeNull();
		expect(unfolded(`(d.k ? ${TABLE} : {})[d.k](1)`)).toBeNull();
		expect(unfolded('(d.k ? [1, 2, 3] : [])?.slice(1)')).toBeNull();
	});

	// A choice deeper inside the callee is still a choice: rewriting it keeps the call attached to
	// whatever it becomes.
	it('does not hide a choice further in', () => {
		const written = `((d.k ? ${TABLE}[d.k] : undefined)?.name).slice(1)`;
		const rewritten = unfolded(written);
		expect(rewritten).toContain('(d.k) === "a" ?');
		for (const k of KEYS) {
			expect(ran(rewritten as string, k), `k ${JSON.stringify(k)}`).toBe(ran(written, k));
		}
	});
});
