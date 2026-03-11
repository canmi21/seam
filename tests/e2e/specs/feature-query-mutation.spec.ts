/* tests/e2e/specs/feature-query-mutation.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration, setupHydrationErrorCollector } from './helpers/hydration.js'

test.describe('feature: query & mutation', () => {
	test('displays title and initial todos', async ({ page }) => {
		const getErrors = setupHydrationErrorCollector(page)
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Query & Mutation Demo')

		// Initial todos from server
		await expect(page.locator('span', { hasText: 'Learn SeamJS' })).toBeVisible()
		await expect(page.locator('span', { hasText: 'Build a demo' })).toBeVisible()

		// "Build a demo" should have line-through (done: true)
		const doneSpan = page.locator('span', { hasText: 'Build a demo' })
		await expect(doneSpan).toHaveCSS('text-decoration-line', 'line-through')

		expect(getErrors()).toHaveLength(0)
	})

	test('add todo reaches server', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Wait for interactive UI (deferred via useEffect)
		await expect(page.locator('input[placeholder="New todo..."]')).toBeVisible({ timeout: 5_000 })

		// Add a unique todo
		const uniqueTitle = `Task-${Date.now()}`
		await page.fill('input[placeholder="New todo..."]', uniqueTitle)

		// Wait for the mutation batch call to complete
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('_seam/procedure'), { timeout: 5_000 }),
			page.click('button:has-text("Add")'),
		])

		// Reload to verify the mutation persisted on the server (in-memory store)
		await page.reload({ waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('span', { hasText: uniqueTitle })).toBeVisible({ timeout: 5_000 })
	})

	test('toggle todo reaches server', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Wait for interactive UI (deferred via useEffect)
		await expect(page.locator('input[placeholder="New todo..."]')).toBeVisible({ timeout: 5_000 })

		const learnSpan = page.locator('span', { hasText: 'Learn SeamJS' })
		const checkbox = page
			.locator('label', { hasText: 'Learn SeamJS' })
			.locator('input[type="checkbox"]')
		const wasChecked = await checkbox.isChecked()
		if (wasChecked) {
			await expect(learnSpan).toHaveCSS('text-decoration-line', 'line-through')
		} else {
			await expect(learnSpan).toHaveCSS('text-decoration-line', 'none')
		}

		// Toggle it and wait for mutation batch call
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('_seam/procedure'), { timeout: 5_000 }),
			checkbox.click(),
		])

		// Reload to verify the toggle persisted
		await page.reload({ waitUntil: 'networkidle' })
		await waitForHydration(page)

		const expectedDecoration = wasChecked ? 'none' : 'line-through'
		await expect(learnSpan).toHaveCSS('text-decoration-line', expectedDecoration)
	})
})
