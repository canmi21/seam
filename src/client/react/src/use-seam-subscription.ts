/* src/client/react/src/use-seam-subscription.ts */

import { useEffect, useRef, useState } from 'react'
import { SeamClientError, parseSseStream, ReconnectController } from '@canmi/seam-client'
import type { ReconnectConfig } from '@canmi/seam-client'

export type SubscriptionStatus = 'connecting' | 'active' | 'error' | 'closed' | 'reconnecting'

export interface UseSeamSubscriptionResult<T> {
	data: T | null
	error: SeamClientError | null
	status: SubscriptionStatus
	retryCount: number
}

export interface UseSeamSubscriptionOptions {
	reconnect?: Partial<ReconnectConfig>
}

export function useSeamSubscription<T>(
	baseUrl: string,
	procedure: string,
	input: unknown,
	options?: UseSeamSubscriptionOptions,
): UseSeamSubscriptionResult<T> {
	const [data, setData] = useState<T | null>(null)
	const [error, setError] = useState<SeamClientError | null>(null)
	const [status, setStatus] = useState<SubscriptionStatus>('connecting')
	const [retryCount, setRetryCount] = useState(0)

	const inputKey = JSON.stringify(input)
	const inputRef = useRef(inputKey)
	inputRef.current = inputKey

	// Stable reference for reconnect config
	const reconnectRef = useRef(options?.reconnect)
	reconnectRef.current = options?.reconnect

	useEffect(() => {
		setData(null)
		setError(null)
		setStatus('connecting')
		setRetryCount(0)

		const cleanBase = baseUrl.replace(/\/+$/, '')
		const rc = new ReconnectController(reconnectRef.current)
		let abortController: AbortController | null = null
		let lastEventId: string | undefined
		let disposed = false

		rc.onStateChange((state) => {
			if (disposed) return
			if (state === 'reconnecting') {
				setStatus('reconnecting')
				setRetryCount(rc.retries)
			}
		})

		function connect(): void {
			if (disposed) return
			abortController = new AbortController()
			const params = new URLSearchParams({ input: inputKey })
			const url = `${cleanBase}/_seam/procedure/${procedure}?${params.toString()}`
			const headers: Record<string, string> = {}
			if (lastEventId) headers['Last-Event-ID'] = lastEventId

			fetch(url, { headers, signal: abortController.signal })
				.then((res) => {
					if (disposed) return
					if (!res.ok || !res.body) {
						setError(new SeamClientError('INTERNAL_ERROR', `HTTP ${res.status}`, res.status))
						setStatus('error')
						rc.onClose(connect)
						return
					}
					rc.onSuccess()
					setStatus('active')
					setRetryCount(0)
					return parseSseStream(res.body.getReader(), {
						onData(value) {
							if (disposed) return
							setData(value as T)
							setStatus('active')
						},
						onError(err) {
							if (disposed) return
							setError(new SeamClientError(err.code, err.message, 0))
							setStatus('error')
						},
						onComplete() {
							if (disposed) return
							setStatus('closed')
							disposed = true
							rc.dispose()
						},
						onId(id) {
							lastEventId = id
						},
					})
				})
				.then(() => {
					if (!disposed) rc.onClose(connect)
				})
				.catch((err: Error) => {
					if (err.name === 'AbortError') return
					if (!disposed) {
						setError(
							new SeamClientError('INTERNAL_ERROR', err.message ?? 'SSE connection failed', 0),
						)
						rc.onClose(connect)
					}
				})
		}

		connect()

		return () => {
			disposed = true
			rc.dispose()
			abortController?.abort()
		}
	}, [baseUrl, procedure, inputKey])

	return { data, error, status, retryCount }
}
