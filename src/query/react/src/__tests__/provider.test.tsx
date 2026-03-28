/* src/query/react/src/__tests__/provider.test.tsx */
// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheLoaderData, clearSharedQueryClient } from '@canmi/seam-query'
import { SeamQueryProvider } from '../provider.js'

const mockRpc = vi.fn()

afterEach(() => {
	document.getElementById('__data')?.remove()
	document.getElementById('custom')?.remove()
	clearSharedQueryClient()
})

function injectDataScript(id: string, data: Record<string, unknown>) {
	const el = document.createElement('script')
	el.id = id
	el.type = 'application/json'
	el.textContent = JSON.stringify(data)
	document.body.appendChild(el)
}

describe('SeamQueryProvider rendering', () => {
	it('renders children', () => {
		render(
			<SeamQueryProvider rpcFn={mockRpc}>
				<div data-testid="child">hello</div>
			</SeamQueryProvider>,
		)
		expect(screen.getByTestId('child').textContent).toBe('hello')
	})
})

describe('SeamQueryProvider hydration', () => {
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

	it('hydrates only once across re-renders', () => {
		injectDataScript('__data', {
			userData: { name: 'Alice' },
			__loaders: {
				userData: { procedure: 'getUser', input: { id: '1' } },
			},
		})
		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'setQueryData')
		const { rerender } = render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div />
			</SeamQueryProvider>,
		)
		const callCount = spy.mock.calls.length
		expect(callCount).toBeGreaterThan(0)
		rerender(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div />
			</SeamQueryProvider>,
		)
		expect(spy.mock.calls.length).toBe(callCount)
	})
})

describe('SeamQueryProvider edge cases', () => {
	it('survives malformed JSON in __data', () => {
		const el = document.createElement('script')
		el.id = '__data'
		el.type = 'application/json'
		el.textContent = '{invalid json!!!'
		document.body.appendChild(el)

		const qc = new QueryClient()
		const spy = vi.spyOn(qc, 'setQueryData')
		render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div data-testid="malformed">ok</div>
			</SeamQueryProvider>,
		)
		expect(screen.getByTestId('malformed').textContent).toBe('ok')
		expect(spy).not.toHaveBeenCalled()
	})

	it('registers the active QueryClient for shared cache writes', () => {
		const qc = new QueryClient()
		render(
			<SeamQueryProvider rpcFn={mockRpc} queryClient={qc}>
				<div />
			</SeamQueryProvider>,
		)

		cacheLoaderData('getUser', { id: '1' }, { name: 'Alice' })
		expect(qc.getQueryData(['getUser', { id: '1' }])).toEqual({ name: 'Alice' })
	})
})
