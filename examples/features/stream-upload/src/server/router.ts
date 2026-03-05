/* examples/features/stream-upload/src/server/router.ts */

import { createRouter } from '@canmi/seam-server'
import type { RouterOptions } from '@canmi/seam-server'
import { getInfo, countStream, echoUpload } from './procedures.js'

export const procedures = { getInfo, countStream, echoUpload }

export function buildRouter(opts?: RouterOptions) {
  return createRouter(procedures, opts)
}

export const router = buildRouter()
