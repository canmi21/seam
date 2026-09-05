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
	// from the build's own configuration, so it was a wrong result waiting rather than a hole, and
	// it is a wrong result no longer.
	it('treats a segment spelled __proto__ as a key and touches no prototype', () => {
		const before = 'polluted' in ({} as Record<string, unknown>);
		const fixed = new Map([['data.__proto__.polluted', '"yes"']]);
		const built = partial(fixed, 'data') as Record<string, unknown>;
		expect(before).toBe(false);
		expect('polluted' in ({} as Record<string, unknown>)).toBe(false);
		expect(Object.getOwnPropertyNames(built)).toEqual(['__proto__']);
		expect((built['__proto__'] as Record<string, unknown>)['polluted']).toBe('yes');
	});
});
