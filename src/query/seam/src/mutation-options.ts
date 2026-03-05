/* src/query/seam/src/mutation-options.ts */

import type { MutationOptions, QueryClient } from '@tanstack/query-core'
import type { ProcedureConfigEntry, RpcFn } from './types.js'

/** Build mapped input for precise invalidation using mapping config. */
function buildMappedInput(
  mapping: Record<string, { from: string; each?: boolean }>,
  input: unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  for (const [targetKey, { from }] of Object.entries(mapping)) {
    result[targetKey] = src[from]
  }
  return result
}

/** Invalidate queries based on procedure config invalidates declaration. */
export function invalidateFromConfig(
  queryClient: QueryClient,
  config: ProcedureConfigEntry | undefined,
  input?: unknown,
): void {
  if (!config?.invalidates) return
  for (const target of config.invalidates) {
    if (!target.mapping) {
      void queryClient.invalidateQueries({ queryKey: [target.query] })
    } else {
      // Check for each mappings - invalidate per item
      const hasEach = Object.values(target.mapping).some((v) => v.each)
      if (hasEach) {
        invalidateEachMapping(queryClient, target, input)
      } else {
        const targetInput = buildMappedInput(target.mapping, input)
        void queryClient.invalidateQueries({ queryKey: [target.query, targetInput] })
      }
    }
  }
}

/** Handle `each: true` mappings by invalidating once per array item. */
function invalidateEachMapping(
  queryClient: QueryClient,
  target: NonNullable<ProcedureConfigEntry['invalidates']>[number],
  input: unknown,
): void {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const mapping = target.mapping
  if (!mapping) return

  for (const [targetKey, cfg] of Object.entries(mapping)) {
    if (!cfg.each) continue
    const arr = src[cfg.from]
    if (!Array.isArray(arr)) continue
    for (const item of arr as unknown[]) {
      const targetInput: Record<string, unknown> = { [targetKey]: item }
      for (const [k, v] of Object.entries(mapping)) {
        if (!v.each) {
          targetInput[k] = src[v.from]
        }
      }
      void queryClient.invalidateQueries({ queryKey: [target.query, targetInput] })
    }
  }
}

/** Create TanStack MutationOptions with automatic invalidation. */
export function createSeamMutationOptions<TInput = unknown, TOutput = unknown>(
  rpcFn: RpcFn,
  procedureName: string,
  queryClient: QueryClient,
  procedureConfig?: ProcedureConfigEntry,
): MutationOptions<TOutput, Error, TInput> {
  return {
    mutationKey: [procedureName],
    mutationFn: (input) => rpcFn(procedureName, input) as Promise<TOutput>,
    onSuccess: (_data, input) => {
      invalidateFromConfig(queryClient, procedureConfig, input)
    },
  }
}
