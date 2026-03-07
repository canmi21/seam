/* examples/features/context-auth/src/server/index.ts */

import { resolve } from 'node:path'
import { Hono } from 'hono'
import { loadBuild, loadBuildDev } from '@canmi/seam-server'
import { seam } from '@canmi/seam-adapter-hono'
import { buildRouter } from './router.js'

const isDev = process.env.SEAM_DEV === '1'
const outputDir = process.env.SEAM_OUTPUT_DIR
if (isDev && !outputDir) throw new Error('SEAM_OUTPUT_DIR is required in dev mode')
const BUILD_DIR = isDev ? (outputDir as string) : resolve(import.meta.dir, '..')
const build = isDev ? loadBuildDev(BUILD_DIR) : loadBuild(BUILD_DIR)
const router = buildRouter(build)

const app = new Hono()
app.use('/*', seam(router, { staticDir: resolve(BUILD_DIR, 'public') }))

app.get('*', async (c) => {
	const result = await router.handlePage(new URL(c.req.url).pathname)
	if (!result) return c.text('Not Found', 404)
	return c.html(result.html, result.status as 200)
})

const port = Number(process.env.PORT) || 3457
Bun.serve({ port, fetch: app.fetch })
console.log(`Context Auth Demo running on http://localhost:${port}`)
