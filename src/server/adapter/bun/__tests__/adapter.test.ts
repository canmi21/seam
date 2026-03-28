/* src/server/adapter/bun/__tests__/adapter.test.ts */

import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { greetRouter as router } from '../../../core/typescript/__tests__/fixtures.js'
import { serveBun } from '../src/index.js'
import { sharedRpcTests } from '../../__tests__/shared-adapter-tests.js'

const server = serveBun(router, { port: 0 })
const base = `http://localhost:${server.port}`

afterAll(() => {
	server.stop()
})

const fetchFn = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init)
const shared = sharedRpcTests(fetchFn, expect)

describe('adapter-bun', () => {
	it('GET /_seam/manifest.json returns manifest', shared.manifest)
	it('POST /_seam/procedure/greet with valid input returns 200', shared.rpcValid)
	it('POST /_seam/procedure/greet with invalid input returns 400', shared.rpcInvalid)
	it('POST /_seam/procedure/unknown returns 404', shared.unknownProcedure)
	it('POST non-JSON body returns 400', shared.nonJsonBody)
	it('POST /_seam/procedure/updateName (command) returns 200', shared.command)

	it('unknown route returns 404', async () => {
		const res = await fetch(`${base}/unknown`)
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.ok).toBe(false)
		expect(body.error.code).toBe('NOT_FOUND')
	})

	it('empty procedure name returns 404', async () => {
		const res = await fetch(`${base}/_seam/procedure/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.ok).toBe(false)
		expect(body.error.code).toBe('NOT_FOUND')
	})
})

describe('adapter-bun subscription', () => {
	it('subscription returns SSE events', shared.subscriptionEvents)
	it('unknown subscription returns SSE error', shared.unknownSubscription)
})

describe('adapter-bun stream', () => {
	it('stream returns SSE with incrementing ids', shared.streamIncrementingIds)
	it('stream invalid input returns SSE error', shared.streamInvalidInput)
})

describe('adapter-bun upload', () => {
	it('upload multipart returns success', shared.uploadMultipart)
	it('upload without file returns 400', shared.uploadWithoutFile)
})

describe('adapter-bun staticDir', () => {
	let staticDir: string
	let staticServer: ReturnType<typeof serveBun>
	let staticBase: string

	afterAll(() => {
		staticServer.stop()
		rmSync(staticDir, { recursive: true, force: true })
	})

	it('serves static files through adapter', async () => {
		staticDir = mkdtempSync(join(tmpdir(), 'seam-bun-static-'))
		writeFileSync(join(staticDir, 'app-abc.js'), "console.log('app')")

		staticServer = serveBun(router, { port: 0, staticDir })
		staticBase = `http://localhost:${staticServer.port}`

		const res = await fetch(`${staticBase}/_seam/static/app-abc.js`)
		expect(res.status).toBe(200)
		const text = await res.text()
		expect(text).toBe("console.log('app')")
		expect(res.headers.get('Content-Type')).toBe('application/javascript')
	})
})
