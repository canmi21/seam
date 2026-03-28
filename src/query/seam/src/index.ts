/* src/query/seam/src/index.ts */

export { createSeamQueryOptions, resolveStaleTime } from './query-options.js'
export { createSeamMutationOptions, invalidateFromConfig } from './mutation-options.js'
export {
	hydrateFromSeamData,
	getHydratedDerived,
	registerSharedQueryClient,
	unregisterSharedQueryClient,
	clearSharedQueryClient,
	cacheLoaderData,
} from './hydrate.js'
export type {
	ProcedureConfigEntry,
	ProcedureConfigMap,
	ProcedureMetaBase,
	SeamQueryConfig,
	RpcFn,
} from './types.js'
