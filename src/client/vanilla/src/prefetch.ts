/* src/client/vanilla/src/prefetch.ts */

import { seamRpc } from './rpc.js'
import { getFromCache, storePending } from './prefetch-cache.js'

type RouteProcedureEntry = {
  all: readonly string[]
  prefetchable: Record<string, { ttl: number; params: readonly string[] }>
}
type RouteProcedureMap = Record<string, RouteProcedureEntry>

export function prefetchRoute(
  routeMap: RouteProcedureMap,
  routePattern: string,
  params?: Record<string, string>,
): void {
  const route = routeMap[routePattern]
  if (!route) return

  for (const [procedure, config] of Object.entries(route.prefetchable)) {
    const input: Record<string, unknown> = {}
    for (const key of config.params) {
      if (params?.[key] !== undefined) input[key] = params[key]
    }

    if (getFromCache(procedure, input) !== undefined) continue
    const promise = seamRpc(procedure, input)
    storePending(procedure, input, promise, config.ttl)
  }
}
