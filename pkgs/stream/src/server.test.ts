import { uneval } from 'devalue';
import { describe, expect, it } from 'vitest';
import { streaming, type Options } from './server.ts';

const options = (more: Partial<Options> = {}): Options => ({
	global: '__sveltekit_x',
	open: '<script nonce="n">',
	uneval: (value) => uneval(value),
	convert: async (error) => ({ message: String(error) }),
	...more,
});

async function all(chunks: AsyncIterable<string> | null): Promise<string[]> {
	const found: string[] = [];
	for await (const one of chunks ?? []) found.push(one);
	return found;
}

describe('what a render left unsettled', () => {
	it('declares only what Kit did not write, and only queries and live queries', () => {
		const stream = streaming(options());
		stream.add('q', 'a/1', new Promise(() => {}));
		stream.add('q', 'a/2', Promise.resolve(2));
		stream.add('l', 'b/1', new Promise(() => {}));
		stream.add('f', 'c/1', new Promise(() => {}));
		const declared = stream.declare({ q: { 'a/2': { v: 2 } } });
		expect(declared).toContain('[["q","a/1",1],["l","b/1",2]]');
		expect(declared).not.toContain('a/2');
		expect(declared).not.toContain('c/1');
	});

	it('declares nothing, and streams nothing, where Kit wrote everything', async () => {
		const stream = streaming(options());
		stream.add('q', 'a/1', Promise.resolve(1));
		expect(stream.declare({ q: { 'a/1': { v: 1 } } })).toBe('');
		expect(stream.with(null)).toBeNull();
	});

	it('streams a value, an error as Kit converts it, and a redirect as nothing', async () => {
		const stream = streaming(
			options({ convert: async (error) => (error === 'redirect' ? null : { message: 'nope' }) }),
		);
		stream.add('q', 'v', Promise.resolve({ n: 1 }));
		stream.add('q', 'e', Promise.reject(new Error('x')));
		stream.add('q', 'r', Promise.reject('redirect'));
		stream.declare({});
		const sent = (await all(stream.with(null))).join('');
		expect(sent).toContain(
			'<script nonce="n">__sveltekit_x.settle(1, (app) => ({v:{n:1}}))</script>',
		);
		expect(sent).toContain('__sveltekit_x.settle(2, (app) => ({e:{message:"nope"}}))');
		expect(sent).toContain('__sveltekit_x.settle(3, (app) => (null))');
	});

	it('hands the client a value that has not settled within the limit', async () => {
		const stream = streaming(options({ limit: 10 }));
		stream.add('l', 'never', new Promise(() => {}));
		stream.declare({});
		expect(await all(stream.with(null))).toEqual([
			'<script nonce="n">__sveltekit_x.settle(1, (app) => (null))</script>\n',
		]);
	});

	it("sends Kit's own chunks beside its own, each as it comes", async () => {
		const stream = streaming(options());
		let late: (value: number) => void = () => {};
		stream.add('q', 'slow', new Promise<number>((done) => (late = done)));
		stream.declare({});
		async function* kit(): AsyncIterable<string> {
			yield 'kit-1';
			setTimeout(() => late(5), 5);
			await new Promise((done) => setTimeout(done, 20));
			yield 'kit-2';
		}
		const sent = await all(stream.with(kit()));
		expect(sent).toEqual([
			'kit-1',
			'<script nonce="n">__sveltekit_x.settle(1, (app) => ({v:5}))</script>\n',
			'kit-2',
		]);
	});

	it('writes nothing into the declaration that could close the script', () => {
		const stream = streaming(options());
		stream.add('q', '</script>', new Promise(() => {}));
		expect(stream.declare({})).not.toContain('</script>');
	});
});
