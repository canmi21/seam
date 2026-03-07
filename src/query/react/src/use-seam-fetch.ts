/* src/query/react/src/use-seam-fetch.ts */

import { useSeamQuery } from './use-seam-query.js'
import type { SeamQueryConfig } from '@canmi/seam-query'

export interface UseSeamFetchResult<T = unknown> {
	data: T | undefined
	pending: boolean
	error: Error | null
}

export function useSeamFetch<T = unknown>(
	procedure: string,
	input?: unknown,
	options?: SeamQueryConfig,
): UseSeamFetchResult<T> {
	const result = useSeamQuery(procedure, input ?? {}, options)
	return {
		data: result.data as T | undefined,
		pending: result.isLoading,
		error: result.error,
	}
}

export { useSeamFetch as useFetch }
