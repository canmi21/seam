/* src/query/react/src/index.ts */

export { SeamQueryProvider, useSeamQueryContext } from './provider.js'
export type { SeamQueryProviderProps, SeamQueryContextValue } from './provider.js'
export { useSeamQuery } from './use-seam-query.js'
export { useSeamMutation } from './use-seam-mutation.js'
export { useSeamFetch, useFetch } from './use-seam-fetch.js'
export type { UseSeamFetchResult } from './use-seam-fetch.js'

// Re-export core types for convenience
export type {
	ProcedureConfigEntry,
	ProcedureConfigMap,
	SeamQueryConfig,
	RpcFn,
} from '@canmi/seam-query'
