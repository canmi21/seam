/* src/server/core/typescript/src/ws.ts */

import type { Router, DefinitionMap } from './router/index.js'
import { SeamError } from './errors.js'

export interface WsSink {
	send(data: string): void
	ping?: () => void
	close?: () => void
}

export interface ChannelWsSession {
	onMessage(data: string): void
	onPong(): void
	close(): void
}

export interface ChannelWsOptions {
	heartbeatInterval?: number
	pongTimeout?: number
}

interface UplinkMessage {
	id: string
	procedure: string
	input?: unknown
}

const DEFAULT_HEARTBEAT_MS = 21_000
const DEFAULT_PONG_TIMEOUT_MS = 5_000

function sendError(ws: WsSink, id: string | null, code: string, message: string): void {
	ws.send(JSON.stringify({ id, ok: false, error: { code, message, transient: false } }))
}

/** Validate uplink message fields and channel scope */
function parseUplink(ws: WsSink, data: string, channelName: string): UplinkMessage | null {
	let msg: UplinkMessage
	try {
		msg = JSON.parse(data) as UplinkMessage
	} catch {
		sendError(ws, null, 'VALIDATION_ERROR', 'Invalid JSON')
		return null
	}
	if (!msg.id || typeof msg.id !== 'string') {
		sendError(ws, null, 'VALIDATION_ERROR', "Missing 'id' field")
		return null
	}
	if (!msg.procedure || typeof msg.procedure !== 'string') {
		sendError(ws, msg.id, 'VALIDATION_ERROR', "Missing 'procedure' field")
		return null
	}
	const prefix = channelName + '.'
	if (!msg.procedure.startsWith(prefix) || msg.procedure === `${channelName}.events`) {
		sendError(
			ws,
			msg.id,
			'VALIDATION_ERROR',
			`Procedure '${msg.procedure}' is not a command of channel '${channelName}'`,
		)
		return null
	}
	return msg
}

/** Dispatch validated uplink command through the router */
function dispatchUplink<T extends DefinitionMap>(
	router: Router<T>,
	ws: WsSink,
	msg: UplinkMessage,
	channelInput: unknown,
): void {
	const mergedInput = {
		...(channelInput as Record<string, unknown>),
		...((msg.input ?? {}) as Record<string, unknown>),
	}
	void (async () => {
		try {
			const result = await router.handle(msg.procedure, mergedInput)
			if (result.status === 200) {
				const envelope = result.body as { ok: true; data: unknown }
				ws.send(JSON.stringify({ id: msg.id, ok: true, data: envelope.data }))
			} else {
				const envelope = result.body as {
					ok: false
					error: { code: string; message: string; transient: boolean }
				}
				ws.send(JSON.stringify({ id: msg.id, ok: false, error: envelope.error }))
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error'
			sendError(ws, msg.id, 'INTERNAL_ERROR', message)
		}
	})()
}

/**
 * Start a WebSocket session for a channel.
 *
 * Reuses `router.handleSubscription` for the event stream and
 * `router.handle` for uplink command dispatch — no Router changes needed.
 */
export function startChannelWs<T extends DefinitionMap>(
	router: Router<T>,
	channelName: string,
	channelInput: unknown,
	ws: WsSink,
	opts?: ChannelWsOptions,
): ChannelWsSession {
	const heartbeatMs = opts?.heartbeatInterval ?? DEFAULT_HEARTBEAT_MS
	const pongTimeoutMs = opts?.pongTimeout ?? DEFAULT_PONG_TIMEOUT_MS
	let closed = false
	let pongTimer: ReturnType<typeof setTimeout> | null = null

	// Heartbeat timer — also sends ping frame when sink supports it
	const heartbeatTimer = setInterval(() => {
		if (closed) return
		ws.send(JSON.stringify({ heartbeat: true }))
		if (ws.ping) {
			ws.ping()
			if (pongTimer) clearTimeout(pongTimer)
			pongTimer = setTimeout(() => {
				if (!closed) {
					closed = true
					clearInterval(heartbeatTimer)
					void iter.return?.(undefined)
					ws.close?.()
				}
			}, pongTimeoutMs)
		}
	}, heartbeatMs)

	// Start subscription and forward events as { event, payload }
	const subIterable = router.handleSubscription(`${channelName}.events`, channelInput)
	const iter = subIterable[Symbol.asyncIterator]()

	void (async () => {
		try {
			for (;;) {
				const result: IteratorResult<unknown> = await iter.next()
				if (result.done || closed) break
				const ev = result.value as { type: string; payload: unknown }
				ws.send(JSON.stringify({ event: ev.type, payload: ev.payload }))
			}
		} catch (err) {
			if (!closed) {
				const code = err instanceof SeamError ? err.code : 'INTERNAL_ERROR'
				const message = err instanceof Error ? err.message : 'Subscription error'
				ws.send(JSON.stringify({ event: '__error', payload: { code, message } }))
			}
		}
	})()

	return {
		onMessage(data: string) {
			if (closed) return
			const msg = parseUplink(ws, data, channelName)
			if (msg) dispatchUplink(router, ws, msg, channelInput)
		},

		onPong() {
			if (pongTimer) {
				clearTimeout(pongTimer)
				pongTimer = null
			}
		},

		close() {
			if (closed) return
			closed = true
			clearInterval(heartbeatTimer)
			if (pongTimer) clearTimeout(pongTimer)
			void iter.return?.(undefined)
		},
	}
}
