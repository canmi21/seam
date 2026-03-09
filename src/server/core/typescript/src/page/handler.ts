/* src/server/core/typescript/src/page/handler.ts */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderPage, escapeHtml } from '@canmi/seam-engine'
import { SeamError } from '../errors.js'
import type { InternalProcedure } from '../procedure.js'
import type { PageDef, LayoutDef, LoaderFn, I18nConfig } from './index.js'
import { headConfigToHtml } from './head.js'
import type { LoaderError } from './loader-error.js'
import { applyProjection } from './projection.js'
import { validateInput, formatValidationErrors } from '../validation/index.js'

export interface PageTiming {
	/** Procedure execution time in milliseconds */
	dataFetch: number
	/** Template injection time in milliseconds */
	inject: number
}

export interface HandlePageResult {
	status: number
	html: string
	timing?: PageTiming
}

export interface I18nOpts {
	locale: string
	config: I18nConfig
	/** Route pattern for hash-based message lookup */
	routePattern: string
}

interface LoaderResults {
	data: Record<string, unknown>
	meta: Record<string, { procedure: string; input: unknown; error?: true }>
}

/** Execute loaders, returning keyed results and metadata.
 *  Each loader is wrapped in its own try-catch so a single failure
 *  does not abort sibling loaders — the page renders at 200 with partial data. */
async function executeLoaders(
	loaders: Record<string, LoaderFn>,
	params: Record<string, string>,
	procedures: Map<string, InternalProcedure>,
	searchParams?: URLSearchParams,
	ctxResolver?: (proc: InternalProcedure) => Record<string, unknown>,
	shouldValidateInput?: boolean,
): Promise<LoaderResults> {
	const entries = Object.entries(loaders)
	const results = await Promise.all(
		entries.map(async ([key, loader]) => {
			const { procedure, input } = loader(params, searchParams)
			try {
				const proc = procedures.get(procedure)
				if (!proc) {
					throw new SeamError('INTERNAL_ERROR', `Procedure '${procedure}' not found`)
				}
				if (shouldValidateInput) {
					const v = validateInput(proc.inputSchema, input)
					if (!v.valid) {
						const summary = formatValidationErrors(v.errors)
						throw new SeamError('VALIDATION_ERROR', `Input validation failed: ${summary}`)
					}
				}
				const ctx = ctxResolver ? ctxResolver(proc) : {}
				const result = await proc.handler({ input, ctx })
				return { key, result, procedure, input }
			} catch (err) {
				const code = err instanceof SeamError ? err.code : 'INTERNAL_ERROR'
				const message = err instanceof Error ? err.message : 'Unknown error'
				console.error(`[seam] Loader "${key}" failed:`, err)
				const marker: LoaderError = { __error: true, code, message }
				return { key, result: marker as unknown, procedure, input, error: true as const }
			}
		}),
	)
	return {
		data: Object.fromEntries(results.map((r) => [r.key, r.result])),
		meta: Object.fromEntries(
			results.map((r) => {
				const entry: { procedure: string; input: unknown; error?: true } = {
					procedure: r.procedure,
					input: r.input,
				}
				if (r.error) entry.error = true
				return [r.key, entry]
			}),
		),
	}
}

/** Select the template for a given locale, falling back to the default template */
function selectTemplate(
	defaultTemplate: string,
	localeTemplates: Record<string, string> | undefined,
	locale: string | undefined,
): string {
	if (locale && localeTemplates) {
		return localeTemplates[locale] ?? defaultTemplate
	}
	return defaultTemplate
}

/** Look up pre-resolved messages for a route + locale. Zero merge, zero filter. */
function lookupMessages(
	config: I18nConfig,
	routePattern: string,
	locale: string,
): Record<string, string> {
	const routeHash = config.routeHashes[routePattern]
	if (!routeHash) return {}

	if (config.mode === 'paged' && config.distDir) {
		const filePath = join(config.distDir, 'i18n', routeHash, `${locale}.json`)
		if (existsSync(filePath)) {
			return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>
		}
		return {}
	}

	return config.messages[locale]?.[routeHash] ?? {}
}

