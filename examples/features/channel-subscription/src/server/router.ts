/* examples/features/channel-subscription/src/server/router.ts */

import { createRouter } from '@canmi/seam-server'
import type { RouterOptions } from '@canmi/seam-server'
import { getInfo, onTick, onLongTick } from './procedures.js'
import { echo } from './channels/echo.js'

export const procedures = { getInfo, onTick, onLongTick, ...echo.procedures }

export function buildRouter(opts?: RouterOptions) {
	return createRouter(procedures, { ...opts, channels: [echo] })
}

export const router = buildRouter()
