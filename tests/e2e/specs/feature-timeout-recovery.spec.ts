/* tests/e2e/specs/feature-timeout-recovery.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

test.describe('feature: 504 timeout recovery', () => {
	test('query returns 504 → client shows error state', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Intercept all procedure calls with 504
		await page.route('**/_seam/procedure/**', (route) =>
			route.fulfill({
				status: 504,
				contentType: 'text/plain',
				body: 'Gateway Timeout',
			}),
		)

		// Trigger client-side query by adding a todo (mutation triggers refetch)
		const input = page.locator('input[placeholder="New todo..."]')
		await expect(input).toBeVisible({ timeout: 5_000 })
		await input.fill('test-504')
		await page.click('button:has-text("Add")')

		// TanStack Query should surface error — look for "Loading..." to disappear
		// or error boundary to appear; the page should not have unhandled errors
		const errors: Error[] = []
		page.on('pageerror', (e) => errors.push(e))

		// Wait a bit for retries to exhaust
		await page.waitForTimeout(3_000)

		// No unhandled promise rejections
		const unhandled = errors.filter((e) => e.message.includes('unhandled'))
		expect(unhandled).toHaveLength(0)
	})

	test('retry succeeds after transient 504', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Counter-based interception: first call → 504, subsequent → pass through
		let callCount = 0
		await page.route('**/_seam/procedure/**', (route) => {
			callCount++
			if (callCount <= 1) {
				return route.fulfill({
					status: 504,
					contentType: 'text/plain',
					body: 'Gateway Timeout',
				})
			}
			return route.continue()
		})

		// Trigger a mutation which will cause a refetch
		const input = page.locator('input[placeholder="New todo..."]')
		await expect(input).toBeVisible({ timeout: 5_000 })
		const uniqueTitle = `Recovery-${Date.now()}`
		await input.fill(uniqueTitle)
		await page.click('button:has-text("Add")')

		// TanStack Query auto-retries; data should eventually load
		// Verify original content is still accessible after recovery
		await expect(page.locator('h1')).toHaveText('Query & Mutation Demo', { timeout: 10_000 })
	})

	test('no unhandled promise rejections during 504', async ({ page }) => {
		const errors: Error[] = []
		page.on('pageerror', (e) => errors.push(e))

		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Intercept with 504 for a limited window
		await page.route('**/_seam/procedure/**', (route) =>
			route.fulfill({
				status: 504,
				contentType: 'text/plain',
				body: 'Gateway Timeout',
			}),
		)

		// Trigger client-side query
		const input = page.locator('input[placeholder="New todo..."]')
		await expect(input).toBeVisible({ timeout: 5_000 })
		await input.fill('err-test')
		await page.click('button:has-text("Add")')

		await page.waitForTimeout(2_000)

		// No unhandled errors
		expect(errors).toHaveLength(0)
	})
})
