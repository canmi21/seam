/* src/query/react/src/__tests__/provider.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SeamQueryProvider } from '../provider.js'

describe('SeamQueryProvider', () => {
	const mockRpc = vi.fn()

	it('renders children', () => {
		render(
			<SeamQueryProvider rpcFn={mockRpc}>
				<div data-testid="child">hello</div>
			</SeamQueryProvider>,
		)
		expect(screen.getByTestId('child').textContent).toBe('hello')
	})

	it('hydrates QueryClient cache from initialData', () => {
		const qc = new QueryClient()
		render(
			<SeamQueryProvider
				rpcFn={mockRpc}
				queryClient={qc}
				initialData={{ userData: { name: 'Alice' } }}
				loaderDefs={{ userData: { procedure: 'getUser', params: { id: '1' } } }}
			>
				<div />
			</SeamQueryProvider>,
		)
		expect(qc.getQueryData(['getUser', { id: '1' }])).toEqual({ name: 'Alice' })
	})

	it('skips hydration when no initialData', () => {
		const qc = new QueryClient()
		render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div />
			</SeamQueryProvider>,
		)
		expect(qc.getQueryData(['getUser', {}])).toBeUndefined()
	})
})
