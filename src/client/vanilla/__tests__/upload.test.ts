/* src/client/vanilla/__tests__/upload.test.ts */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/client.js'
import { SeamClientError } from '../src/errors.js'

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('upload()', () => {
	it('sends FormData with metadata and file', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, data: { videoId: 'v1' } }))

		const client = createClient({ baseUrl: 'http://localhost:3000' })
		const file = new Blob(['video-data'], { type: 'video/mp4' })
		const result = await client.upload('uploadVideo', { title: 'Test' }, file)

		expect(result).toEqual({ videoId: 'v1' })
		expect(fetch).toHaveBeenCalledTimes(1)

		const call = vi.mocked(fetch).mock.calls[0]
		const [url, init] = call ?? []
		expect(url).toBe('http://localhost:3000/_seam/procedure/uploadVideo')
		expect(init?.method).toBe('POST')

		const body = init?.body as FormData
		expect(body).toBeInstanceOf(FormData)
		expect(body.get('metadata')).toBe(JSON.stringify({ title: 'Test' }))
		expect(body.get('file')).toBeInstanceOf(Blob)
	})

	it('does not set Content-Type header', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true, data: {} }))

		const client = createClient({ baseUrl: 'http://localhost:3000' })
		await client.upload('uploadVideo', {}, new Blob(['data']))

		const call2 = vi.mocked(fetch).mock.calls[0]
		const [, init] = call2 ?? []
		expect(init?.headers).toBeUndefined()
	})

	it('throws SeamClientError on error response', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse(
				{ ok: false, error: { code: 'VALIDATION_ERROR', message: 'bad input', transient: false } },
				400,
			),
		)

		const client = createClient({ baseUrl: 'http://localhost:3000' })
		await expect(client.upload('uploadVideo', {}, new Blob([]))).rejects.toThrow(SeamClientError)
	})

	it('throws on network failure', async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'))

		const client = createClient({ baseUrl: 'http://localhost:3000' })

		try {
			await client.upload('uploadVideo', {}, new Blob([]))
		} catch (e) {
			const err = e as SeamClientError
			expect(err.code).toBe('INTERNAL_ERROR')
			expect(err.status).toBe(0)
		}
	})
})
