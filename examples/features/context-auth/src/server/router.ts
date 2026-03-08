/* examples/features/context-auth/src/server/router.ts */

import { createRouter, extract, t } from '@canmi/seam-server'
import type { RouterOptions } from '@canmi/seam-server'
import { getPublicInfo, getSecretData, updateProfile } from './procedures.js'

export const procedures = { getPublicInfo, getSecretData, updateProfile }

export function buildRouter(opts?: RouterOptions) {
	return createRouter(procedures, {
		...opts,
		context: {
			auth: {
				extract: extract.header('authorization'),
				schema: t.object({ userId: t.string(), role: t.string() }),
			},
		},
	})
}

export const router = buildRouter()
