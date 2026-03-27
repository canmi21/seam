/* src/query/seam/src/hydrate.ts */

import type { QueryClient } from '@tanstack/query-core'

// Module-level store for server-computed derive results
let hydratedDerived: Record<string, unknown> | null = null

/** Retrieve hydrated __derived values (set during hydrateFromSeamData). */
export function getHydratedDerived(): Record<string, unknown> | null {
	return hydratedDerived
}

/** Hydrate QueryClient cache from server-rendered __data with __loaders metadata. */
export function hydrateFromSeamData(
	queryClient: QueryClient,
	seamData: Record<string, unknown>,
): void {
	const loaders = seamData.__loaders as
		| Record<string, { procedure: string; input: unknown; error?: boolean }>
		| undefined
	if (!loaders) return
	for (const [key, meta] of Object.entries(loaders)) {
		if (meta.error) continue
		const data = seamData[key]
		if (data === undefined) continue
		queryClient.setQueryData([meta.procedure, meta.input], data)
	}

	// Store __derived for useSeamDerive first-render access
	const derived = seamData.__derived as Record<string, unknown> | undefined
	if (derived) {
		hydratedDerived = derived
	}
}
