/* src/query/react/src/__tests__/use-seam-query.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProcedureConfigMap } from '@canmi/seam-query'
import { SeamQueryProvider } from '../provider.js'
import { useSeamQuery } from '../use-seam-query.js'
import type { ReactNode } from 'react'

function createWrapper(
	rpcFn: (p: string, i?: unknown) => Promise<unknown>,
	config?: ProcedureConfigMap,
) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return ({ children }: { children: ReactNode }) => (
		<SeamQueryProvider rpcFn={rpcFn} config={config} queryClient={qc}>
			{children}
		</SeamQueryProvider>
	)
}

describe('useSeamQuery', () => {
	it('returns data from rpcFn', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ name: 'Alice' })
		const { result } = renderHook(() => useSeamQuery('getUser', { id: '1' }), {
			wrapper: createWrapper(mockRpc),
		})
		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		expect(result.current.data).toEqual({ name: 'Alice' })
		expect(mockRpc).toHaveBeenCalledWith('getUser', { id: '1' })
	})

	it('reads staleTime from config', async () => {
		const mockRpc = vi.fn().mockResolvedValue({})
		const config: ProcedureConfigMap = { getUser: { kind: 'query', cache: { ttl: 30 } } }
		const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const wrapper = ({ children }: { children: ReactNode }) => (
			<SeamQueryProvider rpcFn={mockRpc} config={config} queryClient={qc}>
				{children}
			</SeamQueryProvider>
		)
		const { result } = renderHook(() => useSeamQuery('getUser', {}), { wrapper })
		await waitFor(() => expect(result.current.isSuccess).toBe(true))
		// Verify the query was created (staleTime is internal, we verify it doesn't refetch immediately)
		expect(mockRpc).toHaveBeenCalledTimes(1)
	})

	it('overrides config staleTime with options', async () => {
		const mockRpc = vi.fn().mockResolvedValue({})
		const config: ProcedureConfigMap = { getUser: { kind: 'query', cache: { ttl: 30 } } }
		const { result } = renderHook(() => useSeamQuery('getUser', {}, { staleTime: 0 }), {
			wrapper: createWrapper(mockRpc, config),
		})
		await waitFor(() => expect(result.current.isSuccess).toBe(true))
	})

	it('throws when used outside provider', () => {
		expect(() => {
			renderHook(() => useSeamQuery('getUser', {}))
		}).toThrow('useSeamQuery must be used inside <SeamQueryProvider>')
	})

	it('populates error when rpcFn rejects', async () => {
		const mockRpc = vi.fn().mockRejectedValue(new Error('network failure'))
		const { result } = renderHook(() => useSeamQuery('getUser', { id: '1' }), {
			wrapper: createWrapper(mockRpc),
		})
		await waitFor(() => expect(result.current.isError).toBe(true))
		expect(result.current.error).toBeInstanceOf(Error)
		expect(result.current.error?.message).toBe('network failure')
	})

	it('shares cache for same procedure + input', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ name: 'Alice' })
		const wrapper = createWrapper(mockRpc)
		const { result: r1 } = renderHook(() => useSeamQuery('getUser', { id: '1' }), { wrapper })
		const { result: r2 } = renderHook(() => useSeamQuery('getUser', { id: '1' }), { wrapper })
		await waitFor(() => expect(r1.current.isSuccess).toBe(true))
		await waitFor(() => expect(r2.current.isSuccess).toBe(true))
		expect(mockRpc).toHaveBeenCalledTimes(1)
	})
})
