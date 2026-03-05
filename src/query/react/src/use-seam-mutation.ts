/* src/query/react/src/use-seam-mutation.ts */

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query'
import { createSeamMutationOptions, invalidateFromConfig } from '@canmi/seam-query'
import { useSeamQueryContext } from './provider.js'

export function useSeamMutation(
  procedureName: string,
  options?: Partial<UseMutationOptions>,
): UseMutationResult {
  const { rpcFn, config } = useSeamQueryContext()
  const queryClient = useQueryClient()
  const procConfig = config?.[procedureName]
  const coreOptions = createSeamMutationOptions(rpcFn, procedureName, queryClient, procConfig)

  const mergedOnSuccess = options?.onSuccess
    ? (data: unknown, variables: unknown, context: unknown) => {
        invalidateFromConfig(queryClient, procConfig, variables)
        ;(options.onSuccess as (d: unknown, v: unknown, c: unknown) => void)(
          data,
          variables,
          context,
        )
      }
    : coreOptions.onSuccess

  return useMutation({
    ...coreOptions,
    ...options,
    onSuccess: mergedOnSuccess,
  } as UseMutationOptions)
}
