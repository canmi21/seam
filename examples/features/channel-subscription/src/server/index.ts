/* examples/features/channel-subscription/src/server/index.ts */

import { resolve } from 'node:path'
import { loadBuild, loadBuildDev } from '@canmi/seam-server'
import { serveBun } from '@canmi/seam-adapter-bun'
import { buildRouter } from './router.js'

const isDev = process.env.SEAM_DEV === '1'
const outputDir = process.env.SEAM_OUTPUT_DIR
if (isDev && !outputDir) throw new Error('SEAM_OUTPUT_DIR is required in dev mode')
const BUILD_DIR = isDev ? (outputDir as string) : resolve(import.meta.dir, '..')
const build = isDev ? loadBuildDev(BUILD_DIR) : loadBuild(BUILD_DIR)
const router = buildRouter(build)

const port = Number(process.env.PORT) || 3484
serveBun(router, {
	port,
	staticDir: resolve(BUILD_DIR, 'public'),
	// createHttpHandler only serves pages at /_seam/page/* prefix;
	// root-path serving needs a fallback
	fallback: async (req) => {
		const url = new URL(req.url, 'http://localhost')
		const result = await router.handlePage(url.pathname)
		if (result) {
			return {
				status: result.status,
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
				body: result.html,
			}
		}
		return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not Found' }
	},
})
console.log(`Channel & Subscription Demo running on http://localhost:${port}`)
