/* src/query/react/src/__tests__/use-seam-derive.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SeamQueryProvider } from '../provider.js'
import { useSeamDerive } from '../use-seam-derive.js'
import type { DeriveRegistry } from '../use-seam-derive.js'
import type { ReactNode } from 'react'

vi.mock('@canmi/seam-query', async () => {
	const actual = await vi.importActual<typeof import('@canmi/seam-query')>('@canmi/seam-query')
	return { ...actual, getHydratedDerived: vi.fn(() => null) }
})

import { getHydratedDerived } from '@canmi/seam-query'

const mockedGetHydratedDerived = vi.mocked(getHydratedDerived)

function createWrapper(qc?: QueryClient) {
	const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const mockRpc = vi.fn().mockResolvedValue({})
	return ({ children }: { children: ReactNode }) => (
		<SeamQueryProvider rpcFn={mockRpc} queryClient={client}>
			{children}
		</SeamQueryProvider>
	)
}

describe('useSeamDerive', () => {
	beforeEach(() => {
		mockedGetHydratedDerived.mockReturnValue(null)
	})

	it('returns hydrated value on first render', () => {
		mockedGetHydratedDerived.mockReturnValue({ totalStars: 42 })
		const { result } = renderHook(() => useSeamDerive('totalStars'), {
			wrapper: createWrapper(),
		})
		expect(result.current).toBe(42)
	})

	it('computes from QueryClient cache when registry is provided', () => {
		const qc = new QueryClient()
		qc.setQueryData(['repoStats', undefined], { stars: 10 })

		const registry: DeriveRegistry = {
			doubled: {
				sources: ['repoStats'],
				fn: (data: unknown) => (data as { stars: number }).stars * 2,
			},
		}

		const { result } = renderHook(() => useSeamDerive('doubled', registry), {
			wrapper: createWrapper(qc),
		})
		expect(result.current).toBe(20)
	})

	it('returns undefined when source data is missing from cache', () => {
		const registry: DeriveRegistry = {
			computed: { sources: ['missingProc'], fn: () => 'should not run' },
		}

		const { result } = renderHook(() => useSeamDerive('computed', registry), {
			wrapper: createWrapper(),
		})
		expect(result.current).toBeUndefined()
	})

	it('returns undefined when key is not in registry', () => {
		const registry: DeriveRegistry = {
			other: { sources: [], fn: () => 'nope' },
		}

		const { result } = renderHook(() => useSeamDerive('nonexistent', registry), {
			wrapper: createWrapper(),
		})
		expect(result.current).toBeUndefined()
	})

	it('catches fn errors and returns undefined', () => {
		const qc = new QueryClient()
		qc.setQueryData(['proc', undefined], { value: 1 })

		const registry: DeriveRegistry = {
			broken: {
				sources: ['proc'],
				fn: () => {
					throw new Error('computation failed')
				},
			},
		}

		const { result } = renderHook(() => useSeamDerive('broken', registry), {
			wrapper: createWrapper(qc),
		})
		expect(result.current).toBeUndefined()
	})
})
