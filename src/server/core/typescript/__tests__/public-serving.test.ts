/* src/server/core/typescript/__tests__/public-serving.test.ts */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRouter, t, createHttpHandler } from '../src/index.js'

const router = createRouter({
	greet: {
		input: t.object({ name: t.string() }),
		output: t.object({ message: t.string() }),
		handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
	},
})

let publicDir: string

beforeAll(() => {
	publicDir = mkdtempSync(join(tmpdir(), 'seam-public-test-'))
	mkdirSync(join(publicDir, 'images'), { recursive: true })
	writeFileSync(join(publicDir, 'favicon.svg'), '<svg/>')
	writeFileSync(join(publicDir, 'robots.txt'), 'User-agent: *')
	writeFileSync(join(publicDir, 'manifest.webmanifest'), '{}')
	writeFileSync(join(publicDir, 'images/logo.png'), 'fake png')
})

afterAll(() => {
	rmSync(publicDir, { recursive: true, force: true })
})

function makeHandler(opts?: { withPublic?: boolean; withFallback?: boolean }) {
	return createHttpHandler(router, {
		publicDir: opts?.withPublic !== false ? publicDir : undefined,
		fallback: opts?.withFallback
			? async () => ({ status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html/>' })
			: undefined,
	})
}

function req(handler: ReturnType<typeof makeHandler>, method: string, url: string) {
	return handler({
		method,
		url: `http://localhost${url}`,
		body: () => Promise.reject(new Error('no body')),
	})
}

describe('public file serving', () => {
	it('serves files at root path with correct MIME type', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/favicon.svg')
		expect(res.status).toBe(200)
		expect(res.headers['Content-Type']).toBe('image/svg+xml')
		expect(res.headers['Cache-Control']).toBe('public, max-age=3600')
	})

	it('serves text files', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/robots.txt')
		expect(res.status).toBe(200)
		expect(res.headers['Content-Type']).toBe('text/plain')
	})

	it('serves webmanifest files', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/manifest.webmanifest')
		expect(res.status).toBe(200)
		expect(res.headers['Content-Type']).toBe('application/manifest+json')
	})

	it('serves nested files', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/images/logo.png')
		expect(res.status).toBe(200)
		expect(res.headers['Content-Type']).toBe('image/png')
	})

	it('returns 404 when file not found (no fallback)', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/nonexistent.txt')
		expect(res.status).toBe(404)
	})

	it('falls through to fallback when file not found', async () => {
		const handler = makeHandler({ withFallback: true })
		const res = await req(handler, 'GET', '/nonexistent-page')
		expect(res.status).toBe(200)
		expect(res.body).toBe('<html/>')
	})

	it('blocks path traversal', async () => {
		const handler = makeHandler()
		const res = await handler({
			method: 'GET',
			url: 'http://localhost/..%2F..%2Fetc/passwd',
			body: () => Promise.reject(new Error('no body')),
		})
		// ".." in decoded pathname -> handlePublicFile returns null -> 404
		expect(res.status).toBe(404)
	})

	it('does not use immutable cache', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/favicon.svg')
		expect(res.headers['Cache-Control']).not.toContain('immutable')
	})

	it('/_seam/* routes take priority over public files', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'GET', '/_seam/manifest.json')
		expect(res.status).toBe(200)
		const body = res.body as { version: number }
		expect(body.version).toBe(2)
	})

	it('does not interfere when publicDir is not set', async () => {
		const handler = makeHandler({ withPublic: false })
		const res = await req(handler, 'GET', '/favicon.svg')
		expect(res.status).toBe(404)
	})

	it('ignores POST requests', async () => {
		const handler = makeHandler()
		const res = await req(handler, 'POST', '/favicon.svg')
		expect(res.status).toBe(404)
	})
})
