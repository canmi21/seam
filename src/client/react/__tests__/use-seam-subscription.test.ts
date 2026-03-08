/* src/client/react/__tests__/use-seam-subscription.test.ts */
/* oxlint-disable @typescript-eslint/no-non-null-assertion */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useSeamSubscription } from '../src/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// --- SSE stream helpers ---

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

/** Create a controllable SSE stream for step-by-step testing */
function createControllableStream() {
	const encoder = new TextEncoder()
	let controller: ReadableStreamDefaultController<Uint8Array>
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c
		},
	})
	return {
		stream,
		push(frame: string) {
			controller.enqueue(encoder.encode(frame))
		},
		close() {
			controller.close()
		},
	}
}

// --- Test harness ---

let container: HTMLDivElement
let root: Root

function readState() {
	const el = container.querySelector('#result')
	return JSON.parse(el!.textContent!)
}

// Test component that renders hook state as JSON
function Sub(props: { baseUrl: string; procedure: string; input: unknown }) {
	const { data, error, status, retryCount } = useSeamSubscription(
		props.baseUrl,
		props.procedure,
		props.input,
		{ reconnect: { enabled: false } },
	)
	return createElement(
		'pre',
		{ id: 'result' },
		JSON.stringify({
			data,
			error: error ? { code: error.code, message: error.message } : null,
			status,
			retryCount,
		}),
	)
}

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(async () => {
	await act(async () => {
		root.unmount()
	})
	container.remove()
	vi.restoreAllMocks()
})

describe('useSeamSubscription: connection', () => {
	it('fetches with correct URL', async () => {
		const fetchSpy = mockFetchSse('event: complete\ndata: {}\n\n')
		vi.stubGlobal('fetch', fetchSpy)

		await act(async () => {
			root.render(
				createElement(Sub, {
					baseUrl: 'http://localhost:3000/',
					procedure: 'counter',
					input: { room: 'A' },
				}),
			)
		})

		// Let microtasks resolve
		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const url = fetchSpy.mock.calls[0][0] as string
		expect(url).toContain('/_seam/procedure/counter?')
		expect(url.startsWith('http://localhost:3000/_seam/')).toBe(true)
		const params = new URLSearchParams(url.split('?')[1])
		expect(JSON.parse(params.get('input')!)).toEqual({ room: 'A' })
	})

	it('starts in connecting state with null data and error', async () => {
		// Use a never-resolving fetch to keep the state at 'connecting'
		vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		expect(readState()).toEqual({ data: null, error: null, status: 'connecting', retryCount: 0 })
	})

	it('transitions to active on data event', async () => {
		const ctrl = createControllableStream()
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: ctrl.stream }))

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		// Allow fetch to resolve
		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		await act(async () => {
			ctrl.push('event: data\ndata: {"count":42}\n\n')
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		expect(readState()).toEqual({
			data: { count: 42 },
			error: null,
			status: 'active',
			retryCount: 0,
		})
		ctrl.close()
	})
})

describe('useSeamSubscription: errors', () => {
	it('reports error on data parse failure', async () => {
		vi.stubGlobal(
			'fetch',
			mockFetchSse('event: data\ndata: not valid json{\n\n', 'event: complete\ndata: {}\n\n'),
		)

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		const state = readState()
		// Error is reported even though complete event follows immediately
		expect(state.error).not.toBeNull()
		expect(state.error.code).toBe('INTERNAL_ERROR')
		expect(state.error.message).toBe('Failed to parse SSE data')
	})

	it('transitions to error on SSE error event', async () => {
		vi.stubGlobal(
			'fetch',
			mockFetchSse('event: error\ndata: {"code":"NOT_FOUND","message":"stream not found"}\n\n'),
		)

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		const state = readState()
		expect(state.status).toBe('error')
		expect(state.error.message).toBe('stream not found')
	})

	it('transitions to error on HTTP failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }))

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		const state = readState()
		expect(state.status).toBe('error')
		expect(state.error.code).toBe('INTERNAL_ERROR')
		expect(state.error.message).toBe('HTTP 500')
	})
})

describe('useSeamSubscription: lifecycle', () => {
	it('transitions to closed on complete event', async () => {
		vi.stubGlobal('fetch', mockFetchSse('event: complete\ndata: {}\n\n'))

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		expect(readState().status).toBe('closed')
	})

	it('aborts fetch on unmount', async () => {
		const ctrl = createControllableStream()
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: ctrl.stream }))

		await act(async () => {
			root.render(
				createElement(Sub, { baseUrl: 'http://localhost:3000', procedure: 'counter', input: {} }),
			)
		})

		await act(async () => {
			root.render(createElement('div'))
		})

		// Should not throw after unmount
		ctrl.close()
	})

	it('creates new fetch when inputs change', async () => {
		const fetchSpy = mockFetchSse(
			'event: data\ndata: {"count":1}\n\n',
			'event: complete\ndata: {}\n\n',
		)
		vi.stubGlobal('fetch', fetchSpy)

		await act(async () => {
			root.render(
				createElement(Sub, {
					baseUrl: 'http://localhost:3000',
					procedure: 'counter',
					input: { room: 'A' },
				}),
			)
		})

		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		// Change input -> should create a new fetch
		await act(async () => {
			root.render(
				createElement(Sub, {
					baseUrl: 'http://localhost:3000',
					procedure: 'counter',
					input: { room: 'B' },
				}),
			)
		})

		await act(async () => {
			await new Promise<void>((r) => {
				setTimeout(r, 0)
			})
		})

		// Should have fetched for both inputs
		expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
		const urls = fetchSpy.mock.calls.map((c: unknown[]) => c[0] as string)
		expect(urls.some((u: string) => u.includes('room'))).toBe(true)
	})
})
