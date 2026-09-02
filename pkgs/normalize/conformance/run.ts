// What the stage is for, and the one thing it promises. A raw value written as it arrived does
// not stay where it was put, and the anchor that ends the block goes with it, which is a
// hydration failure rather than a cosmetic one. Every case here was measured against a real
// parser before it was written down.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, normalized, rawPaths } from '../src/normalize.ts';

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
	for (const path of rawPaths(ir)) {
		if (path.startsWith('__d')) {
			failed += 1;
			console.error(`MISS   ${file} offered the derived path ${path}`);
		}
	}
}
console.log('match  no derived path is offered for normalising');

// A stage that modified its input would be the thing derivations are told not to be.
const before = { data: { h: '<b>x' } };
const after = normalized(before, ['data.h']);
check('the input is not modified', before.data.h, '<b>x');
check('the copy is', (after['data'] as { h: string }).h, '<b>x</b>');

if (failed > 0) process.exit(1);
