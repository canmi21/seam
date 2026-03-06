/* src/cli/vite/src/index.ts */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import type { Plugin } from 'vite'

// -- Virtual module resolution --

const VIRTUAL_MODULES: Record<string, string> = {
	'virtual:seam/client': '.seam/generated/client.ts',
	'virtual:seam/routes': '.seam/generated/routes.ts',
}

const SEAM_PACKAGES = ['@canmi/seam-react', '@canmi/seam-tanstack-router', '@canmi/seam-client']

/**
 * Vite plugin that resolves `virtual:seam/*` imports to generated files
 * and excludes seam packages from esbuild pre-bundling.
 */
export function seamVirtual(): Plugin {
	let projectRoot: string
	return {
		name: 'seam-virtual',
		config() {
			return { optimizeDeps: { exclude: SEAM_PACKAGES } }
		},
		configResolved(config) {
			projectRoot = config.root
		},
		resolveId(id) {
			if (id in VIRTUAL_MODULES) {
				return resolve(projectRoot, VIRTUAL_MODULES[id]!)
			}
		},
	}
}

// -- Per-page code splitting --

/** Parse import statements from source, returning Map<localName, specifier> */
export function parseComponentImports(source: string): Map<string, string> {
	const map = new Map<string, string>()
	const re = /import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?from\s+['"]([^'"]+)['"]/g
	let m: RegExpExecArray | null
	while ((m = re.exec(source)) !== null) {
		const [, defaultName, namedPart, specifier] = m
		if (defaultName) map.set(defaultName, specifier as string)
		if (namedPart) {
			for (const part of namedPart.split(',')) {
				const t = part.trim()
				if (!t) continue
				const asMatch = t.match(/^(\w+)\s+as\s+(\w+)$/)
				if (asMatch) {
					map.set(asMatch[2] as string, specifier as string)
				} else {
					map.set(t, specifier as string)
				}
			}
		}
	}
	return map
}

/** Resolve a source file path, probing .tsx/.ts/.jsx/.js extensions */
function resolveSourcePath(p: string): string {
	if (existsSync(p)) return p
	const base = p.replace(/\.[jt]sx?$/, '')
	for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
		if (existsSync(base + ext)) return base + ext
	}
	return p
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface PageComponent {
	specifier: string
	resolved: string
}

interface SplitInfo {
	entries: Record<string, string>
	pageComponents: Map<string, PageComponent>
	absRoutesFile: string
}

function analyzeRoutesForSplitting(routesFile: string): SplitInfo | null {
	const absRoutesFile = resolve(routesFile)
	if (!existsSync(absRoutesFile)) return null

	const source = readFileSync(absRoutesFile, 'utf-8')
	const importMap = parseComponentImports(source)

	// Find component references: `component: Name` or `component:Name`
	const componentRefs = new Set<string>()
	const componentRe = /component\s*:\s*(\w+)/g
	let match: RegExpExecArray | null
	while ((match = componentRe.exec(source)) !== null) {
		componentRefs.add(match[1] as string)
	}

	if (componentRefs.size < 2) return null // splitting only helps with 2+ pages

	const routesDir = dirname(absRoutesFile)
	const entries: Record<string, string> = {}
	const pageComponents = new Map<string, PageComponent>()

	for (const name of componentRefs) {
		const specifier = importMap.get(name)
		if (!specifier) continue
		const abs = resolve(routesDir, specifier)
		const resolved = resolveSourcePath(abs)
		if (!existsSync(resolved)) continue

		const baseName = basename(resolved, extname(resolved))
		entries[`page-${baseName}`] = resolved
		pageComponents.set(name, { specifier, resolved })
	}

	if (pageComponents.size < 2) return null

	return { entries, pageComponents, absRoutesFile }
}

/**
 * Vite plugin for SeamJS per-page code splitting.
 *
 * Reads SEAM_ROUTES_FILE env var (set by `seam build`) to identify page
 * components, converts their static imports to dynamic imports, and adds
 * them as separate Rollup entry points for per-page chunking.
 *
 * Usage in vite.config.ts:
 * ```ts
 * import { seamPageSplit } from "@canmi/seam-vite";
 * export default defineConfig({
 *   plugins: [react(), seamPageSplit()],
 * });
 * ```
 */
export function seamPageSplit(): Plugin {
	const routesFile = process.env.SEAM_ROUTES_FILE
	if (!routesFile) {
		return { name: 'seam-page-split', apply: 'build' }
	}

	const splitInfo = analyzeRoutesForSplitting(routesFile)
	if (!splitInfo) {
		return { name: 'seam-page-split', apply: 'build' }
	}

	return {
		name: 'seam-page-split',
		apply: 'build',

		config(config) {
			const existing = config.build?.rollupOptions?.input
			let base: Record<string, string>

			if (typeof existing === 'string') {
				base = { main: existing }
			} else if (Array.isArray(existing)) {
				base = Object.fromEntries(existing.map((e, i) => [`entry${i}`, e]))
			} else if (existing && typeof existing === 'object') {
				base = { ...existing }
			} else {
				base = {}
			}

			return {
				// Vite needs to know the static serving prefix so that dynamic imports
				// (used by lazy page components) resolve to /_seam/static/ URLs.
				base: '/_seam/static/',
				build: {
					rollupOptions: {
						input: { ...base, ...splitInfo.entries },
					},
				},
			}
		},

		transform(code, id) {
			const absId = resolve(id)
			if (absId !== splitInfo.absRoutesFile) return null

			let result = code
			for (const [name, { specifier }] of splitInfo.pageComponents) {
				const escaped = escapeRegex(specifier)

				// Match: import { Name } from "specifier"
				const singleNamedRe = new RegExp(
					`import\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*['"]${escaped}['"]\\s*;?`,
				)
				// Match: import Name from "specifier"
				const defaultRe = new RegExp(`import\\s+${name}\\s+from\\s*['"]${escaped}['"]\\s*;?`)

				const lazyDecl = `const ${name} = Object.assign(() => import("${specifier}").then(m => m.${name} || m.default), { __seamLazy: true })`

				if (singleNamedRe.test(result)) {
					result = result.replace(singleNamedRe, lazyDecl)
				} else if (defaultRe.test(result)) {
					result = result.replace(defaultRe, lazyDecl)
				}
			}

			return result !== code ? { code: result } : null
		},
	}
}
