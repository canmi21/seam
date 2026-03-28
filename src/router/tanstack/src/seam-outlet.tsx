/* src/router/tanstack/src/seam-outlet.tsx */

import type { ComponentType, ReactNode } from 'react'
import { Match, useLoaderData, useMatch, useRouterState } from '@tanstack/react-router'
import type { LoaderDef } from '@canmi/seam-react'
import { SeamDataProvider, SeamHandoffProvider } from '@canmi/seam-react'
import { cacheLoaderData } from '@canmi/seam-query'
import { buildInput } from './create-loader.js'

/**
 * Drop-in replacement for TanStack Router's Outlet that skips the
 * <Suspense> wrapper on root routes.  The standard Outlet always wraps
 * root-route children in <Suspense>, which injects <!--$-->…<!--/$-->
 * comment markers into the DOM.  CTR-rendered HTML doesn't contain
 * those markers, so hydration fails with a mismatch.
 */
export function SeamOutlet() {
	const matchId = useMatch({ strict: false, select: (m) => m.id })
	const childMatchId = useRouterState({
		select: (s) => {
			const matches = s.matches
			const idx = matches.findIndex((d) => d.id === matchId)
			return matches[idx + 1]?.id
		},
	})

	if (!childMatchId) return null
	return <Match matchId={childMatchId} />
}

/**
 * Wrap a layout component so it receives <SeamOutlet /> as children.
 * When the layout has loaders, wrap with SeamDataProvider so useSeamData()
 * returns layout-scoped data within the layout component.
 */
export function createLayoutWrapper(
	Layout: ComponentType<{ children: ReactNode }>,
	loaders: Record<string, LoaderDef> = {},
	handoffKeys: string[] = [],
) {
	const hasLoaders = Object.keys(loaders).length > 0
	if (hasLoaders) {
		return function LayoutWrapperWithData() {
			const data: unknown = useLoaderData({ strict: false })
			const params = useMatch({
				strict: false,
				select: (match) => match.params as Record<string, string>,
			})
			seedLoaderCache(data, loaders, params)
			return (
				<SeamHandoffProvider value={handoffKeys}>
					<SeamDataProvider value={data}>
						<Layout>
							<SeamOutlet />
						</Layout>
					</SeamDataProvider>
				</SeamHandoffProvider>
			)
		}
	}

	return function LayoutWrapper() {
		return (
			<Layout>
				<SeamOutlet />
			</Layout>
		)
	}
}

/** Wrap a page component with SeamDataProvider so useSeamData() returns page-scoped data */
export function createPageWrapper(
	Page: ComponentType,
	loaders: Record<string, LoaderDef> = {},
	handoffKeys: string[] = [],
) {
	return function PageWrapper() {
		const data: unknown = useLoaderData({ strict: false })
		const params = useMatch({
			strict: false,
			select: (match) => match.params as Record<string, string>,
		})
		seedLoaderCache(data, loaders, params)
		return (
			<SeamHandoffProvider value={handoffKeys}>
				<SeamDataProvider value={data}>
					<Page />
				</SeamDataProvider>
			</SeamHandoffProvider>
		)
	}
}

function seedLoaderCache(
	data: unknown,
	loaders: Record<string, LoaderDef>,
	params: Record<string, string>,
) {
	if (!data || typeof data !== 'object') return
	for (const [key, def] of Object.entries(loaders)) {
		const value = (data as Record<string, unknown>)[key]
		if (value === undefined) continue
		cacheLoaderData(def.procedure, buildInput(def, params), value)
	}
}
