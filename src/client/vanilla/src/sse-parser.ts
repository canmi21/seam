/* src/client/vanilla/src/sse-parser.ts */

export interface SseCallbacks {
	onData: (data: unknown) => void
	onError: (error: { code: string; message: string }) => void
	onComplete: () => void
	onId?: (id: string) => void
}

/**
 * Parse an SSE byte stream from a fetch Response body.
 * Handles event/data/id fields separated by blank lines.
 */
export async function parseSseStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	callbacks: SseCallbacks,
): Promise<void> {
	const decoder = new TextDecoder()
	let buffer = ''

	for (;;) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })

		// Split on double newline (SSE event boundary)
		let boundary: number
		while ((boundary = buffer.indexOf('\n\n')) !== -1) {
			const block = buffer.slice(0, boundary)
			buffer = buffer.slice(boundary + 2)
			processBlock(block, callbacks)
		}
	}

	// Flush remaining buffer (server may close without trailing \n\n)
	if (buffer.trim()) {
		processBlock(buffer, callbacks)
	}
}

function processBlock(block: string, callbacks: SseCallbacks): void {
	let eventType = 'message'
	let data = ''
	let id: string | undefined

	for (const line of block.split('\n')) {
		if (line.startsWith('event:')) {
			eventType = line.slice(6).trim()
		} else if (line.startsWith('data:')) {
			data = line.slice(5).trim()
		} else if (line.startsWith('id:')) {
			id = line.slice(3).trim()
		}
	}

	if (id !== undefined) {
		callbacks.onId?.(id)
	}

	if (!data) return

	if (eventType === 'data') {
		try {
			callbacks.onData(JSON.parse(data) as unknown)
		} catch {
			callbacks.onError({ code: 'INTERNAL_ERROR', message: 'Failed to parse SSE data' })
		}
	} else if (eventType === 'error') {
		try {
			const payload = JSON.parse(data) as { code?: string; message?: string }
			callbacks.onError({
				code: typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR',
				message: typeof payload.message === 'string' ? payload.message : 'SSE error',
			})
		} catch {
			callbacks.onError({ code: 'INTERNAL_ERROR', message: 'SSE error' })
		}
	} else if (eventType === 'complete') {
		callbacks.onComplete()
	}
}
