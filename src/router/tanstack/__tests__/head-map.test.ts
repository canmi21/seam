/* src/router/tanstack/__tests__/head-map.test.ts */

import { describe, expect, it } from 'vitest'
import { collectHeadMap } from '../src/create-router.js'
import type { RouteDef } from '@canmi/seam-react'

describe('collectHeadMap', () => {
	it('collects head from flat routes', () => {
		const routes: RouteDef[] = [
			{ path: '/', head: { title: 'Home' } },
			{ path: '/about', head: { title: 'About' } },
			{ path: '/contact' },
		]
		const map = collectHeadMap(routes)
		expect(map.size).toBe(2)
		expect(map.get('/')).toEqual({ title: 'Home' })
		expect(map.get('/about')).toEqual({ title: 'About' })
	})

	it('collects head from nested routes (grouping)', () => {
		const routes: RouteDef[] = [
			{
				path: '/blog',
				children: [
					{ path: '/', head: { title: 'Blog Index' } },
					{ path: '/:slug', head: (data) => ({ title: `${data.title}` }) },
				],
			},
		]
		const map = collectHeadMap(routes)
		expect(map.size).toBe(2)
		expect(map.get('/blog')).toEqual({ title: 'Blog Index' })
		expect(map.has('/blog/:slug')).toBe(true)
	})

	it('returns empty map when no head definitions', () => {
		const routes: RouteDef[] = [{ path: '/' }, { path: '/about' }]
		const map = collectHeadMap(routes)
		expect(map.size).toBe(0)
	})
})
