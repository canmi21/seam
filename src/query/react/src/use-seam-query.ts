/* src/query/react/src/use-seam-query.ts */

import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'
import { createSeamQueryOptions, type SeamQueryConfig } from '@canmi/seam-query'
import { useSeamQueryContext } from './provider.js'

export function useSeamQuery(
  procedureName: string,
  input: unknown,
  options?: Partial<UseQueryOptions> & SeamQueryConfig,
): UseQueryResult {
  const { rpcFn, config } = useSeamQueryContext()
  const procConfig = config?.[procedureName]
  const queryOptions = createSeamQueryOptions(rpcFn, procedureName, input, procConfig, options)
  return useQuery({ ...queryOptions, ...options } as UseQueryOptions)
}
