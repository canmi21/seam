/* src/cli/pkg/scripts/config.d.ts */

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
	buildCommand?: string
	outDir?: string
	rootId?: string
	dataId?: string
}

export interface BuildSection {
	routes?: string
	outDir?: string
	bundlerCommand?: string
	bundlerManifest?: string
	renderer?: string
	backendBuildCommand?: string
	routerFile?: string
	manifestCommand?: string
	typecheckCommand?: string
	obfuscate?: boolean
	sourcemap?: boolean
	typeHint?: boolean
	hashLength?: number
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
	hashLength?: number
}

export interface I18nSection {
	locales: string[]
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
	/** Rolldown/Vite config override for the built-in bundler */
	vite?: Record<string, unknown>
	/** Reserved for future router config */
	router?: Record<string, unknown>
}

export function defineConfig(config: SeamConfig): SeamConfig
