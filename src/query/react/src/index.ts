/* src/query/react/src/index.ts */

export { SeamQueryProvider, useSeamQueryContext } from './provider.js'
export type { SeamQueryProviderProps, SeamQueryContextValue } from './provider.js'
export { useSeamQuery } from './use-seam-query.js'
export { useSeamMutation } from './use-seam-mutation.js'

// Re-export core types for convenience
export type {
	ProcedureConfigEntry,
	ProcedureConfigMap,
	SeamQueryConfig,
	RpcFn,
	LoaderDef,
} from '@canmi/seam-query'
