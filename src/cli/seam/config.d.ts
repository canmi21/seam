/* src/cli/seam/config.d.ts */

import type { UserConfig as ViteUserConfig } from 'vite'

export interface ProjectConfig {
	name: string
}

export interface BackendConfig {
	lang?: string
	devCommand?: string
	port?: number
}

export interface FrontendConfig {
	entry?: string
	devCommand?: string
	devPort?: number
	outDir?: string
	rootId?: string
	dataId?: string
}

export interface BuildSection {
	/** Path to the router file. Mutually exclusive with `pagesDir`. */
	routes?: string
	outDir?: string
	/** Only `'react'` is supported. */
	renderer?: 'react'
	backendBuildCommand?: string
	routerFile?: string
	manifestCommand?: string
	typecheckCommand?: string
	obfuscate?: boolean
	sourcemap?: boolean
	typeHint?: boolean
	/** Route hash length. Must be between 4 and 64 (default: 12). */
	hashLength?: number
	/** Filesystem-based routing directory. Mutually exclusive with `routes`. */
	pagesDir?: string
}

export interface GenerateSection {
	outDir?: string
}

export interface DevSection {
	port?: number
	vitePort?: number
	obfuscate?: boolean
	sourcemap?: boolean
	typeHint?: boolean
	/** Route hash length override for dev mode. Must be between 4 and 64. */
	hashLength?: number
}

export interface I18nSection {
	/** List of supported locale codes. Must be non-empty. */
	locales: string[]
	/** Default locale. Must be one of `locales`. */
	default?: string
	messagesDir?: string
	mode?: 'memory' | 'paged'
	cache?: boolean
}

export interface WorkspaceSection {
	members: string[]
}

export interface CleanSection {
	commands?: string[]
}

export type TransportPreference = 'http' | 'sse' | 'ws' | 'ipc'

export interface TransportConfig {
	prefer: TransportPreference
	fallback?: TransportPreference[]
}

export interface TransportSection {
	query?: TransportConfig
	command?: TransportConfig
	stream?: TransportConfig
	subscription?: TransportConfig
	upload?: TransportConfig
	channel?: TransportConfig
}

export interface SeamConfig {
	/** Output mode: 'static' (all SSG), 'server' (all CTR), 'hybrid' (per-page) */
	output?: 'static' | 'server' | 'hybrid'
	/** Omit to auto-read from package.json or use directory name */
	project?: ProjectConfig
	backend?: BackendConfig
	frontend?: FrontendConfig
	build?: BuildSection
	generate?: GenerateSection
	dev?: DevSection
	i18n?: I18nSection
	workspace?: WorkspaceSection
	clean?: CleanSection
	transport?: TransportSection
	/** Vite config override for the built-in bundler (supports plugins) */
	vite?: ViteUserConfig
	/** Reserved for future router config */
	router?: Record<string, unknown>
}

export function defineConfig(config: SeamConfig): SeamConfig
