/* src/query/react/src/use-seam-derive.ts */

import { useQueryClient } from '@tanstack/react-query'
import { getHydratedDerived } from '@canmi/seam-query'
import { useMemo, useRef } from 'react'

export interface DeriveRegistryEntry {
	sources: string[]
	fn: (...args: unknown[]) => unknown
}

export type DeriveRegistry = Record<string, DeriveRegistryEntry>

/**
 * Read a derived value by key.
 *
 * - First render (CTR): returns server-computed value from hydrated `__derived`
 * - Post-hydration / SPA navigation: if `registry` is provided, computes from
 *   QueryClient cache by looking up each source procedure's latest data
 */
export function useSeamDerive<T = unknown>(key: string, registry?: DeriveRegistry): T | undefined {
	const queryClient = useQueryClient()
	const consumed = useRef(false)

	const entry = registry?.[key]

	// Collect source data from QueryClient cache (partial key match by procedure name)
	const sourceData = (entry?.sources ?? []).map((procName) => {
		const queries = queryClient.getQueriesData<unknown>({ queryKey: [procName] })
		return queries.length > 0 ? (queries[queries.length - 1]?.[1] ?? null) : null
	})

	return useMemo(
		() => {
			// First render: use hydrated server-computed value
			if (!consumed.current) {
				consumed.current = true
				const hydrated = getHydratedDerived()
				if (hydrated?.[key] !== undefined) return hydrated[key] as T
			}

			// Post-hydration: compute from registry + QueryClient cache
			if (!entry || sourceData.some((d) => d === null)) return undefined
			try {
				return entry.fn(...sourceData) as T
			} catch {
				return undefined
			}
		},
		[key, ...sourceData], // spread deps: recompute when any source data changes
	)
}

export { useSeamDerive as useDerive }
