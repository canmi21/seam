/* src/query/react/src/__tests__/provider.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeamQueryProvider } from '../provider.js'

describe('SeamQueryProvider', () => {
	const mockRpc = vi.fn()

	afterEach(() => {
		document.getElementById('__data')?.remove()
		document.getElementById('custom')?.remove()
	})

	function injectDataScript(id: string, data: Record<string, unknown>) {
		const el = document.createElement('script')
		el.id = id
		el.type = 'application/json'
		el.textContent = JSON.stringify(data)
		document.body.appendChild(el)
	}

	it('renders children', () => {
		render(
			<SeamQueryProvider rpcFn={mockRpc}>
				<div data-testid="child">hello</div>
			</SeamQueryProvider>,
		)
		expect(screen.getByTestId('child').textContent).toBe('hello')
	})

	it('auto-hydrates QueryClient from __data DOM element', () => {
		injectDataScript('__data', {
			userData: { name: 'Alice' },
			__loaders: {
				userData: { procedure: 'getUser', input: { id: '1' } },
			},
		})
		const qc = new QueryClient()
		render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div />
			</SeamQueryProvider>,
		)
		expect(qc.getQueryData(['getUser', { id: '1' }])).toEqual({ name: 'Alice' })
	})

	it('respects custom dataId prop', () => {
		injectDataScript('custom', {
			posts: [{ id: 1 }],
			__loaders: {
				posts: { procedure: 'listPosts', input: {} },
			},
		})
		const qc = new QueryClient()
		render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc} dataId="custom">
				<div />
			</SeamQueryProvider>,
		)
		expect(qc.getQueryData(['listPosts', {}])).toEqual([{ id: 1 }])
	})

	it('skips hydration when no __data element exists', () => {
		const qc = new QueryClient()
		render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div />
			</SeamQueryProvider>,
		)
		expect(qc.getQueryData(['getUser', {}])).toBeUndefined()
	})
})
