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

describe('createSeamMutationOptions', () => {
  it('mutationFn calls rpcFn', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ ok: true })
    const qc = new QueryClient()
    const opts = createSeamMutationOptions(mockRpc, 'updatePost', qc)
    const result = await opts.mutationFn?.({ postId: '1' })
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
    opts.onSuccess?.({}, { postId: '1' }, {})
    expect(spy).toHaveBeenCalledWith({ queryKey: ['getPost'] })
  })

  it('sets mutationKey', () => {
    const mockRpc = vi.fn()
    const qc = new QueryClient()
    const opts = createSeamMutationOptions(mockRpc, 'deleteUser', qc)
    expect(opts.mutationKey).toEqual(['deleteUser'])
  })
})
