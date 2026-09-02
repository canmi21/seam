// What the stage is for, and the one thing it promises. A raw value written as it arrived does
// not stay where it was put, and the anchor that ends the block goes with it, which is a
// hydration failure rather than a cosmetic one. Every case here was measured against a real
// parser before it was written down.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, normalized, type RawPath, rawPaths } from '../src/normalize.ts';

const cases = resolve(dirname(fileURLToPath(import.meta.url)), '../../../conformance/cases');
let failed = 0;

const check = (label: string, actual: unknown, expected: unknown): void => {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		console.log(`match  ${label}`);
	} else {
		failed += 1;
		console.error(
			`DIFF   ${label}\n   want: ${JSON.stringify(expected)}\n   got:  ${JSON.stringify(actual)}`,
		);
	}
};

// Containment, which is the whole of what this buys.
check('an unclosed tag is closed', normalize('<b>unclosed'), '<b>unclosed</b>');
check('a stray closing tag is dropped', normalize('</div><em>out'), '<em>out</em>');
check('mis-nesting is repaired', normalize('<b><i>x</b></i>'), '<b><i>x</i></b>');
check('well-formed markup is left alone', normalize('<p>a <em>b</em></p>'), '<p>a <em>b</em></p>');

// The two removals, which are the only ones that can be proved rather than argued.
check('comments go', normalize('<p>a<!-- note -->b</p>'), '<p>ab</p>');
check('the newline after pre goes, once', normalize('<pre>\n\nx</pre>'), '<pre>\nx</pre>');

// And the one that must not: whitespace between elements is a rendered space or nothing at all
// depending on CSS this cannot see, measured in a browser on two spans that differ only in
// `display`. So it stays.
check(
	'whitespace between elements stays',
	normalize('<em>x</em> <em>y</em>'),
	'<em>x</em> <em>y</em>',
);
check('whitespace inside pre stays', normalize('<pre>a\n  b</pre>'), '<pre>a\n  b</pre>');

// The paths are the IR's rather than a second list, and a derived one is not among them: it is
// never serialised, so the client recomputes it and would disagree with anything done here.
for (const file of readdirSync(cases).filter((f) => f.endsWith('.ir.json'))) {
	const { ir } = JSON.parse(readFileSync(resolve(cases, file), 'utf8')) as {
		ir: Parameters<typeof rawPaths>[0];
	};
	for (const one of rawPaths(ir)) {
		if (one.path.startsWith('__d') || one.frames.some((f) => f.source.startsWith('__d'))) {
			failed += 1;
			console.error(`MISS   ${file} offered the derived path ${one.path}`);
		}
	}
}
console.log('match  no derived path is offered for normalising');

const root = (path: string): RawPath => ({ frames: [], path });

// A stage that modified its input would be the thing derivations are told not to be.
const before = { data: { h: '<b>x' } };
const after = normalized(before, [root('data.h')]);
check('the input is not modified', before.data.h, '<b>x');
check('the copy is', (after['data'] as { h: string }).h, '<b>x</b>');

// A raw value inside an each. The path names the block's binding rather than the payload, so
// reading it from the payload root finds nothing -- which used to be indistinguishable from a
// value the payload does not carry, and every one of these went through untouched.
{
	const rows = normalized({ data: { rows: [{ h: '</div><em>out' }, { h: '<b>two' }] } }, [
		{ frames: [{ source: 'data.rows', item: 'r' }], path: 'r.h' },
	]);
	check(
		'a raw value inside an each is normalised, every item',
		(rows['data'] as { rows: { h: string }[] }).rows.map((one) => one.h),
		['<em>out</em>', '<b>two</b>'],
	);
}

// The item is itself the string, so there is no object to write into and the array slot is the
// only place the value lives.
{
	const bare = normalized({ data: { items: ['<b>one', '<i>two'] } }, [
		{ frames: [{ source: 'data.items', item: 'html' }], path: 'html' },
	]);
	check('an each over strings rewrites the array', (bare['data'] as { items: string[] }).items, [
		'<b>one</b>',
		'<i>two</i>',
	]);
}

// Nested, where the inner block's source is itself read in the outer block's scope.
{
	const nested = normalized({ data: { rows: [{ cells: [{ h: '<b>deep' }] }] } }, [
		{
			frames: [
				{ source: 'data.rows', item: 'r' },
				{ source: 'r.cells', item: 'c' },
			],
			path: 'c.h',
		},
	]);
	check(
		'a nested each reaches the innermost value',
		(nested['data'] as { rows: { cells: { h: string }[] }[] }).rows[0]?.cells[0]?.h,
		'<b>deep</b>',
	);
}

// A value the payload does not carry is ordinary and silent. A name no scope binds is not: it
// means the IR and this walk disagree about scope, which is a fault rather than a condition.
check('a missing value is skipped', normalized({ data: {} }, [root('data.h')]), { data: {} });
check(
	'a name no scope binds is refused',
	(() => {
		try {
			normalized({ data: {} }, [root('r.h')]);
			return 'nothing thrown';
		} catch (error) {
			return (error as Error).message;
		}
	})(),
	'the raw path `r.h` reads `r`, which no scope binds',
);

// Own properties at every step. The path is the compiler's and addresses the author's own data,
// so an inherited step is not data being addressed. CodeQL reported the assignment below as a
// prototype-polluting one; it was not reachable, and now it is refused rather than argued about.
{
	const polluted = { data: { x: 'plain' } };
	normalized(polluted, [root('data.__proto__.injected'), root('data.x.__proto__.injected')]);
	check(
		'a step through the prototype writes nothing',
		({} as Record<string, unknown>)['injected'],
		undefined,
	);
}

if (failed > 0) process.exit(1);
