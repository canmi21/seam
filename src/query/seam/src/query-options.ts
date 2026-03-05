/* src/query/seam/src/query-options.ts */

import type { QueryOptions } from '@tanstack/query-core'
import type { ProcedureConfigEntry, RpcFn, SeamQueryConfig } from './types.js'

/** Resolve staleTime from procedure config and optional overrides. */
export function resolveStaleTime(
	config?: ProcedureConfigEntry,
	overrides?: SeamQueryConfig,
): number | undefined {
	if (overrides?.staleTime !== undefined) return overrides.staleTime
	if (config?.cache === undefined) return undefined
	if (config.cache === false) return 0
	return config.cache.ttl * 1000
}

/** Create TanStack QueryOptions from a procedure name and input. */
export function createSeamQueryOptions<TOutput = unknown>(
	rpcFn: RpcFn,
	procedureName: string,
	input: unknown,
	procedureConfig?: ProcedureConfigEntry,
	overrides?: SeamQueryConfig,
): QueryOptions<TOutput> & { staleTime?: number } {
	const staleTime = resolveStaleTime(procedureConfig, overrides)
	return {
		queryKey: [procedureName, input],
		queryFn: () => rpcFn(procedureName, input) as Promise<TOutput>,
		...(staleTime !== undefined && { staleTime }),
		...(overrides?.gcTime !== undefined && { gcTime: overrides.gcTime }),
	}
}
