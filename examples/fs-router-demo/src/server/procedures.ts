/* examples/fs-router-demo/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { QueryDef } from '@canmi/seam-server'

export const getPageData: QueryDef = {
	input: t.object({}),
	output: t.object({
		title: t.string(),
		description: t.string(),
	}),
	handler: () => ({
		title: 'FS Router Demo',
		description: 'Filesystem-based routing for SeamJS',
	}),
}

export const getBlogPost: QueryDef = {
	input: t.object({ slug: t.string() }),
	output: t.object({
		title: t.string(),
		content: t.string(),
		author: t.string(),
	}),
	handler: ({ input }) => {
		const { slug } = input as { slug: string }
		return {
			title: `Post: ${slug}`,
			content: `Content for ${slug}`,
			author: 'Demo Author',
		}
	},
}

export const getSession: QueryDef = {
	input: t.object({}),
	output: t.object({
		username: t.string(),
	}),
	handler: () => ({
		username: 'visitor',
	}),
}
