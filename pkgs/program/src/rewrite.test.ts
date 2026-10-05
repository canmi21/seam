import { describe, expect, it } from 'vitest';
import { parsedExpression } from './rewrite.ts';

describe('what may follow the one expression a derivation is', () => {
	it('takes whitespace and comments, and nothing else', () => {
		expect(parsedExpression('a /* b */ // c\n').type).toBe('Identifier');
		expect(parsedExpression('a /**/').type).toBe('Identifier');
		expect(() => parsedExpression('a /* b */ c')).toThrow(SyntaxError);
		expect(() => parsedExpression('a /* b */ */')).toThrow(SyntaxError);
	});

	// Was a lazy block comment that could reach past its own `*/` into the next: every two more
	// comments took four times as long, and this took seconds.
	it('answers in linear time where comments run together', () => {
		const started = performance.now();
		expect(() => parsedExpression(`a ${'/**/'.repeat(29)}x`)).toThrow(SyntaxError);
		expect(performance.now() - started).toBeLessThan(500);
	});
});
