import { uneval } from 'devalue';
import { describe, expect, it } from 'vitest';
import { streaming } from './server.ts';
import { streamedIn, withoutStreamed } from './fold.ts';

/** A page as `render.js` lays its boot script out, around the pieces under test. */
function page(data: string, declared: string, after = ''): string {
	const blocks = ['__sveltekit_x = {};', declared, `${data}kit.start();`].filter(
		(one) => one !== '',
	);
	return `<html><body><script>{\n\t\t\t\t\t${blocks.join('\n\n\t\t\t\t\t')}\n}</script></body></html>${after}`;
}

const written = (data: unknown): string => `__sveltekit_x.data = ${uneval(data)};\n\n\t\t\t\t\t\t`;

describe('a response held to what Kit wrote, less what was streamed', () => {
	it('takes the streamed entries out of both, and the whole statement where nothing is left', async () => {
		const stream = streaming({
			global: '__sveltekit_x',
			open: '<script>',
			uneval: (value) => uneval(value),
			convert: async () => null,
		});
		stream.add('q', 'slow', Promise.resolve('late'));
		stream.add('q', 'fast', Promise.resolve('early'));
		const declared = stream.declare({ q: { fast: { v: 'early' } } });
		let sent = '';
		for await (const one of stream.with(null) ?? []) sent += one;

		const ours = page(written({ q: { fast: { v: 'early' } } }), declared, `\n${sent}`);
		const kit = page(written({ q: { fast: { v: 'early' }, slow: { v: 'late' } } }), '');
		const streamed = streamedIn(ours);
		expect(streamed).toEqual([['q', 'slow']]);
		expect(withoutStreamed(ours, streamed)).toBe(withoutStreamed(kit, streamed));

		const alone = page(written({ q: { slow: { v: 'late' } } }), '');
		expect(withoutStreamed(alone, streamed)).toBe(page('', ''));
	});

	it("takes the newline a streamed response opens with, after a template's own", async () => {
		const stream = streaming({
			global: '__sveltekit_x',
			open: '<script>',
			uneval: (value) => uneval(value),
			convert: async () => null,
		});
		stream.add('q', 'slow', Promise.resolve('late'));
		const declared = stream.declare({});
		let sent = '';
		for await (const one of stream.with(null) ?? []) sent += one;
		const ours = `${page('', declared)}\n\n${sent}`;
		expect(withoutStreamed(ours, streamedIn(ours))).toBe(`${page('', '')}\n`);
	});

	it('leaves a response that streamed nothing as it is', () => {
		const text = page(written({ q: { a: { v: 1 } } }), '');
		expect(streamedIn(text)).toEqual([]);
		expect(withoutStreamed(text, [])).toBe(text);
	});
});
