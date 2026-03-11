/* src/router/tanstack/src/create-router.ts */

import {
	createRouter as createTanStackRouter,
	createRootRouteWithContext,
	createRoute,
} from '@tanstack/react-router'
import type { AnyRoute } from '@tanstack/react-router'
import { createElement, type ComponentType } from 'react'
import { seamRpc } from '@canmi/seam-client'
import type {
	LazyComponentLoader,
	LoaderDef,
	RouteDef,
	HeadConfig,
	HeadFn,
} from '@canmi/seam-react'
import { parseSeamData, mergeHeadConfigs } from '@canmi/seam-react'
import { SeamOutlet, createLayoutWrapper, createPageWrapper } from './seam-outlet.js'
import { convertPath } from './convert-routes.js'
import { createLoaderFromDefs, createPrerenderLoader } from './create-loader.js'
import { matchSeamRoute } from './route-matcher.js'
import { SeamCoreBridge } from './seam-core-bridge.js'
import type { SeamRouteDef, SeamRouterOptions, SeamRouterContext, SeamI18nMeta } from './types.js'

/** Check if a component is a lazy loader (tagged by the bundler's page-split transform) */
export function isLazyLoader(c: unknown): c is LazyComponentLoader {
	return typeof c === 'function' && (c as unknown as Record<string, unknown>).__seamLazy === true
}

/** Cache of resolved lazy components, keyed by route path */
const lazyComponentCache = new Map<string, ComponentType>()

function joinRoutePaths(parentPath: string, childPath: string): string {
	if (childPath === '/') return parentPath || '/'
	if (!parentPath || parentPath === '/') return childPath
	return `${parentPath}${childPath}`
}

function hasRoutePath(path: string | undefined): path is string {
	return !!path
}

function isPathfulLayout(path: string | undefined): path is string {
	return hasRoutePath(path) && path !== '/'
}

/** Extract all leaf paths from a potentially nested route tree, joining parent prefixes */
export function collectLeafPaths(defs: RouteDef[], parentPath = ''): string[] {
	const paths: string[] = []
	for (const d of defs) {
		const isGrouping = d.children && !d.layout && !d.component
		const full = joinRoutePaths(parentPath, d.path)
		if (d.children) {
			const childParentPath = isGrouping || d.layout ? full : parentPath
			paths.push(...collectLeafPaths(d.children, childParentPath))
		} else {
			paths.push(full)
		}
	}
	return paths
}

/** Collect head definitions from a route tree, keyed by full path.
 *  Layout head is inherited by child routes and merged with child-level head. */
export function collectHeadMap(
	defs: RouteDef[],
	parentPath = '',
	inheritedHead?: HeadConfig | HeadFn,
): Map<string, HeadConfig | HeadFn> {
	const map = new Map<string, HeadConfig | HeadFn>()
	for (const d of defs) {
		const isGrouping = d.children && !d.layout && !d.component
		const full = joinRoutePaths(parentPath, d.path)

		if (d.layout && d.children) {
			// Layout node: merge inherited + layout head, propagate to children
			const mergedHead = mergeHeadConfigs(inheritedHead, d.head)
			// If layout also has a component (split page), store merged head at this path
			if (d.component) {
				const finalHead = mergeHeadConfigs(mergedHead, undefined)
				if (finalHead) map.set(full, finalHead)
			}
			for (const [k, v] of collectHeadMap(d.children, full, mergedHead)) {
				map.set(k, v)
			}
		} else if (d.children) {
			// Grouping node: pass through inherited head
			for (const [k, v] of collectHeadMap(
				d.children,
				isGrouping ? full : parentPath,
				inheritedHead,
			)) {
				map.set(k, v)
			}
		} else {
			// Leaf: merge inherited head with leaf head
			const finalHead = mergeHeadConfigs(inheritedHead, d.head)
			if (finalHead) map.set(full, finalHead)
		}
	}
	return map
}

/** Extract loader keys marked as handoff: "client" */
function extractHandoffKeys(loaders: Record<string, LoaderDef>): string[] {
	return Object.entries(loaders)
		.filter(([, def]) => def.handoff === 'client')
		.map(([key]) => key)
}

