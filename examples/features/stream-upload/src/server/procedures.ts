/* examples/features/stream-upload/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { ProcedureDef, StreamDef, UploadDef } from '@canmi/seam-server'

export const getInfo: ProcedureDef<Record<string, never>, { title: string }> = {
  input: t.object({}),
  output: t.object({ title: t.string() }),
  handler: () => ({ title: 'Stream & Upload Demo' }),
}

export const countStream: StreamDef<{ max: number }, { n: number }> = {
  kind: 'stream',
  input: t.object({ max: t.int32() }),
  output: t.object({ n: t.int32() }),
  async *handler({ input }) {
    for (let i = 0; i < input.max; i++) {
      await new Promise((r) => {
        setTimeout(r, 500)
      })
      yield { n: i }
    }
  },
}

export const echoUpload: UploadDef<
  { filename: string },
  { fileId: string; filename: string; size: number }
> = {
  kind: 'upload',
  input: t.object({ filename: t.string() }),
  output: t.object({
    fileId: t.string(),
    filename: t.string(),
    size: t.int32(),
  }),
  async handler({ input, file }) {
    let size = 0
    const reader = file.stream().getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
    }
    return {
      fileId: crypto.randomUUID(),
      filename: input.filename,
      size,
    }
  },
}
