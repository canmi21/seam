/* src/server/core/typescript/__tests__/manifest.test.ts */

import { describe, test, expect } from 'vitest'
import { createRouter, t } from '../src/index.js'

describe('buildManifest', () => {
  test('suppress propagated to manifest', () => {
    const router = createRouter({
      getArchive: {
        input: t.object({}),
        output: t.object({}),
        suppress: ['unused'],
        handler: () => ({}),
      },
    })
    const manifest = router.manifest()
    expect(manifest.procedures.getArchive.suppress).toEqual(['unused'])
  })

  test('no suppress omits field', () => {
    const router = createRouter({
      getUser: {
        input: t.object({}),
        output: t.object({}),
        handler: () => ({}),
      },
    })
    const manifest = router.manifest()
    expect(manifest.procedures.getUser.suppress).toBeUndefined()
  })

  test('cache: { ttl: 30 } propagated to manifest', () => {
    const router = createRouter({
      getUser: {
        input: t.object({}),
        output: t.object({}),
        cache: { ttl: 30 },
        handler: () => ({}),
      },
    })
    const manifest = router.manifest()
    expect(manifest.procedures.getUser.cache).toEqual({ ttl: 30 })
  })

  test('cache: false propagated to manifest', () => {
    const router = createRouter({
      getUser: {
        input: t.object({}),
        output: t.object({}),
        cache: false,
        handler: () => ({}),
      },
    })
    const manifest = router.manifest()
    expect(manifest.procedures.getUser.cache).toBe(false)
  })

  test('no cache field when not declared', () => {
    const router = createRouter({
      getUser: {
        input: t.object({}),
        output: t.object({}),
        handler: () => ({}),
      },
    })
    const manifest = router.manifest()
    expect(manifest.procedures.getUser.cache).toBeUndefined()
  })
})
