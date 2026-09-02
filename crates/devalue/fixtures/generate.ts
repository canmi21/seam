// Records what the JavaScript devalue actually writes, so the port is held against it rather
// than against a reading of its source. Reproducing a format by eye is how the escaping bug in
// the injector happened; this is the same answer applied a second time.
//
// Every case here is written twice, once in TypeScript and once in Rust, and the labels are what
// tie them together. A label present on one side and not the other fails the test, so neither
// table can quietly drift away from the other.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as devalue from 'devalue';

const shared = { x: 1 };

const cases: [string, unknown][] = [
	['null', null],
	['true', true],
	['false', false],
	['zero', 0],
	['integer', 42],
	['negative', -7],
	['fraction', 0.1],
	['float sum', 0.1 + 0.2],
	['large integer', 9007199254740991],
	['exponent up', 1e21],
	['exponent down', 1e-7],
	['string', 'hi'],
	['empty string', ''],
	['undefined', undefined],
	['nan', Number.NaN],
	['infinity', Number.POSITIVE_INFINITY],
	['negative infinity', Number.NEGATIVE_INFINITY],
	['negative zero', -0],
	['bigint', 12345678901234567890n],
	['empty array', []],
	['empty object', {}],
	['flat object', { a: 1, b: 'two', c: true }],
	['nested array', [1, [2, 3], null, true]],
	['nested object', { a: { b: { c: 1 } } }],
	['repeated string', { a: 'hello', b: 'hello' }],
	['repeated number', { a: 42, b: 42 }],
	['repeated reference', { a: shared, b: shared }],
	['distinct objects', { a: { x: 1 }, b: { x: 1 } }],
	['sentinels in object', { z: -0, n: Number.NaN, i: Infinity, m: -Infinity, u: undefined }],
	['date', new Date('1970-01-01T00:00:00.000Z')],
	['date in object', { when: new Date('2026-09-02T12:34:56.789Z') }],
	['set', new Set(['a', 'b'])],
	['empty set', new Set()],
	['map', new Map([['k', 1]])],
	['map with object values', new Map<string, unknown>([['a', { x: 1 }]])],
	['regexp', /ab+c/],
	['regexp with flags', /ab+c/gi],
	['url', new URL('https://a.b/c?d=1')],
	['search params', new URLSearchParams('a=1&b=2')],
	['quote', { s: 'a"b' }],
	['backslash', { s: 'a\\b' }],
	['angle bracket', { s: '</script>' }],
	['newline', { s: 'a\nb\r\tc' }],
	['control character', { s: 'a\u0001b' }],
	['line separators', { s: 'a\u2028b\u2029c' }],
	['non ascii', { s: '\u4e2d\u6587 \ud83d\ude00' }],
	['key needing escape', { 'a"b<c': 1 }],
];

const wire: Record<string, string> = {};
for (const [label, value] of cases) {
	if (label in wire) throw new Error(`duplicate label: ${label}`);
	wire[label] = devalue.stringify(value);
}

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, 'wire.json'), `${JSON.stringify(wire, null, '\t')}\n`);
console.log(`${cases.length} cases recorded`);
