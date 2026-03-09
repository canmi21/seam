/* src/server/core/typescript/src/router/helpers.ts */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HandleResult, InternalProcedure } from './handler.js'
import type { HandlePageResult } from '../page/handler.js'
import type { PageDef, I18nConfig } from '../page/index.js'
import type { ChannelResult, ChannelMeta } from '../channel.js'
import type { ContextConfig, RawContextMap } from '../context.js'
import { resolveContext } from '../context.js'
import { SeamError } from '../errors.js'
import { handlePageRequest } from '../page/handler.js'
import { defaultStrategies, resolveChain } from '../resolve.js'
import type { ResolveStrategy } from '../resolve.js'
import type { ValidationMode, RouterOptions, PageRequestHeaders } from './index.js'

/** Resolve a ValidationMode to a boolean flag */
export function resolveValidationMode(mode: ValidationMode | undefined): boolean {
	const m = mode ?? 'dev'
	if (m === 'always') return true
	if (m === 'never') return false
	return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
}

/** Build the resolve strategy list from options */
export function buildStrategies(opts?: RouterOptions): {
	strategies: ResolveStrategy[]
	hasUrlPrefix: boolean
} {
	const strategies = opts?.resolve ?? defaultStrategies()
	return {
		strategies,
		hasUrlPrefix: strategies.some((s) => s.kind === 'url_prefix'),
	}
}

/** Register built-in seam.i18n.query procedure (route-hash-based lookup) */
export function registerI18nQuery(
	procedureMap: Map<string, InternalProcedure>,
	config: I18nConfig,
): void {
	const localeSet = new Set(config.locales)
	procedureMap.set('seam.i18n.query', {
		inputSchema: {},
		outputSchema: {},
		contextKeys: [],
		handler: ({ input }) => {
			const { route, locale: rawLocale } = input as { route: string; locale: string }
			const locale = localeSet.has(rawLocale) ? rawLocale : config.default
			const messages = lookupI18nMessages(config, route, locale)
			const hash = config.contentHashes[route]?.[locale] ?? ''
			return { hash, messages }
		},
	})
}

/** Look up messages by route hash + locale for RPC query */
function lookupI18nMessages(
	config: I18nConfig,
	routeHash: string,
	locale: string,
): Record<string, string> {
	if (config.mode === 'paged' && config.distDir) {
		const filePath = join(config.distDir, 'i18n', routeHash, `${locale}.json`)
		if (existsSync(filePath)) {
			return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>
		}
		return {}
	}
	return config.messages[locale]?.[routeHash] ?? {}
}

/** Collect channel metadata from channel results for manifest */
export function collectChannelMeta(
	channels: ChannelResult[] | undefined,
): Record<string, ChannelMeta> | undefined {
	if (!channels || channels.length === 0) return undefined
	return Object.fromEntries(
		channels.map((ch) => {
			const firstKey = Object.keys(ch.procedures)[0] ?? ''
			const name = firstKey.includes('.') ? firstKey.slice(0, firstKey.indexOf('.')) : firstKey
			return [name, ch.channelMeta]
		}),
	)
}

/** Resolve context for a procedure, returning undefined if no context needed */
export function resolveCtxFor(
	map: Map<string, { contextKeys: string[] }>,
	name: string,
	rawCtx: RawContextMap | undefined,
	ctxConfig: ContextConfig,
): Record<string, unknown> | undefined {
	if (!rawCtx) return undefined
	const proc = map.get(name)
	if (!proc || proc.contextKeys.length === 0) return undefined
	return resolveContext(ctxConfig, rawCtx, proc.contextKeys)
}

/** Resolve locale and match page route */
export async function matchAndHandlePage(
	pageMatcher: {
		match(path: string): { value: PageDef; params: Record<string, string>; pattern: string } | null
	},
	procedureMap: Map<string, InternalProcedure>,
	i18nConfig: I18nConfig | null,
	strategies: ResolveStrategy[],
	hasUrlPrefix: boolean,
	path: string,
	headers?: PageRequestHeaders,
	rawCtx?: RawContextMap,
	ctxConfig?: ContextConfig,
	shouldValidateInput?: boolean,
): Promise<HandlePageResult | null> {
	let pathLocale: string | null = null
	let routePath = path

	if (hasUrlPrefix && i18nConfig) {
		const segments = path.split('/').filter(Boolean)
		const localeSet = new Set(i18nConfig.locales)
		const first = segments[0]
		if (first && localeSet.has(first)) {
			pathLocale = first
			routePath = '/' + segments.slice(1).join('/') || '/'
		}
	}

	let locale: string | undefined
	if (i18nConfig) {
		locale = resolveChain(strategies, {
			url: headers?.url ?? '',
			pathLocale,
			cookie: headers?.cookie,
			acceptLanguage: headers?.acceptLanguage,
			locales: i18nConfig.locales,
			defaultLocale: i18nConfig.default,
		})
	}

	const match = pageMatcher.match(routePath)
	if (!match) return null

	let searchParams: URLSearchParams | undefined
	if (headers?.url) {
		try {
			const url = new URL(headers.url, 'http://localhost')
			if (url.search) searchParams = url.searchParams
		} catch {
			// Malformed URL — ignore
		}
	}

	const i18nOpts =
		locale && i18nConfig ? { locale, config: i18nConfig, routePattern: match.pattern } : undefined

	const ctxResolver = rawCtx
		? (proc: { contextKeys: string[] }) => {
				if (proc.contextKeys.length === 0) return {}
				return resolveContext(ctxConfig ?? {}, rawCtx, proc.contextKeys)
			}
		: undefined

	return handlePageRequest(
		match.value,
		match.params,
		procedureMap,
		i18nOpts,
		searchParams,
		ctxResolver,
		shouldValidateInput,
	)
}

/** Catch context resolution errors and return them as HandleResult */
export function resolveCtxSafe(
	map: Map<string, { contextKeys: string[] }>,
	name: string,
	rawCtx: RawContextMap | undefined,
	ctxConfig: ContextConfig,
): { ctx?: Record<string, unknown>; error?: HandleResult } {
	try {
		return { ctx: resolveCtxFor(map, name, rawCtx, ctxConfig) }
	} catch (err) {
		if (err instanceof SeamError) {
			return { error: { status: err.status, body: err.toJSON() } }
		}
		throw err
	}
}
