/* src/server/core/typescript/src/page/index.ts */

export interface LoaderResult {
	procedure: string
	input: unknown
}

export type LoaderFn = (
	params: Record<string, string>,
	searchParams?: URLSearchParams,
) => LoaderResult

export interface LayoutDef {
	id: string
	template: string
	localeTemplates?: Record<string, string>
	loaders: Record<string, LoaderFn>
	i18nKeys?: string[]
}

export interface PageAssets {
	styles: string[]
	scripts: string[]
	preload: string[]
	prefetch: string[]
}

export type HeadFn = (data: Record<string, unknown>) => {
	title?: string
	meta?: Record<string, string | undefined>[]
	link?: Record<string, string | undefined>[]
}

export interface DeriveManifestEntry {
	sources: string[]
	fn: string
	output?: unknown
}

export interface PageDef {
	template: string
	localeTemplates?: Record<string, string>
	loaders: Record<string, LoaderFn>
	derives?: Record<string, DeriveManifestEntry>
	layoutChain?: LayoutDef[]
	headMeta?: string
	headFn?: HeadFn
	dataId?: string
	i18nKeys?: string[]
	pageAssets?: PageAssets
	projections?: Record<string, string[]>
	/** SSG: page was pre-rendered at build time */
	prerender?: boolean
	/** SSG: directory containing pre-rendered HTML and __data.json */
	staticDir?: string
}

export interface I18nConfig {
	locales: string[]
	default: string
	mode: 'memory' | 'paged'
	cache: boolean
	routeHashes: Record<string, string>
	contentHashes: Record<string, Record<string, string>>
	/** Memory mode: locale → routeHash → messages */
	messages: Record<string, Record<string, Record<string, string>>>
	/** Paged mode: base directory for on-demand reads */
	distDir?: string
}

export function definePage(config: PageDef): PageDef {
	return { ...config, layoutChain: config.layoutChain ?? [] }
}
