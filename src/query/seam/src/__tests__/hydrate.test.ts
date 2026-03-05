/* src/query/seam/src/__tests__/hydrate.test.ts */

import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it } from 'vitest'
import { hydrateFromSeamData } from '../hydrate.js'

describe('hydrateFromSeamData', () => {
	it('writes loader data into QueryClient cache', () => {
		const qc = new QueryClient()
		const seamData = {
			userData: { name: 'Alice' },
			postList: [{ id: 1 }],
		}
		const loaderDefs = {
			userData: { procedure: 'getUser', params: { id: '1' } },
			postList: { procedure: 'listPosts' },
		}
		hydrateFromSeamData(qc, seamData, loaderDefs)
		expect(qc.getQueryData(['getUser', { id: '1' }])).toEqual({ name: 'Alice' })
		expect(qc.getQueryData(['listPosts', {}])).toEqual([{ id: 1 }])
	})

	it('skips undefined data entries', () => {
		const qc = new QueryClient()
		const seamData = { userData: { name: 'Bob' } }
		const loaderDefs = {
			userData: { procedure: 'getUser' },
			missing: { procedure: 'getMissing' },
		}
		hydrateFromSeamData(qc, seamData, loaderDefs)
		expect(qc.getQueryData(['getUser', {}])).toEqual({ name: 'Bob' })
		expect(qc.getQueryData(['getMissing', {}])).toBeUndefined()
	})

	it('handles empty loaderDefs without error', () => {
		const qc = new QueryClient()
		hydrateFromSeamData(qc, { foo: 'bar' }, {})
		// no error thrown
	})
})
