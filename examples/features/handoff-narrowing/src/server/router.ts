/* examples/features/handoff-narrowing/src/server/router.ts */

import { createRouter } from '@canmi/seam-server'
import type { RouterOptions } from '@canmi/seam-server'
import { getUserProfile, getUserTheme } from './procedures.js'

export const procedures = { getUserProfile, getUserTheme }

export function buildRouter(opts?: RouterOptions) {
	return createRouter(procedures, opts)
}

export const router = buildRouter()
