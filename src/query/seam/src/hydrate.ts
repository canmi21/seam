/* src/query/seam/src/hydrate.ts */

import type { QueryClient } from '@tanstack/query-core'

export interface LoaderDef {
  procedure: string
  params?: Record<string, unknown>
}

/** Hydrate QueryClient cache from server-rendered __data loader results. */
export function hydrateFromSeamData(
  queryClient: QueryClient,
  seamData: Record<string, unknown>,
  loaderDefs: Record<string, LoaderDef>,
): void {
  for (const [key, def] of Object.entries(loaderDefs)) {
    const data = seamData[key]
    if (data === undefined) continue
    const input = def.params ?? {}
    queryClient.setQueryData([def.procedure, input], data)
  }
}
