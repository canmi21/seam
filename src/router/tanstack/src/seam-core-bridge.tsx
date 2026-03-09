/* src/router/tanstack/src/seam-core-bridge.tsx */

import { useMatches, useRouter } from '@tanstack/react-router'
import { SeamDataProvider, SeamNavigateProvider } from '@canmi/seam-react'
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SeamRouterContext } from './types.js'
import { mergeLoaderData, applyHeadUpdate } from './bridge-helpers.js'

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
		applyHeadUpdate(
			pathname,
			prevPathnameRef.current,
			ctx._seamHeadMap,
			ctx._seamLeafPaths,
			seamData,
		)
		prevPathnameRef.current = pathname
	})

	return (
		<SeamNavigateProvider value={navigate}>
			<SeamDataProvider value={seamData}>{children}</SeamDataProvider>
		</SeamNavigateProvider>
	)
}
