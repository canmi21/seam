/* examples/features/stream-upload/src/server/index.ts */

import { resolve } from 'node:path'
import { Hono } from 'hono'
import { loadBuildOutput, loadBuildOutputDev, loadRpcHashMap } from '@canmi/seam-server'
import { seam } from '@canmi/seam-adapter-hono'
import { buildRouter } from './router.js'

const isDev = process.env.SEAM_DEV === '1'
const outputDir = process.env.SEAM_OUTPUT_DIR
if (isDev && !outputDir) throw new Error('SEAM_OUTPUT_DIR is required in dev mode')
const BUILD_DIR = isDev ? (outputDir as string) : resolve(import.meta.dir, '..')
const pages = isDev ? loadBuildOutputDev(BUILD_DIR) : loadBuildOutput(BUILD_DIR)
const rpcHashMap = loadRpcHashMap(BUILD_DIR)
const router = buildRouter({ pages })

const app = new Hono()
app.use('/*', seam(router, { staticDir: resolve(BUILD_DIR, 'public'), rpcHashMap }))

app.get('*', async (c) => {
	const result = await router.handlePage(new URL(c.req.url).pathname)
	if (!result) return c.text('Not Found', 404)
	return c.html(result.html, result.status as 200)
})

const port = Number(process.env.PORT) || 3456
Bun.serve({ port, fetch: app.fetch })
console.log(`Stream & Upload Demo running on http://localhost:${port}`)
