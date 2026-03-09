/* src/router/tanstack/src/bridge-helpers.ts */

import type { HeadConfig, HeadFn } from '@canmi/seam-react'
import { matchSeamRoute } from './route-matcher.js'
import { updateHead, clearHead } from './head-manager.js'

/** Merge loaderData from all matched routes (layout + page levels) */
export function mergeLoaderData(matches: { loaderData?: unknown }[]): Record<string, unknown> {
	const merged: Record<string, unknown> = {}
	for (const match of matches) {
		const ld = match.loaderData as Record<string, unknown> | undefined
		if (ld && typeof ld === 'object') Object.assign(merged, ld)
	}
	return (merged.page ?? merged) as Record<string, unknown>
}

/** Apply head update for the current pathname. Returns false if skipped (same pathname). */
export function applyHeadUpdate(
	pathname: string,
	prevPathname: string,
	headMap: Map<string, HeadConfig | HeadFn> | undefined,
	leafPaths: string[] | undefined,
	seamData: Record<string, unknown>,
): boolean {
	if (pathname === prevPathname) return false
	if (!headMap || !leafPaths) return true

	const matched = matchSeamRoute(leafPaths, pathname)
	if (!matched) {
		clearHead()
		return true
	}

	const headDef = headMap.get(matched.path)
	if (!headDef) {
		clearHead()
		return true
	}

	const config = typeof headDef === 'function' ? headDef(seamData) : headDef
	updateHead(config)
	return true
}
