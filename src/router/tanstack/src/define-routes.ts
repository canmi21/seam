/* src/router/tanstack/src/define-routes.ts */

import type { LoaderDef } from '@canmi/seam-react'
import type { SeamRouteDef } from './types.js'

export function defineSeamRoutes(routes: SeamRouteDef[]): SeamRouteDef[] {
	return routes
}

/**
 * Define a single route with compile-time validation of derive sources.
 *
 * The generic L captures the literal keys of `loaders`, constraining
 * `derive.*.sources` to only reference existing loader keys.
 * Routes without derive can use plain object literals in defineSeamRoutes.
 */
type SeamRouteWithDerive<L extends Record<string, LoaderDef>> = Omit<
	SeamRouteDef,
	'loaders' | 'derive'
> & {
	loaders: L
	derive?: Record<
		string,
		{
			sources: (keyof L & string)[]
			fn: (...args: unknown[]) => unknown
			output?: Record<string, unknown>
		}
	>
}

export function seamRoute<L extends Record<string, LoaderDef>>(
	route: SeamRouteWithDerive<L>,
): SeamRouteDef {
	return route as SeamRouteDef
}
