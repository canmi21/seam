/* tests/e2e/specs/feature-query-mutation-batch.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

test.describe('feature: batch RPC', () => {
	test('SPA navigation triggers batch with multiple calls', async ({ page }) => {
		const batchRequests: Array<{ calls: unknown[] }> = []

		await page.route('**/_seam/procedure/**', async (route) => {
			const body = route.request().postDataJSON() as { calls?: unknown[] } | null
			if (body?.calls) batchRequests.push(body as { calls: unknown[] })
			await route.continue()
		})

		// Start on /about (no loaders, clean entry)
		await page.goto('/about', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Navigate to home via SPA link — triggers 2 loaders (listTodos + getStats)
		await page.click('a[href="/"]')
		await expect(page.locator('h1')).toHaveText('Query & Mutation Demo', { timeout: 5_000 })

		// Verify a batch request was made with 2+ calls
		expect(batchRequests.length).toBeGreaterThanOrEqual(1)
		expect(batchRequests[0].calls.length).toBeGreaterThanOrEqual(2)
	})

	test('batch response contains results for all calls', async ({ page }) => {
		const batchResults: unknown[][] = []

		page.on('response', async (response) => {
			if (!response.url().includes('_seam/procedure')) return
			try {
				const json = (await response.json()) as {
					ok?: boolean
					data?: { results?: unknown[] }
				}
				if (json?.ok && json?.data?.results) batchResults.push(json.data.results)
			} catch {
				// not JSON, skip
			}
		})

		await page.goto('/about', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('a[href="/"]')
		await expect(page.locator('h1')).toHaveText('Query & Mutation Demo', { timeout: 5_000 })

		// Wait for the response listener to process
		await page.waitForTimeout(500)

		expect(batchResults.length).toBeGreaterThanOrEqual(1)
		expect(batchResults[0].length).toBeGreaterThanOrEqual(2)
	})
})
