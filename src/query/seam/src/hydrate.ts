/* src/query/seam/src/hydrate.ts */

import type { QueryClient } from '@tanstack/query-core'

/** Hydrate QueryClient cache from server-rendered __data with __loaders metadata. */
export function hydrateFromSeamData(
	queryClient: QueryClient,
	seamData: Record<string, unknown>,
): void {
	const loaders = seamData.__loaders as
		| Record<string, { procedure: string; input: unknown }>
		| undefined
	if (!loaders) return
	for (const [key, meta] of Object.entries(loaders)) {
		const data = seamData[key]
		if (data === undefined) continue
		queryClient.setQueryData([meta.procedure, meta.input], data)
	}
}
