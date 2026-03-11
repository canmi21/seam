/* src/server/core/typescript/__tests__/transport.test.ts */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { createRouter, t, createChannel } from '../src/index.js'
import type { TransportConfig } from '../src/index.js'
import { withSseLifecycle } from '../src/http-sse.js'

afterEach(() => {
	vi.useRealTimers()
})

function registerTransportManifestTests() {
	test('procedure transport appears in manifest', () => {
		const transport: TransportConfig = { prefer: 'ws' }
		const router = createRouter({
			live: {
				kind: 'subscription',
				input: t.object({}),
				output: t.object({}),
				transport,
				handler: async function* () {},
			},
		})
		const manifest = router.manifest()
		expect(manifest.procedures.live.transport).toEqual({ prefer: 'ws' })
	})

	test('no transport omits field', () => {
		const router = createRouter({
			getUser: {
				input: t.object({}),
				output: t.object({}),
				handler: () => ({}),
			},
		})
		const manifest = router.manifest()
		expect(manifest.procedures.getUser.transport).toBeUndefined()
	})

	test('transportDefaults from RouterOptions', () => {
		const router = createRouter(
			{
				getUser: {
					input: t.object({}),
					output: t.object({}),
					handler: () => ({}),
				},
			},
			{
				transportDefaults: {
					query: { prefer: 'http' },
					subscription: { prefer: 'ws', fallback: ['sse', 'http'] },
				},
			},
		)
		const manifest = router.manifest()
		expect(manifest.transportDefaults).toEqual({
			query: { prefer: 'http' },
			subscription: { prefer: 'ws', fallback: ['sse', 'http'] },
		})
	})

	test('channel transport in channelMeta', () => {
		const ch = createChannel('chat', {
			input: t.object({}),
			incoming: {
				send: {
					input: t.object({}),
					output: t.object({}),
					handler: () => ({}),
				},
			},
			outgoing: {
				message: t.object({}),
			},
			subscribe: async function* () {},
			transport: { prefer: 'ws', fallback: ['http'] },
		})
		expect(ch.channelMeta.transport).toEqual({ prefer: 'ws', fallback: ['http'] })
	})

	test('default transportDefaults is empty', () => {
		const router = createRouter({
			getUser: {
				input: t.object({}),
				output: t.object({}),
				handler: () => ({}),
			},
		})
		const manifest = router.manifest()
		expect(manifest.transportDefaults).toEqual({})
	})
}

function registerSseLifecycleTests() {
	test('SSE emits an initial heartbeat immediately', async () => {
		const iter = withSseLifecycle(
			{
				async *[Symbol.asyncIterator]() {
					await new Promise(() => {})
					yield ''
				},
			},
			{ sseIdleTimeout: 0 },
		)[Symbol.asyncIterator]()

		await expect(iter.next()).resolves.toEqual({ done: false, value: ': heartbeat\n\n' })
		await iter.return?.(undefined)
	})

	test('default SSE heartbeat fires every 8 seconds', async () => {
		vi.useFakeTimers()

		const iter = withSseLifecycle(
			{
				async *[Symbol.asyncIterator]() {
					await new Promise(() => {})
					yield ''
				},
			},
			{ sseIdleTimeout: 0 },
		)[Symbol.asyncIterator]()

		await expect(iter.next()).resolves.toEqual({ done: false, value: ': heartbeat\n\n' })

		const nextChunk = iter.next()
		vi.advanceTimersByTime(8_000)
		await Promise.resolve()
		await Promise.resolve()
		await expect(nextChunk).resolves.toEqual({ done: false, value: ': heartbeat\n\n' })
		await iter.return?.(undefined)
	})

	test('default SSE idle timeout completes after 12 seconds', async () => {
		vi.useFakeTimers()

		const iter = withSseLifecycle(
			{
				async *[Symbol.asyncIterator]() {
					await new Promise(() => {})
					yield ''
				},
			},
			{ heartbeatInterval: 60_000 },
		)[Symbol.asyncIterator]()

		await expect(iter.next()).resolves.toEqual({ done: false, value: ': heartbeat\n\n' })

		const nextChunk = iter.next()
		vi.advanceTimersByTime(12_000)
		await Promise.resolve()
		await Promise.resolve()
		await expect(nextChunk).resolves.toEqual({
			done: false,
			value: 'event: complete\ndata: {}\n\n',
		})
		await iter.return?.(undefined)
	})
}

describe('transport declaration', () => {
	registerTransportManifestTests()
	registerSseLifecycleTests()
})
