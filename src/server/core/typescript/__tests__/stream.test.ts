/* src/server/core/typescript/__tests__/stream.test.ts */

import { describe, expect, it } from 'vitest'
import {
	createRouter,
	t,
	createHttpHandler,
	sseDataEventWithId,
	sseCompleteEvent,
} from '../src/index.js'
import type { StreamDef, HttpStreamResponse } from '../src/index.js'

async function* countChunks(max: number): AsyncGenerator<{ n: number }> {
	for (let i = 1; i <= max; i++) {
		yield { n: i }
	}
}

const router = createRouter({
	greet: {
		input: t.object({ name: t.string() }),
		output: t.object({ message: t.string() }),
		handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
	},
	countStream: {
		kind: 'stream',
		input: t.object({ max: t.int32() }),
		output: t.object({ n: t.int32() }),
		handler: ({ input }) => countChunks(input.max),
	} satisfies StreamDef<{ max: number }, { n: number }>,
})

describe('router.handleStream', () => {
	it('yields chunks from the stream handler', async () => {
		const results: unknown[] = []
		for await (const value of router.handleStream('countStream', { max: 3 })) {
			results.push(value)
		}
		expect(results).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
	})

	it('handles empty stream', async () => {
		const emptyRouter = createRouter({
			emptyStream: {
				kind: 'stream',
				input: t.object({}),
				output: t.object({ n: t.int32() }),
				handler: async function* () {
					// yields nothing
				},
			} satisfies StreamDef<Record<string, never>, { n: number }>,
		})
		const results: unknown[] = []
		for await (const value of emptyRouter.handleStream('emptyStream', {})) {
			results.push(value)
		}
		expect(results).toEqual([])
	})

	it('throws NOT_FOUND for unknown stream', async () => {
		const iter = router.handleStream('unknown', {})
		await expect(collect(iter)).rejects.toThrow('not found')
	})

	it('throws VALIDATION_ERROR for invalid input', async () => {
		const iter = router.handleStream('countStream', { max: 'not a number' })
		await expect(collect(iter)).rejects.toThrow('Input validation failed:')
	})

	it('propagates handler errors', async () => {
		const errorRouter = createRouter({
			failStream: {
				kind: 'stream',
				input: t.object({}),
				output: t.object({ n: t.int32() }),
				handler: async function* () {
					yield { n: 1 }
					throw new Error('stream broke')
				},
			} satisfies StreamDef<Record<string, never>, { n: number }>,
		})
		const results: unknown[] = []
		await expect(
			(async () => {
				for await (const v of errorRouter.handleStream('failStream', {})) {
					results.push(v)
				}
			})(),
		).rejects.toThrow('stream broke')
		expect(results).toEqual([{ n: 1 }])
	})
})

describe('router.getKind', () => {
	it('returns correct kind for each procedure type', () => {
		expect(router.getKind('greet')).toBe('query')
		expect(router.getKind('countStream')).toBe('stream')
	})

	it('returns null for unknown procedures', () => {
		expect(router.getKind('nonexistent')).toBeNull()
	})
})

describe('stream output validation', () => {
	it('throws when chunk output is invalid', async () => {
		const validatedRouter = createRouter(
			{
				badStream: {
					kind: 'stream',
					input: t.object({}),
					output: t.object({ n: t.int32() }),
					handler: async function* () {
						yield { wrong: 'field' }
					},
				} satisfies StreamDef<Record<string, never>, { n: number }>,
			},
			{ validateOutput: true },
		)
		const iter = validatedRouter.handleStream('badStream', {})
		await expect(collect(iter)).rejects.toThrow('Output validation failed')
	})
})

describe('manifest kind field for stream', () => {
	it('includes kind: stream in manifest', () => {
		const manifest = router.manifest()
		expect(manifest.procedures.countStream.kind).toBe('stream')
	})

	it('uses chunkOutput instead of output for stream', () => {
		const manifest = router.manifest()
		expect(manifest.procedures.countStream.chunkOutput).toBeDefined()
		expect(manifest.procedures.countStream.output).toBeUndefined()
		// Non-stream procedures still use output
		expect(manifest.procedures.greet.output).toBeDefined()
		expect(manifest.procedures.greet.chunkOutput).toBeUndefined()
	})
})

// -- SSE HTTP endpoint for stream --

describe('stream HTTP endpoint', () => {
	const handler = createHttpHandler(router)

	it('returns SSE stream for POST to stream procedure', async () => {
		const res = await handler({
			method: 'POST',
			url: 'http://localhost/_seam/procedure/countStream',
			body: () => Promise.resolve({ max: 2 }),
		})
		expect(res.status).toBe(200)
		expect(res.headers['Content-Type']).toBe('text/event-stream')
		expect('stream' in res).toBe(true)

		const chunks = await collectStrings((res as HttpStreamResponse).stream)
		expect(chunks).toContain(sseDataEventWithId({ n: 1 }, 0))
		expect(chunks).toContain(sseDataEventWithId({ n: 2 }, 1))
		expect(chunks[chunks.length - 1]).toBe(sseCompleteEvent())
	})

	it('returns JSON for POST to non-stream procedure', async () => {
		const res = await handler({
			method: 'POST',
			url: 'http://localhost/_seam/procedure/greet',
			body: () => Promise.resolve({ name: 'Alice' }),
		})
		expect(res.status).toBe(200)
		expect(res.headers['Content-Type']).toBe('application/json')
		expect('body' in res).toBe(true)
	})

	it('stream response has onCancel callback', async () => {
		const res = await handler({
			method: 'POST',
			url: 'http://localhost/_seam/procedure/countStream',
			body: () => Promise.resolve({ max: 2 }),
		})
		expect('onCancel' in res).toBe(true)
		expect(typeof (res as HttpStreamResponse).onCancel).toBe('function')
	})

	it('emits SSE error for invalid stream input', async () => {
		const res = await handler({
			method: 'POST',
			url: 'http://localhost/_seam/procedure/countStream',
			body: () => Promise.resolve({ max: 'not a number' }),
		})
		expect('stream' in res).toBe(true)
		const chunks = await collectStrings((res as HttpStreamResponse).stream)
		expect(chunks[0]).toContain('VALIDATION_ERROR')
	})
})

// -- SSE formatting --

describe('sseDataEventWithId', () => {
	it('formats correctly with id', () => {
		expect(sseDataEventWithId({ n: 1 }, 0)).toBe('event: data\nid: 0\ndata: {"n":1}\n\n')
		expect(sseDataEventWithId({ n: 2 }, 5)).toBe('event: data\nid: 5\ndata: {"n":2}\n\n')
	})
})

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
	const results: T[] = []
	for await (const v of iter) results.push(v)
	return results
}

async function collectStrings(iter: AsyncIterable<string>): Promise<string[]> {
	return collect(iter)
}
