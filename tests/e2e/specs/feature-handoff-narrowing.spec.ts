/* tests/e2e/specs/feature-handoff-narrowing.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

test.describe('feature: handoff & narrowing', () => {
	test('displays profile name and avatar', async ({ page }) => {
		// Handoff causes an expected hydration mismatch (server: [], client: [theme]),
		// so we skip hydration error assertion here.
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Handoff & Narrowing Demo')
		await expect(page.locator('p', { hasText: 'Alice Chen' })).toBeVisible()
		await expect(page.locator('img[alt="Alice Chen"]')).toBeVisible()
	})

	test('schema narrowing prunes unused fields from __data', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })

		// Read the serialized __data script injected by the engine
		const dataContent = await page.evaluate(() => {
			const script = document.querySelector('script#__data')
			return script?.textContent ?? ''
		})

		// Narrowed fields: name and avatar should be present
		expect(dataContent).toContain('name')
		expect(dataContent).toContain('avatar')

		// Pruned fields: email, bio, createdAt, settings should NOT be in the payload
		expect(dataContent).not.toContain('email')
		expect(dataContent).not.toContain('bio')
		expect(dataContent).not.toContain('createdAt')
		expect(dataContent).not.toContain('settings')
	})

	test('theme starts as light', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('strong')).toHaveText('light')
	})

	test('toggle theme switches to dark', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('strong')).toHaveText('light')

		await page.click('button:has-text("Toggle Theme")')

		await expect(page.locator('strong')).toHaveText('dark')
	})

	test('theme resets to light on reload (handoff semantics)', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Toggle to dark
		await page.click('button:has-text("Toggle Theme")')
		await expect(page.locator('strong')).toHaveText('dark')

		// Reload — server always provides initial "light" value
		await page.reload({ waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('strong')).toHaveText('light')
	})

	test('handoff keys include theme', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(
			page.locator('p', { hasText: 'theme is managed by client after hydration' }),
		).toBeVisible()
	})
})
