/* src/query/seam/src/__tests__/query-options.test.ts */

import { describe, expect, it, vi } from 'vitest'
import { createSeamQueryOptions, resolveStaleTime } from '../query-options.js'
import type { ProcedureConfigEntry } from '../types.js'

describe('resolveStaleTime', () => {
  it('returns undefined when no config and no overrides', () => {
    expect(resolveStaleTime(undefined)).toBeUndefined()
  })

  it('returns ttl * 1000 from cache config', () => {
    const config: ProcedureConfigEntry = { kind: 'query', cache: { ttl: 30 } }
    expect(resolveStaleTime(config)).toBe(30000)
  })

  it('returns 0 when cache is false', () => {
    const config: ProcedureConfigEntry = { kind: 'query', cache: false }
    expect(resolveStaleTime(config)).toBe(0)
  })

  it('overrides take precedence over config', () => {
    const config: ProcedureConfigEntry = { kind: 'query', cache: { ttl: 30 } }
    expect(resolveStaleTime(config, { staleTime: 5000 })).toBe(5000)
  })

  it('returns undefined when config has no cache field', () => {
    const config: ProcedureConfigEntry = { kind: 'query' }
    expect(resolveStaleTime(config)).toBeUndefined()
  })
})

describe('createSeamQueryOptions', () => {
  const mockRpc = vi.fn().mockResolvedValue({ name: 'test' })

  it('produces correct queryKey', () => {
    const opts = createSeamQueryOptions(mockRpc, 'getUser', { id: '1' })
    expect(opts.queryKey).toEqual(['getUser', { id: '1' }])
  })

  it('queryFn calls rpcFn with correct args', async () => {
    const opts = createSeamQueryOptions(mockRpc, 'getUser', { id: '1' })
    await opts.queryFn?.({} as never)
    expect(mockRpc).toHaveBeenCalledWith('getUser', { id: '1' })
  })

  it('maps cache hint to staleTime', () => {
    const config: ProcedureConfigEntry = { kind: 'query', cache: { ttl: 60 } }
    const opts = createSeamQueryOptions(mockRpc, 'getUser', {}, config)
    expect(opts.staleTime).toBe(60000)
  })

  it('omits staleTime when no cache config', () => {
    const opts = createSeamQueryOptions(mockRpc, 'getUser', {})
    expect(opts).not.toHaveProperty('staleTime')
  })

  it('applies gcTime from overrides', () => {
    const opts = createSeamQueryOptions(mockRpc, 'getUser', {}, undefined, {
      gcTime: 120000,
    })
    expect(opts.gcTime).toBe(120000)
  })
})