/** Build JSON payload for engine i18n injection */
function buildI18nPayload(opts: I18nOpts): string {
	const { config: i18nConfig, routePattern, locale } = opts
	const messages = lookupMessages(i18nConfig, routePattern, locale)
	const routeHash = i18nConfig.routeHashes[routePattern]
	const i18nData: Record<string, unknown> = {
		locale,
		default_locale: i18nConfig.default,
		messages,
	}
	if (i18nConfig.cache && routeHash) {
		i18nData.hash = i18nConfig.contentHashes[routeHash]?.[locale]
		i18nData.router = i18nConfig.contentHashes
	}
	return JSON.stringify(i18nData)
}

export async function handlePageRequest(
	page: PageDef,
	params: Record<string, string>,
	procedures: Map<string, InternalProcedure>,
	i18nOpts?: I18nOpts,
	searchParams?: URLSearchParams,
	ctxResolver?: (proc: InternalProcedure) => Record<string, unknown>,
	shouldValidateInput?: boolean,
): Promise<HandlePageResult> {
	try {
		const t0 = performance.now()
		const layoutChain = page.layoutChain ?? []
		const locale = i18nOpts?.locale

		// Execute all loaders (layout chain + page) in parallel
		const loaderResults = await Promise.all([
			...layoutChain.map((layout) =>
				executeLoaders(
					layout.loaders,
					params,
					procedures,
					searchParams,
					ctxResolver,
					shouldValidateInput,
				),
			),
			executeLoaders(
				page.loaders,
				params,
				procedures,
				searchParams,
				ctxResolver,
				shouldValidateInput,
			),
		])

		const t1 = performance.now()

		// Merge all loader data and metadata into single objects
		const allData: Record<string, unknown> = {}
		const allMeta: Record<string, { procedure: string; input: unknown; error?: true }> = {}
		for (const { data, meta } of loaderResults) {
			Object.assign(allData, data)
			Object.assign(allMeta, meta)
		}

		// Prune to projected fields before template injection
		const prunedData = applyProjection(allData, page.projections)

		// Compose template: nest page inside layouts via outlet substitution
		const pageTemplate = selectTemplate(page.template, page.localeTemplates, locale)
		let composedTemplate = pageTemplate
		for (let i = layoutChain.length - 1; i >= 0; i--) {
			const layout = layoutChain[i] as LayoutDef
			const layoutTemplate = selectTemplate(layout.template, layout.localeTemplates, locale)
			composedTemplate = layoutTemplate.replace('<!--seam:outlet-->', composedTemplate)
		}

		// Resolve head metadata from headFn (overrides manifest head_meta)
		let resolvedHeadMeta = page.headMeta
		if (page.headFn) {
			try {
				const headConfig = page.headFn(allData)
				resolvedHeadMeta = headConfigToHtml(headConfig)
			} catch (err) {
				console.error('[seam] head function failed:', err)
			}
		}

		// Build PageConfig for engine
		const config: Record<string, unknown> = {
			layout_chain: layoutChain.map((l) => ({
				id: l.id,
				loader_keys: Object.keys(l.loaders),
			})),
			data_id: page.dataId ?? '__data',
			head_meta: resolvedHeadMeta,
			loader_metadata: allMeta,
		}
		if (page.pageAssets) {
			config.page_assets = page.pageAssets
		}

		const i18nOptsJson = i18nOpts ? buildI18nPayload(i18nOpts) : undefined

		// Single WASM call: inject slots, compose data script, apply locale/meta
		const html = renderPage(
			composedTemplate,
			JSON.stringify(prunedData),
			JSON.stringify(config),
			i18nOptsJson,
		)

		const t2 = performance.now()

		return {
			status: 200,
			html,
			timing: { dataFetch: t1 - t0, inject: t2 - t1 },
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error'
		return {
			status: 500,
			html: `<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1><p>${escapeHtml(message)}</p></body></html>`,
			timing: { dataFetch: 0, inject: 0 },
		}
	}
}
