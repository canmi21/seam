/* src/server/adapter/hono/__tests__/adapter.test.ts */

import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { createRouter } from '../../../core/typescript/src/index.js'
import { greetRouter } from '../../../core/typescript/__tests__/fixtures.js'
import { seam } from '../src/index.js'
import { sharedRpcTests } from '../../__tests__/shared-adapter-tests.js'

const app = new Hono()
app.use('/*', seam(greetRouter))
app.get('/hello', (c) => c.text('world'))

const fetchFn = (path: string, init?: RequestInit) => app.request(path, init)
const shared = sharedRpcTests(fetchFn, expect)

describe('adapter-hono', () => {
	it('GET /_seam/manifest.json returns manifest', shared.manifest)
	it('POST /_seam/procedure/greet with valid input returns 200', shared.rpcValid)
	it('POST /_seam/procedure/greet with invalid input returns 400', shared.rpcInvalid)
	it('POST /_seam/procedure/unknown returns 404', shared.unknownProcedure)
	it('POST non-JSON body returns 400', shared.nonJsonBody)
	it('POST /_seam/procedure/updateName (command) returns 200', shared.command)

	it('non-/_seam/ route passes through to next middleware', async () => {
		const res = await app.request('/hello')
		expect(res.status).toBe(200)
		const text = await res.text()
		expect(text).toBe('world')
	})

	it('serves router publicDir without explicit adapter option', async () => {
		const publicDir = mkdtempSync(join(tmpdir(), 'seam-hono-public-'))
		try {
			mkdirSync(join(publicDir, 'images'), { recursive: true })
			writeFileSync(join(publicDir, 'images/logo.png'), 'png')

			const app = new Hono()
			const router = createRouter(greetRouter.procedures, { publicDir })
			app.use('/*', seam(router))

			const res = await app.request('/images/logo.png')
			expect(res.status).toBe(200)
			expect(await res.text()).toBe('png')
		} finally {
			rmSync(publicDir, { recursive: true, force: true })
		}
	})
})

describe('adapter-hono subscription', () => {
	it('subscription returns SSE events', shared.subscriptionEvents)
	it('unknown subscription returns SSE error', shared.unknownSubscription)
})

describe('adapter-hono stream', () => {
	it('stream returns SSE with incrementing ids', shared.streamIncrementingIds)
	it('stream invalid input returns SSE error', shared.streamInvalidInput)
})

describe('adapter-hono upload', () => {
	it('upload multipart returns success', shared.uploadMultipart)
	it('upload without file returns 400', shared.uploadWithoutFile)
})
