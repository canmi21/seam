/* src/router/tanstack/src/seam-core-bridge.tsx */

import { useMatches, useRouter } from '@tanstack/react-router'
import { SeamDataProvider, SeamNavigateProvider } from '@canmi/seam-react'
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SeamRouterContext } from './types.js'
import { matchSeamRoute } from './route-matcher.js'
import { updateHead, clearHead } from './head-manager.js'

/** Merge loaderData from all matched routes (layout + page levels) */
function mergeLoaderData(matches: { loaderData?: unknown }[]): Record<string, unknown> {
	const merged: Record<string, unknown> = {}
	for (const match of matches) {
		const ld = match.loaderData as Record<string, unknown> | undefined
		if (ld && typeof ld === 'object') Object.assign(merged, ld)
	}
	return (merged.page ?? merged) as Record<string, unknown>
}

/**
 * Minimal bridge — data merging + SPA navigation + head management.
 * No i18n imports or logic. Used as default when no i18nBridge is provided.
 */
export function SeamCoreBridge({ children }: { children: ReactNode }) {
	const matches = useMatches()
	const seamData = mergeLoaderData(matches)

	const router = useRouter()
	const navigate = useCallback(
		(url: string): void => {
			void router.navigate({ to: url })
		},
		[router],
	)

	const ctx = router.options.context as SeamRouterContext
	const prevPathnameRef = useRef(typeof window !== 'undefined' ? window.location.pathname : '')

	useEffect(() => {
		const pathname = window.location.pathname
		if (pathname === prevPathnameRef.current) return // skip hydration
		prevPathnameRef.current = pathname

		if (!ctx._seamHeadMap || !ctx._seamLeafPaths) return
		const matched = matchSeamRoute(ctx._seamLeafPaths, pathname)
		if (!matched) {
			clearHead()
			return
		}

		const headDef = ctx._seamHeadMap.get(matched.path)
		if (!headDef) {
			clearHead()
			return
		}

		const config = typeof headDef === 'function' ? headDef(seamData) : headDef
		updateHead(config)
	})

	return (
		<SeamNavigateProvider value={navigate}>
			<SeamDataProvider value={seamData}>{children}</SeamDataProvider>
		</SeamNavigateProvider>
	)
}