/** Extract boundary component fields for createRoute(), cast to satisfy TanStack generic constraints */
function boundaryFields(def: SeamRouteDef) {
	// TanStack Router's createRoute() uses complex generics for these fields;
	// casting avoids no-unsafe-assignment when spreading into the options object.
	const fields: Record<string, unknown> = {}
	if (def.errorComponent) fields.errorComponent = def.errorComponent
	if (def.pendingComponent) fields.pendingComponent = def.pendingComponent
	if (def.notFoundComponent) fields.notFoundComponent = def.notFoundComponent
	return fields
}

/** Recursively build TanStack Router route tree from SeamJS route definitions */
function buildRoutes(
	defs: SeamRouteDef[],
	parent: AnyRoute,
	pages?: Record<string, ComponentType>,
	parentPath = '',
): AnyRoute[] {
	return defs.map((def) => {
		if (def.layout && def.children) {
			// Layout nodes may be pathful (participate in URL matching) or pathless
			// (wrapper-only). Use a stable custom ID either way so nested index
			// children do not collide after TanStack normalization.
			const segment =
				def.path === '/' ? 'root' : def.path.replace(/^\/|\/$/g, '').replace(/\//g, '-')
			const layoutId = def._layoutId ?? `_layout_${segment}`
			const loaders = def.loaders ?? {}
			const hasLoaders = Object.keys(loaders).length > 0
			const handoffKeys = extractHandoffKeys(loaders)
			const fullPath = joinRoutePaths(parentPath, def.path)
			const routeOptions = isPathfulLayout(def.path)
				? { path: convertPath(def.path) }
				: { id: layoutId }
			const layoutRoute = createRoute({
				getParentRoute: () => parent,
				...routeOptions,
				component: createLayoutWrapper(def.layout, hasLoaders, handoffKeys),
				loader: hasLoaders ? createLoaderFromDefs(loaders, fullPath, layoutId) : undefined,
				staleTime: def.staleTime,
				...boundaryFields(def),
			})
			const childParentPath = isPathfulLayout(def.path) ? fullPath : parentPath
			const children = buildRoutes(def.children, layoutRoute, pages, childParentPath)
			return layoutRoute.addChildren(children)
		}

		// Path grouping node — has children but no layout/component.
		// Creates a path-only route that groups children under a common prefix.
		// Must render SeamOutlet so TanStack Router can display child matches.
		// Children have relative paths, so accumulate parentPath.
		if (def.children && !def.component) {
			const fullPrefix = joinRoutePaths(parentPath, def.path)
			const groupRoute = createRoute({
				getParentRoute: () => parent,
				path: convertPath(def.path),
				component: SeamOutlet,
			})
			return groupRoute.addChildren(buildRoutes(def.children, groupRoute, pages, fullPrefix))
		}

		// Compute full path for leaf nodes (needed for SSR data matching)
		const fullPath = joinRoutePaths(parentPath, def.path)

		// Leaf node — page route, wrapped with SeamDataProvider for scoped useSeamData()
		const explicitPage = pages?.[fullPath] ?? pages?.[def.path]

		if (!explicitPage && isLazyLoader(def.component)) {
			// Lazy component: resolve in loader (runs before render), cache for reuse
			const lazyLoader = def.component
			const routePath = fullPath
			const clientLoader = def.clientLoader
			const pageHandoffKeys = extractHandoffKeys(def.loaders ?? {})
			const dataLoader = clientLoader
				? (ctx: { params: Record<string, string>; context: SeamRouterContext }) =>
						clientLoader({ params: ctx.params, seamRpc: ctx.context.seamRpc })
				: def.prerender
					? createPrerenderLoader(fullPath)
					: createLoaderFromDefs(def.loaders ?? {}, fullPath)

			return createRoute({
				getParentRoute: () => parent,
				path: convertPath(def.path),
				component: createPageWrapper(function LazyPage() {
					const Resolved = lazyComponentCache.get(routePath)
					if (!Resolved) return null
					return createElement(Resolved)
				}, pageHandoffKeys),
				loader: async (ctx: { params: Record<string, string>; context: SeamRouterContext }) => {
					// Resolve lazy component (cached after first load)
					if (!lazyComponentCache.has(routePath)) {
						const mod = await lazyLoader()
						lazyComponentCache.set(routePath, (mod.default ?? mod) as ComponentType)
					}
					return dataLoader(ctx)
				},
				staleTime: def.staleTime,
				...boundaryFields(def),
			})
		}

		const pageComponent = explicitPage ?? (def.component as ComponentType)
		const pageHandoffKeys = extractHandoffKeys(def.loaders ?? {})
		const cl = def.clientLoader
		return createRoute({
			getParentRoute: () => parent,
			path: convertPath(def.path),
			component: createPageWrapper(pageComponent, pageHandoffKeys),
			loader: cl
				? ({ params, context }: { params: Record<string, string>; context: unknown }) => {
						const ctx = context as SeamRouterContext
						return cl({ params, seamRpc: ctx.seamRpc })
					}
				: def.prerender
					? createPrerenderLoader(fullPath)
					: createLoaderFromDefs(def.loaders ?? {}, fullPath),
			staleTime: def.staleTime,
			...boundaryFields(def),
		})
	})
}

export function createSeamRouter(opts: SeamRouterOptions) {
	const { routes, pages, defaultStaleTime = 30_000, dataId, cleanLocaleQuery } = opts

	if (!routes) {
		throw new Error(
			'routes is required — pass routes explicitly or use seamHydrate() for auto-import',
		)
	}

	// Parse initial data from __data (browser only)
	let initialData: Record<string, unknown> | null = null
	let initialLayouts: Record<string, Record<string, unknown>> = {}
	let initialPath: string | null = null
	let initialParams: Record<string, string> = {}
	let initialI18n: SeamI18nMeta | null = null

	// Detect locale prefix from URL (e.g. /zh/about -> locale "zh", bare "/about")
	let localeBasePath = ''

	if (typeof document !== 'undefined') {
		try {
			const raw = parseSeamData(dataId)
			// Extract layout data stored under _layouts key
			if (raw._layouts && typeof raw._layouts === 'object') {
				initialLayouts = raw._layouts as Record<string, Record<string, unknown>>
			}
			// Page data is everything except _layouts and _i18n
			const { _layouts: _, _i18n: rawI18n, __loaders: _lm, ...pageData } = raw
			initialI18n = (rawI18n as SeamI18nMeta) ?? null
			initialData = pageData as Record<string, unknown>

			// Detect locale prefix: if URL starts with /{locale}/ and i18n data is present
			if (initialI18n) {
				const prefix = `/${initialI18n.locale}`
				const pathname = window.location.pathname
				if (pathname === prefix || pathname.startsWith(prefix + '/')) {
					localeBasePath = prefix
				}
			}

			// Strip locale prefix before matching routes
			let matchPathname = window.location.pathname
			if (localeBasePath) {
				matchPathname = matchPathname.slice(localeBasePath.length) || '/'
			}
			const matched = matchSeamRoute(collectLeafPaths(routes), matchPathname)
			if (matched) {
				initialPath = matched.path
				initialParams = matched.params
			}
		} catch {
			// No __data — not a CTR page
		}
	}

	// SeamOutlet skips the <Suspense> wrapper that standard Outlet adds for root
	// routes — CTR HTML has no Suspense markers so the wrapper causes hydration mismatch.
	const rootRoute = createRootRouteWithContext<SeamRouterContext>()({
		component: SeamOutlet,
	})

	const childRoutes = buildRoutes(routes, rootRoute, pages)
	const routeTree = rootRoute.addChildren(childRoutes)

	const leafPaths = collectLeafPaths(routes)
	const headMap = collectHeadMap(routes)

	const context: SeamRouterContext = {
		seamRpc,
		_seamInitial: initialData
			? {
					path: initialPath,
					params: initialParams,
					data: initialData,
					layouts: initialLayouts,
					consumed: false,
					consumedLayouts: new Set(),
				}
			: null,
		_seamI18n: initialI18n,
		_seamLeafPaths: leafPaths,
		_seamHeadMap: headMap.size > 0 ? headMap : undefined,
		_cleanLocaleQuery:
			cleanLocaleQuery === true
				? 'lang'
				: cleanLocaleQuery === false || cleanLocaleQuery === undefined
					? false
					: cleanLocaleQuery,
	}

	const router = createTanStackRouter({
		routeTree,
		defaultStaleTime,
		context,
		basepath: localeBasePath || undefined,
		InnerWrap: opts.i18nBridge ?? SeamCoreBridge,
	})

	// Bypass Suspense in <Matches> — CTR HTML has no Suspense markers
	;(router as unknown as { ssr: unknown }).ssr = { manifest: undefined }

	return router
}
