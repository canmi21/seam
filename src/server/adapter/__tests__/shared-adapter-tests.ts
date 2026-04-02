/* src/server/adapter/__tests__/shared-adapter-tests.ts */

// Test-runner agnostic: does NOT import vitest or bun:test.
// Each adapter test file wraps these in its own describe/it blocks.

export interface SseEvent {
	event?: string
	id?: string
	data?: string
}

export function parseSSE(text: string): SseEvent[] {
	return text
		.split('\n\n')
		.filter((block) => block.trim())
		.map((block) => {
			const evt: SseEvent = {}
			for (const line of block.split('\n')) {
				if (line.startsWith('event: ')) evt.event = line.slice(7)
				else if (line.startsWith('id: ')) evt.id = line.slice(4)
				else if (line.startsWith('data: ')) evt.data = line.slice(6)
			}
			return evt
		})
}

type FetchFn = (path: string, init?: RequestInit) => Promise<Response>
type Expect = (value: unknown) => {
	toBe: (expected: unknown) => void
	toEqual: (expected: unknown) => void
	toBeDefined: () => void
}

function createManifestTests(fetchFn: FetchFn, expect: Expect) {
	return {
		async manifest() {
			const res = await fetchFn('/_seam/manifest.json')
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.procedures.greet).toBeDefined()
		},
	}
}

function createProcedureTests(fetchFn: FetchFn, expect: Expect) {
	return {
		async rpcValid() {
			const res = await fetchFn('/_seam/procedure/greet', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Alice' }),
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toEqual({ ok: true, data: { message: 'Hello, Alice!' } })
		},

		async rpcInvalid() {
			const res = await fetchFn('/_seam/procedure/greet', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 123 }),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.ok).toBe(false)
			expect(body.error.code).toBe('VALIDATION_ERROR')
		},

		async unknownProcedure() {
			const res = await fetchFn('/_seam/procedure/unknown', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
			expect(res.status).toBe(404)
			const body = await res.json()
			expect(body.ok).toBe(false)
			expect(body.error.code).toBe('NOT_FOUND')
		},

		async nonJsonBody() {
			const res = await fetchFn('/_seam/procedure/greet', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: 'not json',
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.ok).toBe(false)
			expect(body.error.code).toBe('VALIDATION_ERROR')
		},

		async command() {
			const res = await fetchFn('/_seam/procedure/updateName', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'test' }),
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toEqual({ ok: true, data: { success: true } })
		},
	}
}

function createSubscriptionTests(fetchFn: FetchFn, expect: Expect) {
	return {
		async subscriptionEvents() {
			const res = await fetchFn('/_seam/procedure/onCount?input=%7B%22max%22%3A2%7D')
			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toBe('text/event-stream')
			const events = parseSSE(await res.text())
			const dataEvents = events.filter((e) => e.event === 'data')
			expect(dataEvents.length).toBe(2)
			expect(JSON.parse(dataEvents[0]?.data ?? '')).toEqual({ n: 0 })
			expect(JSON.parse(dataEvents[1]?.data ?? '')).toEqual({ n: 1 })
		},

		async unknownSubscription() {
			const res = await fetchFn('/_seam/procedure/nope')
			const events = parseSSE(await res.text())
			expect(events.some((e) => e.event === 'error' && e.data?.includes('not found'))).toBe(true)
		},
	}
}

function createStreamTests(fetchFn: FetchFn, expect: Expect) {
	return {
		async streamIncrementingIds() {
			const res = await fetchFn('/_seam/procedure/countdown', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ max: 2 }),
			})
			expect(res.status).toBe(200)
			expect(res.headers.get('content-type')).toBe('text/event-stream')
			const events = parseSSE(await res.text())
			const dataEvents = events.filter((e) => e.event === 'data')
			expect(dataEvents[0]?.id).toBe('0')
			expect(dataEvents[1]?.id).toBe('1')
			expect(JSON.parse(dataEvents[0]?.data ?? '')).toEqual({ n: 2 })
			expect(JSON.parse(dataEvents[1]?.data ?? '')).toEqual({ n: 1 })
			expect(events.some((e) => e.event === 'complete')).toBe(true)
		},

		async streamInvalidInput() {
			const res = await fetchFn('/_seam/procedure/countdown', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ max: 'bad' }),
			})
			const events = parseSSE(await res.text())
			expect(events.some((e) => e.event === 'error' && e.data?.includes('validation failed'))).toBe(
				true,
			)
		},
	}
}

function createUploadTests(fetchFn: FetchFn, expect: Expect) {
	return {
		async uploadMultipart() {
			const form = new FormData()
			form.append('metadata', JSON.stringify({ title: 'Doc' }))
			form.append('file', new Blob(['hello'], { type: 'application/octet-stream' }), 'test.txt')
			const res = await fetchFn('/_seam/procedure/uploadFile', {
				method: 'POST',
				body: form,
			})
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body).toEqual({ ok: true, data: { title: 'Doc', received: true } })
		},

		async uploadWithoutFile() {
			const res = await fetchFn('/_seam/procedure/uploadFile', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: 'Doc' }),
			})
			expect(res.status).toBe(400)
			const body = await res.json()
			expect(body.error.code).toBe('VALIDATION_ERROR')
		},
	}
}

export function sharedRpcTests(fetchFn: FetchFn, expect: Expect) {
	return {
		...createManifestTests(fetchFn, expect),
		...createProcedureTests(fetchFn, expect),
		...createSubscriptionTests(fetchFn, expect),
		...createStreamTests(fetchFn, expect),
		...createUploadTests(fetchFn, expect),
	}
}
