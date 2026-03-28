/* src/server/adapter/node/__tests__/adapter.test.ts */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { greetRouter as router } from '../../../core/typescript/__tests__/fixtures.js'
import { serveNode } from '../src/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { sharedRpcTests } from '../../__tests__/shared-adapter-tests.js'

let server: Server
let base: string
let shared: ReturnType<typeof sharedRpcTests>

beforeAll(async () => {
	server = serveNode(router, { port: 0 })
	await new Promise<void>((r) => {
		if (server.listening) {
			r()
		} else {
			server.once('listening', r)
		}
	})
	const addr = server.address() as AddressInfo
	base = `http://localhost:${addr.port}`
	shared = sharedRpcTests((path, init) => fetch(`${base}${path}`, init), expect)
})

afterAll(() => {
	server.close()
})

describe('adapter-node', () => {
	it('GET /_seam/manifest.json returns manifest', () => shared.manifest())
	it('POST /_seam/procedure/greet with valid input returns 200', () => shared.rpcValid())
	it('POST /_seam/procedure/greet with invalid input returns 400', () => shared.rpcInvalid())
	it('POST /_seam/procedure/unknown returns 404', () => shared.unknownProcedure())
	it('POST non-JSON body returns 400', () => shared.nonJsonBody())
	it('POST /_seam/procedure/updateName (command) returns 200', () => shared.command())

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

describe('adapter-node subscription', () => {
	it('subscription returns SSE events', () => shared.subscriptionEvents())
	it('unknown subscription returns SSE error', () => shared.unknownSubscription())
})

describe('adapter-node stream', () => {
	it('stream returns SSE with incrementing ids', () => shared.streamIncrementingIds())
	it('stream invalid input returns SSE error', () => shared.streamInvalidInput())
})

// Node adapter does not support multipart uploads — skip upload tests

describe('adapter-node publicDir', () => {
	let pubServer: Server
	let pubBase: string
	let pubDir: string

	beforeAll(async () => {
		pubDir = mkdtempSync(join(tmpdir(), 'seam-node-public-'))
		writeFileSync(join(pubDir, 'hello.txt'), 'hello world')
		mkdirSync(join(pubDir, 'images'), { recursive: true })
		writeFileSync(join(pubDir, 'images', 'logo.png'), 'fake-png-data')

		pubServer = serveNode(router, { port: 0, publicDir: pubDir })
		await new Promise<void>((r) => {
			if (pubServer.listening) {
				r()
			} else {
				pubServer.once('listening', r)
			}
		})
		const addr = pubServer.address() as AddressInfo
		pubBase = `http://localhost:${addr.port}`
	})

	afterAll(() => {
		pubServer.close()
		rmSync(pubDir, { recursive: true, force: true })
	})

	it('serves existing public file', async () => {
		const res = await fetch(`${pubBase}/hello.txt`)
		expect(res.status).toBe(200)
		const body = await res.text()
		expect(body).toBe('hello world')
	})

	it('serves nested public file', async () => {
		const res = await fetch(`${pubBase}/images/logo.png`)
		expect(res.status).toBe(200)
	})

	it('blocks path traversal', async () => {
		const res = await fetch(`${pubBase}/../etc/passwd`)
		expect(res.status).toBe(404)
	})
})
