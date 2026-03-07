/* src/query/seam/src/__tests__/hydrate.test.ts */

import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it } from 'vitest'
import { hydrateFromSeamData } from '../hydrate.js'

describe('hydrateFromSeamData', () => {
	it('writes loader data into QueryClient cache using __loaders metadata', () => {
		const qc = new QueryClient()
		const seamData = {
			userData: { name: 'Alice' },
			postList: [{ id: 1 }],
			__loaders: {
				userData: { procedure: 'getUser', input: { id: '1' } },
				postList: { procedure: 'listPosts', input: {} },
			},
		}
		hydrateFromSeamData(qc, seamData)
		expect(qc.getQueryData(['getUser', { id: '1' }])).toEqual({ name: 'Alice' })
		expect(qc.getQueryData(['listPosts', {}])).toEqual([{ id: 1 }])
	})

	it('skips entries where data is undefined', () => {
		const qc = new QueryClient()
		const seamData = {
			userData: { name: 'Bob' },
			__loaders: {
				userData: { procedure: 'getUser', input: {} },
				missing: { procedure: 'getMissing', input: {} },
			},
		}
		hydrateFromSeamData(qc, seamData)
		expect(qc.getQueryData(['getUser', {}])).toEqual({ name: 'Bob' })
		expect(qc.getQueryData(['getMissing', {}])).toBeUndefined()
	})

	it('does nothing when __loaders is absent', () => {
		const qc = new QueryClient()
		hydrateFromSeamData(qc, { foo: 'bar' })
		// no error thrown, no data set
	})
})
