/* src/router/tanstack/src/use-i18n-state.ts */

import { createI18n, cleanLocaleQuery } from '@canmi/seam-i18n'
import { routeHash } from '@canmi/seam-i18n/hash'
import { createI18nCache } from '@canmi/seam-i18n/cache'
import type { I18nCache } from '@canmi/seam-i18n/cache'
import type { I18nInstance } from '@canmi/seam-i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { matchSeamRoute } from './route-matcher.js'
import type { SeamRouterContext } from './types.js'

/** Strip router basepath prefix from a pathname */
function stripBasepath(basepath: string | undefined, pathname: string): string {
	if (basepath && basepath !== '/' && pathname.startsWith(basepath)) {
		return pathname.slice(basepath.length) || '/'
	}
	return pathname
}

// Singleton cache (created once when router data is present)
let globalCache: I18nCache | null = null

/** Fetch i18n messages for a new route — tries cache first, then RPC */
function fetchRouteMessages(
	locale: string,
	hash: string,
	cache: I18nCache | null,
	rpc: (procedure: string, input?: unknown) => Promise<unknown>,
	onResult: (locale: string, messages: Record<string, string>) => void,
): void {
	if (cache) {
		const cached = cache.get(locale, hash)
		if (cached) {
			onResult(locale, cached.messages)
			return
		}
	}
	void rpc('seam.i18n.query', { route: hash, locale }).then((result) => {
		const { hash: h, messages } = result as { hash?: string; messages: Record<string, string> }
		if (cache && h) cache.set(locale, hash, h, messages)
		onResult(locale, messages)
	})
}

export interface I18nStateResult {
	i18n: I18nInstance | null
	currentPathname: string
	currentRouteHash: string | null
	onMessages: (locale: string, messages: Record<string, string>, hash?: string) => void
}

/** Encapsulates all i18n state: locale query cleanup, cache init, SPA message loading */
export function useI18nState(
	ctx: SeamRouterContext,
	basepath: string | undefined,
	rawPathname: string,
	leafPaths: string[] | undefined,
): I18nStateResult {
	const i18nMeta = ctx._seamI18n

	// Strip locale query param from URL on initial hydration (hidden mode UX)
	const cleanParam = ctx._cleanLocaleQuery
	useEffect(() => {
		if (cleanParam) cleanLocaleQuery(cleanParam)
	}, [cleanParam])

	// Initialize cache from router table (once)
	const cacheRef = useRef<I18nCache | null>(null)
	if (!cacheRef.current && i18nMeta?.router) {
		if (!globalCache) {
			globalCache = createI18nCache()
			globalCache.validate(i18nMeta.router)
		}
		cacheRef.current = globalCache
	}

	const [i18nState, setI18nState] = useState<{
		locale: string
		messages: Record<string, string>
	} | null>(i18nMeta ? { locale: i18nMeta.locale, messages: i18nMeta.messages } : null)

	// Derive current route hash from pathname
	const currentPathname = useMemo(
		() => stripBasepath(basepath, rawPathname),
		[basepath, rawPathname],
	)
	const currentPattern = useMemo(() => {
		if (!leafPaths?.length) return null
		return matchSeamRoute(leafPaths, currentPathname)?.path ?? null
	}, [leafPaths, currentPathname])
	const currentRouteHash = useMemo(
		() => (currentPattern ? routeHash(currentPattern) : null),
		[currentPattern],
	)

	// Seed cache with initial messages
	const seeded = useRef(false)
	if (!seeded.current && i18nMeta && currentRouteHash && cacheRef.current) {
		if (i18nMeta.hash) {
			cacheRef.current.set(i18nMeta.locale, currentRouteHash, i18nMeta.hash, i18nMeta.messages)
		}
		seeded.current = true
	}

	// On SPA navigation: fetch messages for new route when locale is active
	const prevPathnameRef = useRef(currentPathname)
	useEffect(() => {
		if (prevPathnameRef.current === currentPathname) return
		prevPathnameRef.current = currentPathname
		if (!i18nState || !currentRouteHash) return
		fetchRouteMessages(
			i18nState.locale,
			currentRouteHash,
			cacheRef.current,
			ctx.seamRpc,
			(locale, messages) => setI18nState({ locale, messages }),
		)
	}, [currentPathname, currentRouteHash, i18nState, ctx])

	const i18n = useMemo(
		() => (i18nState ? createI18n(i18nState.locale, i18nState.messages) : null),
		[i18nState],
	)

	const onMessages = useCallback(
		(locale: string, messages: Record<string, string>, hash?: string) => {
			setI18nState({ locale, messages })
			if (cacheRef.current && hash && currentRouteHash) {
				cacheRef.current.set(locale, currentRouteHash, hash, messages)
			}
		},
		[currentRouteHash],
	)

	return { i18n, currentPathname, currentRouteHash, onMessages }
}
