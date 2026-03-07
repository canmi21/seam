/* src/cli/vite/src/index.ts */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import type { Plugin } from 'vite'

// -- Virtual module resolution --

const VIRTUAL_MODULES: Record<string, string> = {
	'virtual:seam/client': '.seam/generated/client.ts',
	'virtual:seam/routes': '.seam/generated/routes.ts',
	'virtual:seam/meta': '.seam/generated/meta.ts',
	'virtual:seam/hooks': '.seam/generated/hooks.ts',
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
			const target = VIRTUAL_MODULES[id]
			if (!target) return
			const resolved = resolve(projectRoot, target)
			if (existsSync(resolved)) return resolved
			return `\0${id}`
		},
		load(id) {
			if (id === '\0virtual:seam/routes') return 'export default []'
			if (id === '\0virtual:seam/client') return 'export const DATA_ID = "__data"'
			if (id === '\0virtual:seam/meta') return 'export const DATA_ID = "__data"'
			if (id === '\0virtual:seam/hooks') return ''
		},
	}
}

// -- Config plugin (auto-sets Vite build config from SEAM_* env vars) --

function seamConfigPlugin(): Plugin {
	const obfuscate = process.env.SEAM_OBFUSCATE === '1'
	const typeHint = process.env.SEAM_TYPE_HINT !== '0'
	const hashLength = Number(process.env.SEAM_HASH_LENGTH) || 12

	return {
		name: 'seam-config',
		config(userConfig) {
			const distDir = process.env.SEAM_DIST_DIR ?? '.seam/dist'
			const entry = process.env.SEAM_ENTRY

			return {
				appType: 'custom',
				server: { watch: { ignored: ['**/.seam/**'] } },
				build: {
					outDir: distDir,
					manifest: true,
					sourcemap: process.env.SEAM_SOURCEMAP === '1',
					rollupOptions: {
						// Only inject input if user hasn't set it and SEAM_ENTRY exists
						...(!userConfig.build?.rollupOptions?.input && entry ? { input: entry } : {}),
						// Obfuscation output naming
						...(obfuscate
							? {
									output: {
										hashCharacters: 'hex' as const,
										...(typeHint
											? {
													entryFileNames: `script-[hash:${hashLength}].js`,
													chunkFileNames: `chunk-[hash:${hashLength}].js`,
													assetFileNames: (info: { names?: string[] }) =>
														info.names?.[0]?.endsWith('.css')
															? `style-[hash:${hashLength}].css`
															: `[hash:${hashLength}].[ext]`,
												}
											: {
													entryFileNames: `[hash:${hashLength}].js`,
													chunkFileNames: `[hash:${hashLength}].js`,
													assetFileNames: `[hash:${hashLength}].[ext]`,
												}),
									},
								}
							: {}),
					},
				},
			}
		},
	}
}

// -- RPC hash transform plugin --

function seamRpcPlugin(): Plugin {
	const mapPath = process.env.SEAM_RPC_MAP_PATH
	if (!mapPath) return { name: 'seam-rpc-noop' }
	let procedures: Record<string, string> = {}
	return {
		name: 'seam-rpc-transform',
		buildStart() {
			try {
				const map = JSON.parse(readFileSync(mapPath, 'utf-8'))
				procedures = { ...map.procedures, _batch: map.batch }
			} catch {
				/* obfuscation off or file missing */
			}
		},
		transform(code, id) {
			if (!Object.keys(procedures).length) return
			if (id.includes('node_modules') && !id.includes('@canmi/seam-')) return
			let result = code
			for (const [name, hash] of Object.entries(procedures)) {
				result = result.replaceAll(`"${name}"`, `"${hash}"`)
			}
			return result !== code ? { code: result } : undefined
		},
	}
}

// -- Dev-only reload trigger plugin --

function seamReloadPlugin(devOutDir = '.seam/dev-output'): Plugin {
	return {
		name: 'seam-reload',
		apply: 'serve',
		async configureServer(server) {
			try {
				const { watchReloadTrigger } = await import('@canmi/seam-server')
				const watcher = watchReloadTrigger(resolve(devOutDir), () => {
					server.ws.send({ type: 'full-reload' })
				})
				server.httpServer?.on('close', () => watcher.close())
			} catch {
				/* @canmi/seam-server not installed */
			}
		},
	}
}

// -- Composite plugin --

export interface SeamOptions {
	devOutDir?: string // default: '.seam/dev-output'
}

/**
 * Composite Vite plugin for SeamJS.
 * Returns Plugin[] — usage: `plugins: [react(), seam()]`
 */
export function seam(options?: SeamOptions): Plugin[] {
	return [
		seamConfigPlugin(),
		seamVirtual(),
		seamPageSplit(),
		seamRpcPlugin(),
		seamReloadPlugin(options?.devOutDir),
	]
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
