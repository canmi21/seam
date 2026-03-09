/* src/query/seam/src/__tests__/mutation-options.test.ts */

import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { createSeamMutationOptions, invalidateFromConfig } from '../mutation-options.js'
import type { ProcedureConfigEntry } from '../types.js'

describe('invalidateFromConfig', () => {
	it('does nothing when no invalidates', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries')
		invalidateFromConfig(qc, { kind: 'command' })
		expect(spy).not.toHaveBeenCalled()
	})

	it('invalidates by query name without mapping', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getPost' }, { query: 'listPosts' }],
		}
		invalidateFromConfig(qc, config)
		expect(spy).toHaveBeenCalledTimes(2)
		expect(spy).toHaveBeenCalledWith({ queryKey: ['getPost'] })
		expect(spy).toHaveBeenCalledWith({ queryKey: ['listPosts'] })
	})

	it('invalidates with precise mapping', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [
				{
					query: 'listPosts',
					mapping: { authorId: { from: 'userId' } },
				},
			],
		}
		invalidateFromConfig(qc, config, { userId: 'u1' })
		expect(spy).toHaveBeenCalledWith({
			queryKey: ['listPosts', { authorId: 'u1' }],
		})
	})

	it('handles each mapping by invalidating per item', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [
				{
					query: 'getUser',
					mapping: { userId: { from: 'userIds', each: true } },
				},
			],
		}
		invalidateFromConfig(qc, config, { userIds: ['a', 'b'] })
		expect(spy).toHaveBeenCalledTimes(2)
		expect(spy).toHaveBeenCalledWith({ queryKey: ['getUser', { userId: 'a' }] })
		expect(spy).toHaveBeenCalledWith({ queryKey: ['getUser', { userId: 'b' }] })
	})

	it('handles undefined config gracefully', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries')
		invalidateFromConfig(qc, undefined)
		expect(spy).not.toHaveBeenCalled()
	})
})

describe('invalidateFromConfig boundary cases', () => {
	it('does nothing with empty invalidates array', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries')
		invalidateFromConfig(qc, { kind: 'command', invalidates: [] })
		expect(spy).not.toHaveBeenCalled()
	})

	it('maps missing source key to undefined', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getPost', mapping: { postId: { from: 'id' } } }],
		}
		invalidateFromConfig(qc, config, { name: 'hello' })
		expect(spy).toHaveBeenCalledWith({
			queryKey: ['getPost', { postId: undefined }],
		})
	})

	it('skips each mapping when value is not array', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getUser', mapping: { userId: { from: 'ids', each: true } } }],
		}
		invalidateFromConfig(qc, config, { ids: 'not-an-array' })
		invalidateFromConfig(qc, config, { ids: null })
		invalidateFromConfig(qc, config, { ids: 42 })
		expect(spy).not.toHaveBeenCalled()
	})

	it('does nothing when each mapping value is empty array', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getUser', mapping: { userId: { from: 'ids', each: true } } }],
		}
		invalidateFromConfig(qc, config, { ids: [] })
		expect(spy).not.toHaveBeenCalled()
	})

	it('iterates multiple each fields additively', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [
				{
					query: 'getItem',
					mapping: {
						tagId: { from: 'tags', each: true },
						catId: { from: 'cats', each: true },
					},
				},
			],
		}
		invalidateFromConfig(qc, config, { tags: [1, 2, 3], cats: [4, 5] })
		// 3 from tags + 2 from cats = 5 (additive, not 6 cartesian)
		expect(spy).toHaveBeenCalledTimes(5)
	})

	it('handles null input with mapping', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getPost', mapping: { postId: { from: 'id' } } }],
		}
		invalidateFromConfig(qc, config, null)
		expect(spy).toHaveBeenCalledWith({
			queryKey: ['getPost', { postId: undefined }],
		})
	})

	it('handles undefined input with mapping', () => {
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getPost', mapping: { postId: { from: 'id' } } }],
		}
		invalidateFromConfig(qc, config, undefined)
		expect(spy).toHaveBeenCalledWith({
			queryKey: ['getPost', { postId: undefined }],
		})
	})
})

describe('createSeamMutationOptions', () => {
	it('mutationFn calls rpcFn', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ ok: true })
		const qc = new QueryClient()
		const opts = createSeamMutationOptions(mockRpc, 'updatePost', qc)
		const result = await opts.mutationFn?.({ postId: '1' }, {} as never)
		expect(mockRpc).toHaveBeenCalledWith('updatePost', { postId: '1' })
		expect(result).toEqual({ ok: true })
	})

	it('onSuccess triggers invalidation', () => {
		const mockRpc = vi.fn().mockResolvedValue({})
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const config: ProcedureConfigEntry = {
			kind: 'command',
			invalidates: [{ query: 'getPost' }],
		}
		const opts = createSeamMutationOptions(mockRpc, 'updatePost', qc, config)
		opts.onSuccess?.({}, { postId: '1' }, {}, {} as never)
		expect(spy).toHaveBeenCalledWith({ queryKey: ['getPost'] })
	})

	it('sets mutationKey', () => {
		const mockRpc = vi.fn()
		const qc = new QueryClient()
		const opts = createSeamMutationOptions(mockRpc, 'deleteUser', qc)
		expect(opts.mutationKey).toEqual(['deleteUser'])
	})
})
