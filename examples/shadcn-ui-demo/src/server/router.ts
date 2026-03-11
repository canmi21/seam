/* examples/shadcn-ui-demo/src/server/router.ts */

import { createRouter, t } from '@canmi/seam-server'
import type { QueryDef, RouterOptions } from '@canmi/seam-server'

const getShowcaseIntro: QueryDef = {
	input: t.object({}),
	output: t.object({
		title: t.string(),
		subtitle: t.string(),
	}),
	handler: () => ({
		title: 'Tailwind CSS v4 + shadcn/ui on Seam CTR',
		subtitle: 'Portal primitives match SSR semantics and hydrate into full interaction.',
	}),
}

export const procedures = { getShowcaseIntro }

export function buildRouter(opts?: RouterOptions) {
	return createRouter(procedures, opts)
}

export const router = buildRouter()
