import { describe, expect, it, vi } from 'vitest';
import { first, later, seeded, type Settle } from './client.ts';

const app = { decode: () => undefined };
const settles = (node: ReturnType<Settle>): Promise<Settle> => Promise.resolve(() => node);

describe("the client's half", () => {
	it('puts what is coming beside what Kit wrote, without replacing it', () => {
		const coming = settles({ v: 1 });
		const responses: Record<string, unknown> = { kept: { v: 0 } };
		seeded({ streamed: { q: { kept: coming, new: coming } } }, responses);
		expect(responses['kept']).toEqual({ v: 0 });
		expect(responses['new']).toEqual({ streamed: coming });
	});

	it('waits for the streamed value on the first run, and fetches on every later one', async () => {
		const fetch = vi.fn(async () => 'fetched');
		const run = first(
			settles({ v: 'streamed' }),
			() => app,
			fetch,
			(e) => e,
		);
		expect(await run()).toBe('streamed');
		expect(fetch).not.toHaveBeenCalled();
		expect(await run()).toBe('fetched');
	});

	it('rejects with the error as the query makes it from a written one', async () => {
		const run = first(
			settles({ e: { message: 'nope' } }),
			() => app,
			async () => 'x',
			(e) => ({ made: e }),
		);
		await expect(run()).rejects.toEqual({ made: { message: 'nope' } });
	});

	it('fetches after all where the server handed it over', async () => {
		const run = first(
			settles(null),
			() => app,
			async () => 'fetched',
			(e) => e,
		);
		expect(await run()).toBe('fetched');
	});

	it('hands a live query its first value, and nothing where the server handed it over', async () => {
		const applied: unknown[] = [];
		later(
			settles({ v: 3 }),
			() => app,
			(node) => applied.push(node),
		);
		later(
			settles(null),
			() => app,
			(node) => applied.push(node),
		);
		await new Promise((done) => setTimeout(done, 0));
		expect(applied).toEqual([{ v: 3 }]);
	});

	it('reads a transported value with the app the client has loaded', async () => {
		const streamed = Promise.resolve<Settle>((given) => ({ v: (given as { tag: string }).tag }));
		const run = first(
			streamed,
			() => ({ tag: 'loaded' }),
			async () => 'x',
			(e) => e,
		);
		expect(await run()).toBe('loaded');
	});
});
