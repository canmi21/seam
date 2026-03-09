/* src/router/tanstack/src/seam-i18n-bridge.tsx */

import { useMatches, useRouter } from '@tanstack/react-router'
import { SeamDataProvider, SeamNavigateProvider } from '@canmi/seam-react'
import { I18nProvider, SwitchLocaleProvider } from '@canmi/seam-i18n/react'
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SeamRouterContext } from './types.js'
import { mergeLoaderData, applyHeadUpdate } from './bridge-helpers.js'
import { useI18nState } from './use-i18n-state.js'

/**
 * InnerWrap component that bridges TanStack Router's loaderData to SeamDataProvider
 * and provides SPA navigation via SeamNavigateProvider.
 * Manages i18n state: initial load from __data, SPA updates via RPC + cache.
 */
export function SeamI18nBridge({ children }: { children: ReactNode }) {
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
	const leafPaths = ctx._seamLeafPaths
	const rawPathname = matches.length > 0 ? (matches.at(-1)?.pathname ?? '/') : '/'

	const { i18n, currentRouteHash, onMessages, currentPathname } = useI18nState(
		ctx,
		router.basepath,
		rawPathname,
		leafPaths,
	)

	// Head metadata update on SPA navigation
	const headPathnameRef = useRef(currentPathname)
	useEffect(() => {
		if (
			applyHeadUpdate(
				currentPathname,
				headPathnameRef.current,
				ctx._seamHeadMap,
				leafPaths,
				seamData,
			)
		) {
			headPathnameRef.current = currentPathname
		}
	}, [currentPathname, ctx._seamHeadMap, leafPaths, seamData])

	let content = <SeamDataProvider value={seamData}>{children}</SeamDataProvider>
	if (i18n) {
		const switchCtx = {
			rpc: ctx.seamRpc,
			routeHash: currentRouteHash ?? '',
			onMessages,
		}
		content = (
			<SwitchLocaleProvider value={switchCtx}>
				<I18nProvider value={i18n}>{content}</I18nProvider>
			</SwitchLocaleProvider>
		)
	}

	return <SeamNavigateProvider value={navigate}>{content}</SeamNavigateProvider>
}
