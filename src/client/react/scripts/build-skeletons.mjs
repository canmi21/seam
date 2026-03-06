/* src/client/react/scripts/build-skeletons.mjs */

import { build } from 'esbuild'
import { readFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SeamBuildError } from './skeleton/render.mjs'
import { extractLayouts, flattenRoutes } from './skeleton/layout.mjs'
import {
	parseComponentImports,
	computeComponentHashes,
	computeScriptHash,
} from './skeleton/cache.mjs'
import { processLayoutsWithCache, processRoutesWithCache } from './skeleton/process.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function seamVirtualPlugin() {
	const cwd = process.cwd()
	const mapping = {
		'virtual:seam/client': '.seam/generated/client.ts',
		'virtual:seam/routes': '.seam/generated/routes.ts',
	}
	return {
		name: 'seam-virtual',
		setup(build) {
			build.onResolve({ filter: /^virtual:seam\// }, (args) => {
				const target = mapping[args.path]
				if (!target) return null
				const resolved = resolve(cwd, target)
				if (existsSync(resolved)) return { path: resolved }
				return { path: args.path, namespace: 'seam-virtual' }
			})
			build.onLoad({ filter: /.*/, namespace: 'seam-virtual' }, (args) => {
				if (args.path === 'virtual:seam/routes')
					return { contents: 'export default []', loader: 'ts' }
				if (args.path === 'virtual:seam/client')
					return { contents: 'export const DATA_ID = "__data"', loader: 'ts' }
				return null
			})
		},
	}
}

function loadManifest(manifestFile) {
	if (!manifestFile || manifestFile === 'none') return { manifest: null, manifestContent: '' }
	try {
		const content = readFileSync(resolve(manifestFile), 'utf-8')
		return { manifest: JSON.parse(content), manifestContent: content }
	} catch (e) {
		console.error(`warning: could not read manifest: ${e.message}`)
		return { manifest: null, manifestContent: '' }
	}
}

function loadI18nConfig(i18nArg) {
	if (!i18nArg || i18nArg === 'none') return null
	try {
		return JSON.parse(i18nArg)
	} catch (e) {
		console.error(`warning: could not parse i18n config: ${e.message}`)
		return null
	}
}

/** Resolve a source file path, probing for .tsx/.ts/.jsx/.js extensions */
function resolveSourcePath(p) {
	if (existsSync(p)) return p
	const base = p.replace(/\.[jt]sx?$/, '')
	for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
		if (existsSync(base + ext)) return base + ext
	}
	return p
}

async function main() {
	const routesFile = process.argv[2]
	if (!routesFile) {
		console.error('Usage: node build-skeletons.mjs <routes-file> [manifest-file] [i18n-json]')
		process.exit(1)
	}

	const { manifest, manifestContent } = loadManifest(process.argv[3])
	const i18n = loadI18nConfig(process.argv[4])

	if (i18n) {
		const { setI18nProvider } = await import('./skeleton/render.mjs')
		const { I18nProvider } = await import('@canmi/seam-i18n/react')
		setI18nProvider(I18nProvider)
	}

	const absRoutes = resolve(routesFile)
	const routesDir = dirname(absRoutes)
	const outfile = join(__dirname, '.tmp-routes-bundle.mjs')

	// Parse imports from source (before bundle) for component hash resolution
	const routesSource = readFileSync(absRoutes, 'utf-8')
	const importMap = parseComponentImports(routesSource)

	await build({
		entryPoints: [absRoutes],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile,
		external: ['react', 'react-dom', '@canmi/seam-react', '@canmi/seam-i18n'],
		plugins: [seamVirtualPlugin()],
	})

	try {
		const mod = await import(outfile)
		const routes = mod.default || mod.routes
		if (!Array.isArray(routes)) {
			throw new Error("Routes file must export default or named 'routes' as an array")
		}

		const layoutMap = extractLayouts(routes)
		const flat = flattenRoutes(routes)

		// Collect all unique component names for hashing
		const componentNames = new Set()
		for (const [, entry] of layoutMap) {
			if (entry.component?.name) componentNames.add(entry.component.name)
		}
		for (const route of flat) {
			if (route.component?.name) componentNames.add(route.component.name)
		}

		// Files to hash for script-level cache invalidation
		const skeletonDir = join(__dirname, 'skeleton')
		const scriptFiles = [
			join(skeletonDir, 'render.mjs'),
			join(skeletonDir, 'schema.mjs'),
			join(skeletonDir, 'layout.mjs'),
			join(skeletonDir, 'cache.mjs'),
			join(skeletonDir, 'process.mjs'),
			join(__dirname, 'variant-generator.mjs'),
			join(__dirname, 'mock-generator.mjs'),
		]

		const [componentHashes, scriptHash] = await Promise.all([
			computeComponentHashes([...componentNames], importMap, routesDir),
			Promise.resolve(computeScriptHash(scriptFiles)),
		])

		// Set up cache directory
		const cacheDir = join(process.cwd(), '.seam', 'cache', 'skeletons')
		mkdirSync(cacheDir, { recursive: true })

		// Shared warning state passed through to all render functions
		const buildWarnings = []
		const seenWarnings = new Set()
		const warnCtx = { buildWarnings, seenWarnings }

		const ctx = {
			componentHashes,
			scriptHash,
			manifestContent,
			manifest,
			cacheDir,
			i18n,
			warnCtx,
			stats: { hits: 0, misses: 0 },
		}

		// Build sourceFileMap: route path -> component source file (relative to cwd)
		const sourceFileMap = {}
		for (const route of flat) {
			if (route.component?.name) {
				const specifier = importMap.get(route.component.name)
				if (specifier) {
					const abs = resolve(routesDir, specifier)
					const resolved = resolveSourcePath(abs)
					sourceFileMap[route.path] = relative(process.cwd(), resolved)
				}
			}
		}

		const layouts = await processLayoutsWithCache(layoutMap, ctx)
		const renderedRoutes = await processRoutesWithCache(flat, ctx)

		const output = {
			layouts,
			routes: renderedRoutes,
			sourceFileMap,
			warnings: buildWarnings,
			cacheStats: ctx.stats,
		}
		process.stdout.write(JSON.stringify(output))
	} finally {
		try {
			unlinkSync(outfile)
		} catch {}
	}
}

main().catch((err) => {
	if (err instanceof SeamBuildError) {
		console.error(err.message)
	} else {
		console.error(err)
	}
	process.exit(1)
})
