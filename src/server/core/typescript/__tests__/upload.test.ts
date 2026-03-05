/* src/server/core/typescript/__tests__/upload.test.ts */

import { describe, expect, it } from 'vitest'
import { createRouter, t, createHttpHandler } from '../src/index.js'
import type { UploadDef, SeamFileHandle, HttpBodyResponse, CommandDef } from '../src/index.js'

function mockFile(content: string): SeamFileHandle {
  const encoder = new TextEncoder()
  return {
    stream: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(content))
          controller.close()
        },
      }),
  }
}

const router = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
  uploadVideo: {
    kind: 'upload',
    input: t.object({ title: t.string() }),
    output: t.object({ videoId: t.string() }),
    handler: ({ input, file }) => {
      // Verify file is accessible
      const _ = file.stream()
      return { videoId: `v-${input.title}` }
    },
  } satisfies UploadDef<{ title: string }, { videoId: string }>,
})

describe('router.handleUpload', () => {
  it('returns success for valid input and file', async () => {
    const file = mockFile('video-data')
    const result = await router.handleUpload('uploadVideo', { title: 'Test' }, file)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, data: { videoId: 'v-Test' } })
  })

  it('returns 400 for invalid input', async () => {
    const file = mockFile('data')
    const result = await router.handleUpload('uploadVideo', { wrong: 'field' }, file)
    expect(result.status).toBe(400)
    const body = result.body as { ok: false; error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 404 for unknown procedure', async () => {
    const file = mockFile('data')
    const result = await router.handleUpload('unknown', {}, file)
    expect(result.status).toBe(404)
    const body = result.body as { ok: false; error: { code: string } }
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('catches handler errors', async () => {
    const errorRouter = createRouter({
      failUpload: {
        kind: 'upload',
        input: t.object({}),
        output: t.object({ ok: t.boolean() }),
        handler: () => {
          throw new Error('upload broke')
        },
      } satisfies UploadDef<Record<string, never>, { ok: boolean }>,
    })
    const file = mockFile('data')
    const result = await errorRouter.handleUpload('failUpload', {}, file)
    expect(result.status).toBe(500)
    const body = result.body as { ok: false; error: { code: string; message: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('upload broke')
  })
})

describe('router.getKind for upload', () => {
  it('returns upload for upload procedure', () => {
    expect(router.getKind('uploadVideo')).toBe('upload')
  })

  it('returns query for non-upload procedure', () => {
    expect(router.getKind('greet')).toBe('query')
  })
})

describe('manifest kind for upload', () => {
  it('includes kind: upload in manifest', () => {
    const manifest = router.manifest()
    expect(manifest.procedures.uploadVideo.kind).toBe('upload')
  })

  it('uses output (not chunkOutput) for upload', () => {
    const manifest = router.manifest()
    expect(manifest.procedures.uploadVideo.output).toBeDefined()
    expect(manifest.procedures.uploadVideo.chunkOutput).toBeUndefined()
  })
})

describe('upload HTTP handler', () => {
  const handler = createHttpHandler(router)

  it('returns 400 when file is not provided (no multipart)', async () => {
    const res = await handler({
      method: 'POST',
      url: 'http://localhost/_seam/procedure/uploadVideo',
      body: () => Promise.resolve({ title: 'Test' }),
    })
    expect(res.status).toBe(400)
    const body = (res as HttpBodyResponse).body as { ok: false; error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when file() returns null', async () => {
    const res = await handler({
      method: 'POST',
      url: 'http://localhost/_seam/procedure/uploadVideo',
      body: () => Promise.resolve({ title: 'Test' }),
      file: () => Promise.resolve(null),
    })
    expect(res.status).toBe(400)
    const body = (res as HttpBodyResponse).body as { ok: false; error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns JSON success when file is provided', async () => {
    const file = mockFile('video-data')
    const res = await handler({
      method: 'POST',
      url: 'http://localhost/_seam/procedure/uploadVideo',
      body: () => Promise.resolve({ title: 'Demo' }),
      file: () => Promise.resolve(file),
    })
    expect(res.status).toBe(200)
    const body = (res as HttpBodyResponse).body as { ok: true; data: { videoId: string } }
    expect(body.data.videoId).toBe('v-Demo')
  })

  it('non-upload procedures still work without file', async () => {
    const res = await handler({
      method: 'POST',
      url: 'http://localhost/_seam/procedure/greet',
      body: () => Promise.resolve({ name: 'Alice' }),
    })
    expect(res.status).toBe(200)
    const body = (res as HttpBodyResponse).body as { ok: true; data: { message: string } }
    expect(body.data.message).toBe('Hello, Alice!')
  })
})

describe('manifest invalidates', () => {
  it('normalizes shorthand to full form', () => {
    const r = createRouter({
      getPost: {
        input: t.object({ postId: t.string() }),
        output: t.object({ title: t.string() }),
        handler: ({ input }) => ({ title: `Post ${input.postId}` }),
      },
      updatePost: {
        kind: 'command',
        input: t.object({ postId: t.string(), title: t.string() }),
        output: t.object({ ok: t.boolean() }),
        invalidates: ['getPost'],
        handler: () => ({ ok: true }),
      } satisfies CommandDef<{ postId: string; title: string }, { ok: boolean }>,
    })
    const manifest = r.manifest()
    expect(manifest.procedures.updatePost.invalidates).toEqual([{ query: 'getPost' }])
  })

  it('normalizes full form with mapping value shorthand', () => {
    const r = createRouter({
      getPost: {
        input: t.object({ postId: t.string() }),
        output: t.object({ title: t.string() }),
        handler: ({ input }) => ({ title: `Post ${input.postId}` }),
      },
      updatePost: {
        kind: 'command',
        input: t.object({ postId: t.string(), title: t.string() }),
        output: t.object({ ok: t.boolean() }),
        invalidates: [{ query: 'getPost', mapping: { postId: 'postId' } }],
        handler: () => ({ ok: true }),
      } satisfies CommandDef<{ postId: string; title: string }, { ok: boolean }>,
    })
    const manifest = r.manifest()
    expect(manifest.procedures.updatePost.invalidates).toEqual([
      { query: 'getPost', mapping: { postId: { from: 'postId' } } },
    ])
  })

  it('preserves each flag in mapping', () => {
    const r = createRouter({
      getUser: {
        input: t.object({ userId: t.string() }),
        output: t.object({ name: t.string() }),
        handler: () => ({ name: 'test' }),
      },
      bulkUpdate: {
        kind: 'command',
        input: t.object({ userIds: t.array(t.string()) }),
        output: t.object({ ok: t.boolean() }),
        invalidates: [{ query: 'getUser', mapping: { userId: { from: 'userIds', each: true } } }],
        handler: () => ({ ok: true }),
      } satisfies CommandDef<{ userIds: string[] }, { ok: boolean }>,
    })
    const manifest = r.manifest()
    expect(manifest.procedures.bulkUpdate.invalidates).toEqual([
      { query: 'getUser', mapping: { userId: { from: 'userIds', each: true } } },
    ])
  })

  it('omits invalidates for command without declaration', () => {
    const r = createRouter({
      deleteUser: {
        kind: 'command',
        input: t.object({ userId: t.string() }),
        output: t.object({ ok: t.boolean() }),
        handler: () => ({ ok: true }),
      } satisfies CommandDef<{ userId: string }, { ok: boolean }>,
    })
    const manifest = r.manifest()
    expect(manifest.procedures.deleteUser.invalidates).toBeUndefined()
  })

  it('does not output invalidates for query definitions', () => {
    const r = createRouter({
      getPost: {
        input: t.object({ postId: t.string() }),
        output: t.object({ title: t.string() }),
        handler: ({ input }) => ({ title: `Post ${input.postId}` }),
      },
    })
    const manifest = r.manifest()
    expect(manifest.procedures.getPost.invalidates).toBeUndefined()
  })
})
