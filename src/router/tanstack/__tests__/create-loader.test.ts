/* src/router/tanstack/__tests__/create-loader.test.ts */

import { describe, expect, it, vi } from 'vitest'
import { buildInput, createLoaderFromDefs, createPrerenderLoader } from '../src/create-loader.js'
import type { SeamRouterContext } from '../src/types.js'

describe('buildInput()', () => {
	it('maps route params to input', () => {
		const result = buildInput(
			{ procedure: 'getUser', params: { username: { from: 'route' } } },
			{ username: 'octocat' },
		)
		expect(result).toEqual({ username: 'octocat' })
	})

	it('coerces int params', () => {
		const result = buildInput(
			{ procedure: 'getItem', params: { id: { from: 'route', type: 'int' } } },
			{ id: '42' },
		)
		expect(result).toEqual({ id: 42 })
	})

	it('returns empty object when no params defined', () => {
		const result = buildInput({ procedure: 'getHomeData' }, {})
		expect(result).toEqual({})
	})

	it('expands string shorthand to { from: value }', () => {
		const result = buildInput(
			{ procedure: 'getPost', params: { slug: 'route' } },
			{ slug: 'hello-world' },
		)
		expect(result).toEqual({ slug: 'hello-world' })
	})

	it('mixes string shorthand and object params', () => {
		const result = buildInput(
			{ procedure: 'getItem', params: { slug: 'route', id: { from: 'route', type: 'int' } } },
			{ slug: 'foo', id: '7' },
		)
		expect(result).toEqual({ slug: 'foo', id: 7 })
	})
})

describe('createLoaderFromDefs()', () => {
	it('short-circuits on first load using initial data', async () => {
		const initial = {
			path: '/dashboard/:username',
			params: { username: 'octocat' },
			data: { user: { login: 'octocat' }, repos: [] },
			consumed: false,
		}

		const loader = createLoaderFromDefs(
			{
				user: { procedure: 'getUser', params: { username: 'route' } },
				repos: { procedure: 'getUserRepos', params: { username: 'route' } },
			},
			'/dashboard/:username',
		)

		const context: SeamRouterContext = {
			seamRpc: vi.fn(),
			_seamInitial: initial,
		}

		const result = await loader({ params: { username: 'octocat' }, context })

		expect(result).toEqual({ user: { login: 'octocat' }, repos: [] })
		expect(initial.consumed).toBe(true)
		expect(context.seamRpc).not.toHaveBeenCalled()
	})

	it('calls RPC on SPA navigation (after initial consumed)', async () => {
		const mockRpc = vi.fn()
		mockRpc.mockResolvedValueOnce({ login: 'torvalds' })
		mockRpc.mockResolvedValueOnce([{ name: 'linux' }])

		const loader = createLoaderFromDefs(
			{
				user: { procedure: 'getUser', params: { username: { from: 'route' } } },
				repos: { procedure: 'getUserRepos', params: { username: { from: 'route' } } },
			},
			'/dashboard/:username',
		)

		const context: SeamRouterContext = {
			seamRpc: mockRpc,
			_seamInitial: { path: '/', params: {}, data: {}, consumed: true },
		}

		const result = await loader({ params: { username: 'torvalds' }, context })

		expect(result).toEqual({ user: { login: 'torvalds' }, repos: [{ name: 'linux' }] })
		expect(mockRpc).toHaveBeenCalledWith('getUser', { username: 'torvalds' })
		expect(mockRpc).toHaveBeenCalledWith('getUserRepos', { username: 'torvalds' })
	})

	it('calls RPC when no initial data', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ tagline: 'Hello' })

		const loader = createLoaderFromDefs({ page: { procedure: 'getHomeData' } }, '/')

		const context: SeamRouterContext = {
			seamRpc: mockRpc,
			_seamInitial: null,
		}

		const result = await loader({ params: {}, context })

		expect(result).toEqual({ page: { tagline: 'Hello' } })
		expect(mockRpc).toHaveBeenCalledWith('getHomeData', {})
	})

	// -- buildInput error paths --

	it('non-numeric string for int param returns NaN', () => {
		const result = buildInput(
			{ procedure: 'getItem', params: { id: { from: 'route', type: 'int' } } },
			{ id: 'abc' },
		)
		expect(result.id).toBeNaN()
	})

	it('missing param key returns undefined', () => {
		const result = buildInput({ procedure: 'getUser', params: { id: 'route' } }, {})
		expect(result.id).toBeUndefined()
	})

	it('undefined value with int type returns NaN', () => {
		const result = buildInput(
			{ procedure: 'getItem', params: { id: { from: 'route', type: 'int' } } },
			{},
		)
		expect(result.id).toBeNaN()
	})

	// -- createLoaderFromDefs error paths --

	it('RPC rejection propagates error', async () => {
		const mockRpc = vi.fn().mockRejectedValue(new Error('network fail'))
		const loader = createLoaderFromDefs({ data: { procedure: 'getData' } }, '/page')
		const context: SeamRouterContext = { seamRpc: mockRpc, _seamInitial: null }
		await expect(loader({ params: {}, context })).rejects.toThrow('network fail')
	})

	it('multiple loaders one fails rejects all', async () => {
		const mockRpc = vi.fn()
		mockRpc.mockResolvedValueOnce({ ok: true })
		mockRpc.mockRejectedValueOnce(new Error('second fail'))
		const loader = createLoaderFromDefs(
			{ a: { procedure: 'getA' }, b: { procedure: 'getB' } },
			'/page',
		)
		const context: SeamRouterContext = { seamRpc: mockRpc, _seamInitial: null }
		await expect(loader({ params: {}, context })).rejects.toThrow('second fail')
	})

	it('empty loaderDefs returns empty object', async () => {
		const mockRpc = vi.fn()
		const loader = createLoaderFromDefs({}, '/')
		const context: SeamRouterContext = { seamRpc: mockRpc, _seamInitial: null }
		const result = await loader({ params: {}, context })
		expect(result).toEqual({})
		expect(mockRpc).not.toHaveBeenCalled()
	})
})

describe('createPrerenderLoader()', () => {
	it('returns initial data on first load', async () => {
		const loader = createPrerenderLoader('/about')
		const context: SeamRouterContext = {
			seamRpc: vi.fn(),
			_seamInitial: {
				path: '/about',
				params: {},
				data: { team: ['Alice'] },
				layouts: {},
				consumed: false,
				consumedLayouts: new Set(),
			},
		}
		const result = await loader({ params: {}, context })
		expect(result).toEqual({ team: ['Alice'] })
		expect(context._seamInitial?.consumed).toBe(true)
	})

	it('fetches from /_seam/data/ on SPA navigation', async () => {
		const mockData = { team: ['Bob'] }
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockData),
		})

		const loader = createPrerenderLoader('/about')
		const context: SeamRouterContext = {
			seamRpc: vi.fn(),
			_seamInitial: null,
		}
		const result = await loader({ params: {}, context })
		expect(result).toEqual(mockData)
		expect(globalThis.fetch).toHaveBeenCalledWith('/_seam/data/about')
	})

	it('returns empty object when fetch fails', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false })

		const loader = createPrerenderLoader('/pricing')
		const context: SeamRouterContext = {
			seamRpc: vi.fn(),
			_seamInitial: null,
		}
		const result = await loader({ params: {}, context })
		expect(result).toEqual({})
	})
})
