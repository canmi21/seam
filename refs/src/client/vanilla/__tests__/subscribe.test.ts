/* src/client/vanilla/__tests__/subscribe.test.ts */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/client.js'
import { SeamClientError } from '../src/errors.js'

/** Encode SSE text into a ReadableStream of Uint8Array chunks */
function sseStream(...frames: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()
	return new ReadableStream({
		start(controller) {
			for (const frame of frames) {
				controller.enqueue(encoder.encode(frame))
			}
			controller.close()
		},
	})
}

function mockFetchSse(...frames: string[]) {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		body: sseStream(...frames),
	})
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('subscribe()', () => {
	it('fetches correct URL with input params', async () => {
		const fetchSpy = mockFetchSse('event: complete\ndata: {}\n\n')
		vi.stubGlobal('fetch', fetchSpy)

		const client = createClient({ baseUrl: 'http://localhost:3000', reconnect: { enabled: false } })
		client.subscribe('counter', { room: 'A' }, vi.fn())

		// Let the fetch promise resolve
		await vi.advanceTimersByTimeAsync(0)

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const url = fetchSpy.mock.calls[0][0] as string
		expect(url).toBe(
			'http://localhost:3000/_seam/procedure/counter?input=%7B%22room%22%3A%22A%22%7D',
		)
	})

	it('calls onData with parsed JSON on data event', async () => {
		vi.stubGlobal(
			'fetch',
			mockFetchSse('event: data\ndata: {"count":42}\n\n', 'event: complete\ndata: {}\n\n'),
		)

		const client = createClient({ baseUrl: 'http://localhost:3000', reconnect: { enabled: false } })
		const onData = vi.fn()
		client.subscribe('counter', {}, onData)

		await vi.advanceTimersByTimeAsync(0)

		expect(onData).toHaveBeenCalledWith({ count: 42 })
	})

	it('calls onError on SSE error event', async () => {
		vi.stubGlobal(
			'fetch',
			mockFetchSse('event: error\ndata: {"code":"NOT_FOUND","message":"stream not found"}\n\n'),
		)

		const client = createClient({ baseUrl: 'http://localhost:3000', reconnect: { enabled: false } })
		const onError = vi.fn()
		client.subscribe('counter', {}, vi.fn(), onError)

		await vi.advanceTimersByTimeAsync(0)

		expect(onError).toHaveBeenCalledTimes(1)
		const err = onError.mock.calls[0][0] as SeamClientError
		expect(err).toBeInstanceOf(SeamClientError)
		expect(err.code).toBe('NOT_FOUND')
		expect(err.message).toBe('stream not found')
	})

	it('calls onError with INTERNAL_ERROR on HTTP failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				body: null,
			}),
		)

		const client = createClient({ baseUrl: 'http://localhost:3000', reconnect: { enabled: false } })
		const onError = vi.fn()
		client.subscribe('counter', {}, vi.fn(), onError)

		await vi.advanceTimersByTimeAsync(0)

		expect(onError).toHaveBeenCalledTimes(1)
		const err = onError.mock.calls[0][0] as SeamClientError
		expect(err.code).toBe('INTERNAL_ERROR')
		expect(err.message).toBe('HTTP 500')
	})

	it('returned unsubscribe aborts the fetch', async () => {
		vi.stubGlobal(
			'fetch',
			mockFetchSse('event: data\ndata: {"count":1}\n\n', 'event: complete\ndata: {}\n\n'),
		)

		const client = createClient({ baseUrl: 'http://localhost:3000', reconnect: { enabled: false } })
		const unsub = client.subscribe('counter', {}, vi.fn())

		unsub()

		// Should not throw after unsubscribe
		await vi.advanceTimersByTimeAsync(0)
	})

	it('calls onError with INTERNAL_ERROR when data parse fails', async () => {
		vi.stubGlobal(
			'fetch',
			mockFetchSse('event: data\ndata: not valid json{\n\n', 'event: complete\ndata: {}\n\n'),
		)

		const client = createClient({ baseUrl: 'http://localhost:3000', reconnect: { enabled: false } })
		const onError = vi.fn()
		client.subscribe('counter', {}, vi.fn(), onError)

		await vi.advanceTimersByTimeAsync(0)

		expect(onError).toHaveBeenCalledTimes(1)
		const err = onError.mock.calls[0][0] as SeamClientError
		expect(err.code).toBe('INTERNAL_ERROR')
		expect(err.message).toBe('Failed to parse SSE data')
	})

	it('does not reconnect after complete event', async () => {
		const fetchSpy = mockFetchSse('event: complete\ndata: {}\n\n')
		vi.stubGlobal('fetch', fetchSpy)

		const client = createClient({ baseUrl: 'http://localhost:3000' })
		client.subscribe('counter', {}, vi.fn())

		await vi.advanceTimersByTimeAsync(0)

		// Advance past any potential reconnect delay
		await vi.advanceTimersByTimeAsync(5000)

		// fetch should only be called once (no reconnect)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})
})
