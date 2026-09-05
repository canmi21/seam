import { describe, expect, it } from 'vitest';
import { partial } from './compose.ts';

describe('the values a render is fixed at, in the shape they sit in', () => {
	it('nests a dotted path under its root', () => {
		const fixed = new Map([['data.locale.code', '"en"']]);
		expect(partial(fixed, 'data')).toEqual({ locale: { code: 'en' } });
		expect(partial(fixed, 'other')).toBeUndefined();
	});

	it('returns the value itself for a path that is only the root', () => {
		expect(partial(new Map([['data', '{"a":1}']]), 'data')).toEqual({ a: 1 });
	});

	// A segment spelled `__proto__` on an ordinary object is the prototype, not a key, and the
	// walk that built this stepped into `Object.prototype` and wrote there -- a property on every
	// object in the process, and nothing in `found`. Reported by static analysis; the paths come
	// from the build's own configuration, so it was a wrong result waiting rather than a hole. It
	// is refused by name now, which is also the shape the analyser can read.
	it('refuses a segment that names the prototype rather than a field', () => {
		for (const name of ['__proto__', 'constructor', 'prototype']) {
			const fixed = new Map([[`data.${name}.polluted`, '"yes"']]);
			expect(() => partial(fixed, 'data')).toThrow(name);
		}
		expect('polluted' in ({} as Record<string, unknown>)).toBe(false);
	});
});
