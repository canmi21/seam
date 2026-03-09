/* src/query/react/src/__tests__/use-seam-mutation.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProcedureConfigMap } from '@canmi/seam-query'
import { SeamQueryProvider } from '../provider.js'
import { useSeamMutation } from '../use-seam-mutation.js'
import type { ReactNode } from 'react'

function createWrapper(
	rpcFn: (p: string, i?: unknown) => Promise<unknown>,
	config?: ProcedureConfigMap,
) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return {
		wrapper: ({ children }: { children: ReactNode }) => (
			<SeamQueryProvider rpcFn={rpcFn} config={config} queryClient={qc}>
				{children}
			</SeamQueryProvider>
		),
		qc,
	}
}

describe('useSeamMutation', () => {
	it('calls rpcFn on mutate', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ ok: true })
		const { wrapper } = createWrapper(mockRpc)
		const { result } = renderHook(() => useSeamMutation('updatePost'), { wrapper })
		await act(() => result.current.mutateAsync({ postId: '1' }))
		expect(mockRpc).toHaveBeenCalledWith('updatePost', { postId: '1' })
	})

	it('auto-invalidates on success', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ ok: true })
		const config: ProcedureConfigMap = {
			updatePost: { kind: 'command', invalidates: [{ query: 'getPost' }] },
		}
		const { wrapper, qc } = createWrapper(mockRpc, config)
		const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const { result } = renderHook(() => useSeamMutation('updatePost'), { wrapper })
		await act(() => result.current.mutateAsync({ postId: '1' }))
		expect(spy).toHaveBeenCalledWith({ queryKey: ['getPost'] })
	})

	it('runs user onSuccess alongside auto-invalidation', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ ok: true })
		const config: ProcedureConfigMap = {
			updatePost: { kind: 'command', invalidates: [{ query: 'getPost' }] },
		}
		const { wrapper, qc } = createWrapper(mockRpc, config)
		vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
		const userOnSuccess = vi.fn()
		const { result } = renderHook(
			() => useSeamMutation('updatePost', { onSuccess: userOnSuccess }),
			{ wrapper },
		)
		await act(() => result.current.mutateAsync({ postId: '1' }))
		expect(userOnSuccess).toHaveBeenCalled()
	})

	it('does not invalidate when no config', async () => {
		const mockRpc = vi.fn().mockResolvedValue({ ok: true })
		const { wrapper, qc } = createWrapper(mockRpc)
		const spy = vi.spyOn(qc, 'invalidateQueries')
		const { result } = renderHook(() => useSeamMutation('deleteUser'), { wrapper })
		await act(() => result.current.mutateAsync({ userId: '1' }))
		expect(spy).not.toHaveBeenCalled()
	})

	it('populates error when rpcFn rejects', async () => {
		const mockRpc = vi.fn().mockRejectedValue(new Error('server error'))
		const { wrapper } = createWrapper(mockRpc)
		const { result } = renderHook(() => useSeamMutation('updatePost'), { wrapper })
		act(() => result.current.mutate({ postId: '1' }))
		await waitFor(() => expect(result.current.isError).toBe(true))
		expect(result.current.error).toBeInstanceOf(Error)
		expect(result.current.error?.message).toBe('server error')
	})

	it('calls user onError when rpcFn rejects', async () => {
		const mockRpc = vi.fn().mockRejectedValue(new Error('fail'))
		const userOnError = vi.fn()
		const { wrapper } = createWrapper(mockRpc)
		const { result } = renderHook(() => useSeamMutation('updatePost', { onError: userOnError }), {
			wrapper,
		})
		act(() => result.current.mutate({ postId: '1' }))
		await waitFor(() => expect(userOnError).toHaveBeenCalled())
		const [err] = userOnError.mock.calls[0]
		expect(err).toBeInstanceOf(Error)
		expect(err.message).toBe('fail')
	})
})
