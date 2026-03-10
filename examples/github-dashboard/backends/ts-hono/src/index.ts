/* examples/github-dashboard/backends/ts-hono/src/index.ts */

import { resolve } from 'node:path'
import { Hono } from 'hono'
import { loadBuild, loadBuildDev } from '@canmi/seam-server'
import type { BuildOutput } from '@canmi/seam-server'
import { seam } from '@canmi/seam-adapter-hono'
import { buildRouter } from './router.js'

const isDev = process.env.SEAM_DEV === '1'
const BUILD_DIR =
	process.env.SEAM_OUTPUT_DIR ?? (isDev ? '.seam/output' : resolve(import.meta.dir, '..'))

// Gracefully handle missing build output (API-only mode without page serving)
let build: BuildOutput = { pages: {}, rpcHashMap: undefined, i18n: null }
try {
	build = isDev ? loadBuildDev(BUILD_DIR) : loadBuild(BUILD_DIR)
} catch {
	// No build output available -- RPC still works, page serving disabled
}
const dataId = Object.values(build.pages)[0]?.dataId ?? '__data'
const router = buildRouter(build)

const app = new Hono()

// Seam middleware: handles /_seam/* (RPC, manifest, static, pages, public files, dev reload)
app.use(
	'/*',
	seam(router, {
		staticDir: resolve(BUILD_DIR, 'public'),
		publicDir: build.publicDir,
	}),
)

// Root-path page serving -- inject timing into data script's _meta
app.get('*', async (c) => {
	const result = await router.handlePage(new URL(c.req.url).pathname)
	if (!result) return c.text('Not Found', 404)

	const fmt = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(0)}\u00b5s` : `${ms.toFixed(2)}ms`)
	const timing = result.timing
		? `\u00a0\u00b7 Data Fetch ${fmt(result.timing.dataFetch)} \u00b7 Inject ${fmt(result.timing.inject)}`
		: ''

	let html = result.html.replace('<body>', '<body style="background-color:var(--c-surface)">')

	// Append _meta.timing into the data script JSON
	const dataIdPattern = new RegExp(`<script id="${dataId}" type="application/json">(.*?)</script>`)
	html = html.replace(dataIdPattern, (_match, json) => {
		const data = JSON.parse(json)
		data._meta = { timing }
		return `<script id="${dataId}" type="application/json">${JSON.stringify(data)}</script>`
	})
	return c.html(html, result.status as 200)
})

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000

const server = Bun.serve({ port, fetch: app.fetch })

console.log(`GitHub Dashboard (ts-hono) running on http://localhost:${server.port}`)
