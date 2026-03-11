/* src/server/core/typescript/src/http-sse.ts */

import { SeamError } from './errors.js'
import type { RawContextMap } from './context.js'
import type { HttpStreamResponse, RpcHashMap, SseOptions } from './http.js'
import type { DefinitionMap, Router } from './router/index.js'

const SSE_HEADER = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	Connection: 'keep-alive',
}

const DEFAULT_HEARTBEAT_MS = 8_000
const DEFAULT_SSE_IDLE_MS = 12_000

export function getSseHeaders(): Record<string, string> {
	return SSE_HEADER
}

export function sseDataEvent(data: unknown): string {
	return `event: data\ndata: ${JSON.stringify(data)}\n\n`
}

export function sseDataEventWithId(data: unknown, id: number): string {
	return `event: data\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`
}

export function sseErrorEvent(code: string, message: string, transient = false): string {
	return `event: error\ndata: ${JSON.stringify({ code, message, transient })}\n\n`
}

export function sseCompleteEvent(): string {
	return 'event: complete\ndata: {}\n\n'
}

function formatSseError(error: unknown): string {
	if (error instanceof SeamError) {
		return sseErrorEvent(error.code, error.message)
	}
	const message = error instanceof Error ? error.message : 'Unknown error'
	return sseErrorEvent('INTERNAL_ERROR', message)
}

export async function* withSseLifecycle(
	inner: AsyncIterable<string>,
	opts?: SseOptions,
): AsyncGenerator<string> {
	const heartbeatMs = opts?.heartbeatInterval ?? DEFAULT_HEARTBEAT_MS
	const idleMs = opts?.sseIdleTimeout ?? DEFAULT_SSE_IDLE_MS
	const idleEnabled = idleMs > 0

	const queue: Array<
		{ type: 'data'; value: string } | { type: 'done' } | { type: 'heartbeat' } | { type: 'idle' }
	> = []
	let resolve: (() => void) | null = null
	const signal = () => {
		if (resolve) {
			resolve()
			resolve = null
		}
	}

	let idleTimer: ReturnType<typeof setTimeout> | null = null
	const resetIdle = () => {
		if (!idleEnabled) return
		if (idleTimer) clearTimeout(idleTimer)
		idleTimer = setTimeout(() => {
			queue.push({ type: 'idle' })
			signal()
		}, idleMs)
	}

	const heartbeatTimer = setInterval(() => {
		queue.push({ type: 'heartbeat' })
		signal()
	}, heartbeatMs)

	queue.push({ type: 'heartbeat' })
	resetIdle()

	void (async () => {
		try {
			for await (const chunk of inner) {
				queue.push({ type: 'data', value: chunk })
				resetIdle()
				signal()
			}
		} catch {
			// Inner generator error
		}
		queue.push({ type: 'done' })
		signal()
	})()

	try {
		for (;;) {
			while (queue.length === 0) {
				await new Promise<void>((r) => {
					resolve = r
				})
			}
			const item = queue.shift()
			if (!item) continue
			if (item.type === 'data') {
				yield item.value
			} else if (item.type === 'heartbeat') {
				yield ': heartbeat\n\n'
			} else if (item.type === 'idle') {
				yield sseCompleteEvent()
				return
			} else {
				return
			}
		}
	} finally {
		clearInterval(heartbeatTimer)
		if (idleTimer) clearTimeout(idleTimer)
	}
}

export async function* sseStream<T extends DefinitionMap>(
	router: Router<T>,
	name: string,
	input: unknown,
	rawCtx?: RawContextMap,
	lastEventId?: string,
): AsyncIterable<string> {
	try {
		let seq = 0
		for await (const value of router.handleSubscription(name, input, rawCtx, lastEventId)) {
			yield sseDataEventWithId(value, seq++)
		}
		yield sseCompleteEvent()
	} catch (error) {
		yield formatSseError(error)
	}
}

export async function* sseStreamForStream<T extends DefinitionMap>(
	router: Router<T>,
	name: string,
	input: unknown,
	signal?: AbortSignal,
	rawCtx?: RawContextMap,
): AsyncGenerator<string> {
	const gen = router.handleStream(name, input, rawCtx)
	if (signal) {
		signal.addEventListener(
			'abort',
			() => {
				void gen.return(undefined)
			},
			{ once: true },
		)
	}
	try {
		let seq = 0
		for await (const value of gen) {
			yield sseDataEventWithId(value, seq++)
		}
		yield sseCompleteEvent()
	} catch (error) {
		yield formatSseError(error)
	}
}

export function buildHashLookup(hashMap: RpcHashMap | undefined): Map<string, string> | null {
	if (!hashMap) return null
	const map = new Map(Object.entries(hashMap.procedures).map(([n, h]) => [h, n]))
	map.set('seam.i18n.query', 'seam.i18n.query')
	return map
}

export function createDevReloadResponse(
	devState: { resolvers: Set<() => void> },
	sseOptions?: SseOptions,
): HttpStreamResponse {
	const controller = new AbortController()
	async function* devStream(): AsyncGenerator<string> {
		yield ': connected\n\n'
		const aborted = new Promise<never>((_, reject) => {
			controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {
				once: true,
			})
		})
		try {
			while (!controller.signal.aborted) {
				await Promise.race([
					new Promise<void>((r) => {
						devState.resolvers.add(r)
					}),
					aborted,
				])
				yield 'data: reload\n\n'
			}
		} catch {
			/* aborted */
		}
	}
	return {
		status: 200,
		headers: { ...SSE_HEADER, 'X-Accel-Buffering': 'no' },
		stream: withSseLifecycle(devStream(), { ...sseOptions, sseIdleTimeout: 0 }),
		onCancel: () => controller.abort(),
	}
}
