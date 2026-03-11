/* src/router/tanstack/__tests__/create-router-layout-paths.test.ts */

import { afterEach, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { createSeamRouter } from '../src/create-router.js'

function createEnv(href = 'http://localhost/') {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: href })
	Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
	Object.defineProperty(globalThis, 'self', { value: dom.window, configurable: true })
	Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
	Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true })
	return dom
}

function collectFullPaths(router: ReturnType<typeof createSeamRouter>): string[] {
	return Object.values(
		(router as unknown as { routesById: Record<string, { fullPath: string }> }).routesById,
	)
		.map((route) => route.fullPath)
		.sort()
}

function matchPaths(router: ReturnType<typeof createSeamRouter>, to: string): string[] {
	const typedRouter = router as unknown as {
		buildLocation: (opts: { to: string }) => unknown
		matchRoutes: (location: unknown) => Array<{ fullPath: string }>
	}
	return typedRouter.matchRoutes(typedRouter.buildLocation({ to })).map((route) => route.fullPath)
}

function normalizeMatchPaths(paths: string[]): string[] {
	return paths.filter((path, index) => path !== paths[index - 1])
}

describe('createSeamRouter - layout route paths', () => {
	afterEach(() => {
		Reflect.deleteProperty(globalThis, 'window')
		Reflect.deleteProperty(globalThis, 'self')
		Reflect.deleteProperty(globalThis, 'document')
		Reflect.deleteProperty(globalThis, 'location')
	})

	it('matches nested pages under a pathful layout', () => {
		createEnv()
		const router = createSeamRouter({
			routes: [
				{
					path: '/dashboard',
					layout: () => null,
					children: [{ path: '/settings', component: () => null }],
				},
			],
		})

		expect(collectFullPaths(router)).toContain('/dashboard/settings')
		expect(normalizeMatchPaths(matchPaths(router, '/dashboard/settings'))).toEqual([
			'/',
			'/dashboard',
			'/dashboard/settings',
		])
	})

	it('keeps pathless layouts wrapper-only', () => {
		createEnv()
		const router = createSeamRouter({
			routes: [
				{
					path: '',
					layout: () => null,
					children: [{ path: '/settings', component: () => null }],
				},
			],
		})

		expect(collectFullPaths(router)).toContain('/settings')
		expect(normalizeMatchPaths(matchPaths(router, '/settings'))).toEqual(['/', '/settings'])
	})

	it('accumulates prefixes across nested pathful layouts', () => {
		createEnv()
		const router = createSeamRouter({
			routes: [
				{
					path: '/admin',
					layout: () => null,
					children: [
						{
							path: '/users',
							layout: () => null,
							children: [{ path: '/detail', component: () => null }],
						},
					],
				},
			],
		})

		expect(collectFullPaths(router)).toContain('/admin/users/detail')
		expect(normalizeMatchPaths(matchPaths(router, '/admin/users/detail'))).toEqual([
			'/',
			'/admin',
			'/admin/users',
			'/admin/users/detail',
		])
	})

	it('only accumulates prefixes from pathful layout levels in mixed nesting', () => {
		createEnv()
		const router = createSeamRouter({
			routes: [
				{
					path: '/dashboard',
					layout: () => null,
					children: [
						{
							path: '',
							layout: () => null,
							children: [{ path: '/reviews', component: () => null }],
						},
					],
				},
			],
		})

		expect(collectFullPaths(router)).toContain('/dashboard/reviews')
		expect(normalizeMatchPaths(matchPaths(router, '/dashboard/reviews'))).toEqual([
			'/',
			'/dashboard',
			'/dashboard/reviews',
		])
	})
})
