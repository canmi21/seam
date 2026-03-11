/* src/router/tanstack/__tests__/lazy-helpers.test.ts */

import { describe, it, expect } from 'vitest'
import { isLazyLoader, collectLeafPaths } from '../src/create-router.js'

describe('isLazyLoader', () => {
	it('returns true for function with __seamLazy flag', () => {
		const loader = Object.assign(() => {}, { __seamLazy: true })
		expect(isLazyLoader(loader)).toBe(true)
	})

	it('returns false for regular function', () => {
		expect(isLazyLoader(() => {})).toBe(false)
	})

	it('returns false for non-function values', () => {
		expect(isLazyLoader(null)).toBe(false)
		expect(isLazyLoader('string')).toBe(false)
		expect(isLazyLoader({})).toBe(false)
	})
})

describe('collectLeafPaths', () => {
	it('collects paths from flat list', () => {
		const result = collectLeafPaths([
			{ path: '/', component: () => null },
			{ path: '/about', component: () => null },
		])
		expect(result).toEqual(['/', '/about'])
	})

	it('collects only leaf paths from nested routes', () => {
		const result = collectLeafPaths([
			{
				path: '/',
				component: () => null,
				children: [
					{ path: '/a', component: () => null },
					{ path: '/b', component: () => null },
				],
			},
		])
		expect(result).toEqual(['/a', '/b'])
	})

	it('includes pathful layout prefixes in collected leaf paths', () => {
		const result = collectLeafPaths([
			{
				path: '/dashboard',
				layout: () => null,
				children: [
					{ path: '/', component: () => null },
					{ path: '/settings', component: () => null },
				],
			},
		])
		expect(result).toEqual(['/dashboard', '/dashboard/settings'])
	})

	it('does not accumulate prefixes for pathless layouts', () => {
		const result = collectLeafPaths([
			{
				path: '',
				layout: () => null,
				children: [{ path: '/settings', component: () => null }],
			},
		])
		expect(result).toEqual(['/settings'])
	})
})
