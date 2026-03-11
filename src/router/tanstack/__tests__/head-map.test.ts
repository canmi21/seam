/* src/router/tanstack/__tests__/head-map.test.ts */

import { describe, expect, it } from 'vitest'
import { collectHeadMap } from '../src/create-router.js'
import type { RouteDef, HeadConfig } from '@canmi/seam-react'

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

const DummyLayout = (() => null) as unknown as RouteDef['layout']

describe('collectHeadMap - layout propagation', () => {
	it('layout head propagates to children without head', () => {
		const routes: RouteDef[] = [
			{
				path: '/',
				layout: DummyLayout,
				head: { link: [{ rel: 'icon', href: '/favicon.ico' }] },
				children: [
					{ path: '/', component: (() => null) as unknown as RouteDef['component'] },
					{ path: '/about', component: (() => null) as unknown as RouteDef['component'] },
				],
			},
		]
		const map = collectHeadMap(routes)
		expect(map.get('/')).toEqual({ link: [{ rel: 'icon', href: '/favicon.ico' }] })
		expect(map.get('/about')).toEqual({ link: [{ rel: 'icon', href: '/favicon.ico' }] })
	})

	it('layout head merged with child head (child title wins, layout link preserved)', () => {
		const routes: RouteDef[] = [
			{
				path: '/',
				layout: DummyLayout,
				head: {
					title: 'Site',
					link: [{ rel: 'icon', href: '/favicon.ico' }],
				},
				children: [
					{
						path: '/about',
						head: { title: 'About' },
						component: (() => null) as unknown as RouteDef['component'],
					},
				],
			},
		]
		const map = collectHeadMap(routes)
		const about = map.get('/about') as HeadConfig
		expect(about.title).toBe('About')
		expect(about.link).toEqual([{ rel: 'icon', href: '/favicon.ico' }])
	})

	it('nested layouts: inner layout head stacks on outer layout head', () => {
		const routes: RouteDef[] = [
			{
				path: '/',
				layout: DummyLayout,
				head: { link: [{ rel: 'icon', href: '/favicon.ico' }] },
				children: [
					{
						path: '/admin',
						layout: DummyLayout,
						head: { title: 'Admin', link: [{ rel: 'stylesheet', href: '/admin.css' }] },
						children: [
							{
								path: '/users',
								component: (() => null) as unknown as RouteDef['component'],
							},
						],
					},
				],
			},
		]
		const map = collectHeadMap(routes)
		const users = map.get('/admin/users') as HeadConfig
		expect(users.title).toBe('Admin')
		expect(users.link).toEqual([
			{ rel: 'icon', href: '/favicon.ico' },
			{ rel: 'stylesheet', href: '/admin.css' },
		])
	})

	it('child without head inherits full layout head chain', () => {
		const routes: RouteDef[] = [
			{
				path: '/',
				layout: DummyLayout,
				head: {
					title: 'My Site',
					meta: [{ name: 'author', content: 'Test' }],
					link: [{ rel: 'icon', href: '/icon.png' }],
				},
				children: [
					{ path: '/', component: (() => null) as unknown as RouteDef['component'] },
					{ path: '/page', component: (() => null) as unknown as RouteDef['component'] },
				],
			},
		]
		const map = collectHeadMap(routes)
		for (const p of ['/', '/page']) {
			const head = map.get(p) as HeadConfig
			expect(head.title).toBe('My Site')
			expect(head.meta).toEqual([{ name: 'author', content: 'Test' }])
			expect(head.link).toEqual([{ rel: 'icon', href: '/icon.png' }])
		}
	})
})

describe('collectHeadMap - pathful and pathless layout keys', () => {
	it('pathless inner layout does not change inherited head keys', () => {
		const routes: RouteDef[] = [
			{
				path: '/dashboard',
				layout: DummyLayout,
				head: { title: 'Dashboard' },
				children: [
					{
						path: '',
						layout: DummyLayout,
						head: { link: [{ rel: 'stylesheet', href: '/panel.css' }] },
						children: [
							{
								path: '/settings',
								component: (() => null) as unknown as RouteDef['component'],
							},
						],
					},
				],
			},
		]
		const map = collectHeadMap(routes)
		const settings = map.get('/dashboard/settings') as HeadConfig
		expect(settings.title).toBe('Dashboard')
		expect(settings.link).toEqual([{ rel: 'stylesheet', href: '/panel.css' }])
	})
})
