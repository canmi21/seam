/* src/query/seam/src/index.ts */

export { createSeamQueryOptions, resolveStaleTime } from './query-options.js'
export { createSeamMutationOptions, invalidateFromConfig } from './mutation-options.js'
export { hydrateFromSeamData } from './hydrate.js'
export type { ProcedureConfigEntry, ProcedureConfigMap, SeamQueryConfig, RpcFn } from './types.js'
