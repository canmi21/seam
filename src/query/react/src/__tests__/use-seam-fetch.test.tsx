/* src/query/react/src/__tests__/use-seam-fetch.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { SeamQueryProvider } from '../provider.js'
import { useSeamFetch, useFetch } from '../use-seam-fetch.js'

function createWrapper() {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const rpcFn = vi.fn().mockResolvedValue({ items: [1, 2] })
	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<SeamQueryProvider rpcFn={rpcFn} queryClient={qc}>
				{children}
			</SeamQueryProvider>
		)
	}
	return { Wrapper, rpcFn, qc }
}

describe('useSeamFetch', () => {
	it('maps data/pending/error from useQuery result', async () => {
		const { Wrapper } = createWrapper()
		const { result } = renderHook(() => useSeamFetch('listItems', {}), {
			wrapper: Wrapper,
		})
		expect(result.current.pending).toBe(true)
		await waitFor(() => expect(result.current.pending).toBe(false))
		expect(result.current.data).toEqual({ items: [1, 2] })
		expect(result.current.error).toBeNull()
	})

	it('defaults to empty input when input is omitted', async () => {
		const { Wrapper, rpcFn } = createWrapper()
		renderHook(() => useSeamFetch('listItems'), { wrapper: Wrapper })
		await waitFor(() => expect(rpcFn).toHaveBeenCalled())
		expect(rpcFn).toHaveBeenCalledWith('listItems', {})
	})

	it('exports useFetch as alias', () => {
		expect(useFetch).toBe(useSeamFetch)
	})
})
