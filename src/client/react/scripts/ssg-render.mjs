/* src/client/react/scripts/ssg-render.mjs */

import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPage } from '@canmi/seam-engine'
import { flattenRoutes } from './skeleton/layout.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOKS_STUB = `import { useSeamData } from '@canmi/seam-react'

export const useSeamFetch = undefined
export const useFetch = undefined
export const useSeamQuery = undefined
export const useSeamMutation = undefined

export function useSeamDerive(key) {
	const data = useSeamData()
	const derived = data && typeof data === 'object' ? data.__derived : undefined
	return derived && typeof derived === 'object' ? derived[key] : undefined
}

export const useDerive = useSeamDerive
`

function seamVirtualPlugin() {
	const cwd = process.cwd()
	const mapping = {
		'virtual:seam/client': '.seam/generated/client.ts',
		'virtual:seam/routes': '.seam/generated/routes.ts',
		'virtual:seam/meta': '.seam/generated/meta.ts',
	}
	const STUB_MODULES = new Set(['virtual:seam/hooks'])
	return {
		name: 'seam-virtual',
		setup(build) {
			build.onResolve({ filter: /^virtual:seam\// }, (args) => {
				if (STUB_MODULES.has(args.path)) return { path: args.path, namespace: 'seam-virtual' }
				const target = mapping[args.path]
				if (!target) return null
				const resolved = resolve(cwd, target)
				if (existsSync(resolved)) return { path: resolved }
				return { path: args.path, namespace: 'seam-virtual' }
			})
			build.onLoad({ filter: /.*/, namespace: 'seam-virtual' }, (args) => {
				if (args.path === 'virtual:seam/hooks') {
					return { contents: HOOKS_STUB, loader: 'ts' }
				}
				return { contents: '', loader: 'ts' }
			})
		},
	}
}

const EXTERNAL_PACKAGES = ['react', 'react-dom', '@canmi/seam-react', '@canmi/seam-i18n']

async function bundleRoutes(entryPoint, outfile) {
	await build({
		entryPoints: [entryPoint],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile,
		external: EXTERNAL_PACKAGES,
		plugins: [seamVirtualPlugin()],
	})
}

function parseArgs() {
	const args = process.argv.slice(2)
	const result = {}
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith('--')) {
			result[args[i].slice(2)] = args[i + 1]
			i++
		}
	}
	return result
}

/** Replace route pattern params with concrete values */
function expandPath(pattern, params) {
	return pattern.replace(/:([a-zA-Z_]\w*)/g, (_, name) => params[name] || '')
}

function isDynamicRoute(path) {
	return path.includes(':') || path.includes('*')
}

/** Build a map of route path -> route definition from flattened route tree */
function buildRouteDataMap(routes) {
	const flat = flattenRoutes(routes, null, null)
	const map = new Map()
	for (const route of flat) {
		map.set(route.path, route)
	}
	return map
}

/** Resolve layout chain from manifest, returning outer-to-inner order */
function resolveLayoutChain(layoutId, layouts) {
	const chain = []
	let currentId = layoutId
	while (currentId) {
		const entry = layouts[currentId]
		if (!entry) break
		chain.push({ id: currentId, ...entry })
		currentId = entry.parent
	}
	chain.reverse()
	return chain
}

/** Compose page template with layout chain via outlet substitution */
function composeTemplate(pageTemplate, layoutId, layouts, layoutTemplateCache) {
	if (!layoutId) return pageTemplate

	const chain = resolveLayoutChain(layoutId, layouts)
	let composed = pageTemplate
	for (let i = chain.length - 1; i >= 0; i--) {
		const layout = chain[i]
		const layoutTmpl = layoutTemplateCache[layout.id]
		if (layoutTmpl) {
			composed = layoutTmpl.replace('<!--seam:outlet-->', composed)
		}
	}
	return composed
}

async function main() {
	const args = parseArgs()
	const outDir = args['out-dir']
	const staticDir = args['static-dir']
	const routesFile = args['routes-file']

	if (!outDir || !staticDir || !routesFile) {
		console.error('Usage: ssg-render.mjs --out-dir DIR --static-dir DIR --routes-file FILE')
		process.exit(1)
	}

	// Read route manifest
	const manifestPath = join(outDir, 'route-manifest.json')
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

	// Bundle and load routes to access data/staticPaths exports
	const absRoutes = resolve(routesFile)
	const outfile = join(__dirname, '.tmp-ssg-routes-bundle.mjs')
	await bundleRoutes(absRoutes, outfile)

	let routeDataMap
	try {
		const mod = await import(outfile)
		const routes = mod.default || mod.routes
		if (!Array.isArray(routes)) {
			throw new Error("Routes file must export default or named 'routes' as an array")
		}
		routeDataMap = buildRouteDataMap(routes)
	} finally {
		try {
			unlinkSync(outfile)
		} catch {}
	}

	// Load layout templates
	const layouts = manifest.layouts || {}
	const layoutTemplateCache = {}
	for (const [id, entry] of Object.entries(layouts)) {
		const tmplPath = entry.template || (entry.templates && Object.values(entry.templates)[0])
		if (tmplPath) {
			layoutTemplateCache[id] = readFileSync(join(outDir, tmplPath), 'utf-8')
		}
	}

	// Process prerender routes
	const results = []

	for (const [routePath, entry] of Object.entries(manifest.routes)) {
		if (!entry.prerender) continue

		const routeDef = routeDataMap.get(routePath)

		// Read route template
		const tmplPath = entry.template || (entry.templates && Object.values(entry.templates)[0])
		if (!tmplPath) {
			console.error(`warning: no template for prerender route "${routePath}", skipping`)
			continue
		}
		const pageTemplate = readFileSync(join(outDir, tmplPath), 'utf-8')

		// Compose template with layout chain
		const composedTemplate = composeTemplate(
			pageTemplate,
			entry.layout,
			layouts,
			layoutTemplateCache,
		)

		// Build layout chain config for engine
		const layoutChain = entry.layout
			? resolveLayoutChain(entry.layout, layouts).map((l) => ({
					id: l.id,
					loader_keys: Object.keys(l.loaders || {}),
				}))
			: []

		// Determine render entries (path + data pairs)
		const entries = []

		if (routeDef?.staticPaths) {
			const paths = await routeDef.staticPaths()
			for (const { params, data } of paths) {
				const concretePath = expandPath(routePath, params)
				entries.push({ path: concretePath, data: data || {} })
			}
		} else if (isDynamicRoute(routePath)) {
			throw new Error(
				`Route "${routePath}" has prerender=true but no staticPaths -- ` +
					'dynamic SSG routes must provide staticPaths',
			)
		} else {
			entries.push({ path: routePath, data: routeDef?.data || {} })
		}

		// Render each entry
		for (const { path, data } of entries) {
			const config = {
				layout_chain: layoutChain,
				data_id: manifest.data_id || '__data',
				head_meta: entry.head_meta,
				loader_metadata: {},
			}
			if (entry.assets) {
				config.page_assets = entry.assets
			}

			const html = renderPage(composedTemplate, JSON.stringify(data), JSON.stringify(config))

			// Write HTML
			const htmlDir = join(staticDir, path === '/' ? '' : path)
			mkdirSync(htmlDir, { recursive: true })
			writeFileSync(join(htmlDir, 'index.html'), html)

			// Write __data.json
			writeFileSync(join(htmlDir, '__data.json'), JSON.stringify(data))

			results.push(path)
		}
	}

	// Output summary
	process.stdout.write(JSON.stringify({ pages: results.length, paths: results }))
}

main().catch((err) => {
	console.error(err.message || err)
	process.exit(1)
})
