// What the stage is for, and the one thing it promises. A raw value written as it arrived does not
// stay where it was put, and the anchor that ends the block goes with it, which is a hydration
// failure rather than a cosmetic one. Every case here was measured against a real parser before it
// was written down. See spec/refusals.md.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalize, normalized, type RawPath, rawPaths } from './normalize.ts';

const cases = resolve(dirname(fileURLToPath(import.meta.url)), '../../../conformance/cases');
const root = (path: string): RawPath => ({ frames: [], path });

describe('a fragment is made to stay where it was put', () => {
	it.each([
		['an unclosed tag is closed', '<b>unclosed', '<b>unclosed</b>'],
		['a stray closing tag is dropped', '</div><em>out', '<em>out</em>'],
		['mis-nesting is repaired', '<b><i>x</b></i>', '<b><i>x</i></b>'],
		['well-formed markup is left alone', '<p>a <em>b</em></p>', '<p>a <em>b</em></p>'],
	])('%s', (_label, given, expected) => {
		expect(normalize(given)).toBe(expected);
	});
});

describe('it removes two things and no more', () => {
	// The only two removals that can be proved rather than argued: a comment is not an element, so
	// no selector reaches it, and the parser drops the newline after `<pre>` because the
	// specification says to.
	it('drops comments', () => {
		expect(normalize('<p>a<!-- note -->b</p>')).toBe('<p>ab</p>');
	});

	it('drops the newline after pre, once', () => {
		expect(normalize('<pre>\n\nx</pre>')).toBe('<pre>\nx</pre>');
	});

	// Whitespace between elements is a rendered space or nothing at all depending on CSS this
	// cannot see, measured in a browser on two spans that differ only in `display`. So it stays.
	it('keeps whitespace between elements', () => {
		expect(normalize('<em>x</em> <em>y</em>')).toBe('<em>x</em> <em>y</em>');
	});

	it('keeps whitespace inside pre', () => {
		expect(normalize('<pre>a\n  b</pre>')).toBe('<pre>a\n  b</pre>');
	});
});

// The paths are the IR's rather than a second list, and a derived one is not among them: it is
// never serialised, so the client recomputes it and would disagree with anything done here.
describe('no derived path is offered for normalising', () => {
	const files = readdirSync(cases).filter((f) => f.endsWith('.ir.json'));

	it.each(files)('%s', (file) => {
		const { ir } = JSON.parse(readFileSync(resolve(cases, file), 'utf8')) as {
			ir: Parameters<typeof rawPaths>[0];
		};
		for (const one of rawPaths(ir)) {
			expect(one.path.startsWith('__d')).toBe(false);
			expect(one.frames.some((f) => f.source.startsWith('__d'))).toBe(false);
		}
	});
});

describe('the payload is copied rather than rewritten', () => {
	// A stage that modified its input would be the thing derivations are told not to be.
	it('leaves the input alone and changes the copy', () => {
		const before = { data: { h: '<b>x' } };
		const after = normalized(before, [root('data.h')]);
		expect(before.data.h).toBe('<b>x');
		expect((after['data'] as { h: string }).h).toBe('<b>x</b>');
	});
});

describe('a raw value inside an each is reached per item', () => {
	// The path names the block's binding rather than the payload, so reading it from the payload
	// root finds nothing -- which used to be indistinguishable from a value the payload does not
	// carry, and every one of these went through untouched.
	it('normalises every item', () => {
		const out = normalized({ data: { rows: [{ h: '</div><em>out' }, { h: '<b>two' }] } }, [
			{ frames: [{ source: 'data.rows', item: 'r' }], path: 'r.h' },
		]);
		expect((out['data'] as { rows: { h: string }[] }).rows.map((one) => one.h)).toEqual([
			'<em>out</em>',
			'<b>two</b>',
		]);
	});

	// The item is itself the string, so there is no object to write into and the array slot is the
	// only place the value lives.
	it('rewrites the array when the item is the string', () => {
		const out = normalized({ data: { items: ['<b>one', '<i>two'] } }, [
			{ frames: [{ source: 'data.items', item: 'html' }], path: 'html' },
		]);
		expect((out['data'] as { items: string[] }).items).toEqual(['<b>one</b>', '<i>two</i>']);
	});

	// Nested, where the inner block's source is itself read in the outer block's scope.
	it('reaches the innermost value of a nested each', () => {
		const out = normalized({ data: { rows: [{ cells: [{ h: '<b>deep' }] }] } }, [
			{
				frames: [
					{ source: 'data.rows', item: 'r' },
					{ source: 'r.cells', item: 'c' },
				],
				path: 'c.h',
			},
		]);
		const rows = (out['data'] as { rows: { cells: { h: string }[] }[] }).rows;
		expect(rows[0]?.cells[0]?.h).toBe('<b>deep</b>');
	});
});

describe('a missing value and a missing scope are different failures', () => {
	// A value the payload does not carry is an ordinary condition and stays silent.
	it('skips a value the payload does not carry', () => {
		expect(normalized({ data: {} }, [root('data.h')])).toEqual({ data: {} });
	});

	// A name no scope binds means the IR and this walk disagree about scope, which is a fault.
	// Sharing an exit with the case above is what hid every raw value inside an each.
	it('refuses a name no scope binds', () => {
		expect(() => normalized({ data: {} }, [root('r.h')])).toThrow(
			'the raw path `r.h` reads `r`, which no scope binds',
		);
	});
});

// Own properties at every step. The path is the compiler's and addresses the author's own data, so
// an inherited step is not data being addressed. CodeQL reported the assignment as a
// prototype-polluting one; it was not reachable, and now it is refused rather than argued about.
it('writes nothing through a step on the prototype', () => {
	normalized({ data: { x: 'plain' } }, [
		root('data.__proto__.injected'),
		root('data.x.__proto__.injected'),
	]);
	expect(({} as Record<string, unknown>)['injected']).toBeUndefined();
});
