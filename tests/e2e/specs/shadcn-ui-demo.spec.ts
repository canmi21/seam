/* tests/e2e/specs/shadcn-ui-demo.spec.ts */

import { test, expect } from '@playwright/test'
import { setupHydrationErrorCollector, waitForHydration } from './helpers/hydration.js'

test.describe('shadcn ui demo', () => {
	test('SSR response keeps only stable trigger HTML', async ({ request, page }) => {
		const response = await request.get('/')
		expect(response.ok()).toBe(true)
		const html = await response.text()

		expect(html).toContain('Open closed dialog')
		expect(html).toContain('Open closed menu')
		expect(html).toContain('Default-open dialog')
		expect(html).toContain('Default-open menu')
		expect(html).not.toContain('Closed dialog content')
		expect(html).not.toContain('Default-open dialog body')
		expect(html).not.toContain('Default-open menu item')

		const getErrors = setupHydrationErrorCollector(page)
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)
		expect(getErrors()).toEqual([])
	})

	test('default-open portal components hydrate into visible content', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('[data-testid="hydration-state"]')).toContainText('hydrated')
		await expect(page.locator('[data-testid="default-open-dialog-trigger"]')).toHaveAttribute(
			'data-state',
			'open',
		)
		await expect(page.locator('[data-testid="default-open-menu-trigger"]')).toHaveAttribute(
			'data-state',
			'open',
		)
		await expect(page.locator('[data-testid="default-open-dialog-content"]')).toBeVisible()
		await expect(page.locator('[data-testid="default-open-menu-content"]')).toBeVisible()
		await expect(page.locator('[data-testid="default-open-menu-content"]')).toContainText(
			'Default-open menu item',
		)
	})

	test('hydrated state can update client-only interactions', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.locator('[data-testid="default-open-dialog-close"]').evaluate((element) => {
			;(element as HTMLButtonElement).click()
		})
		await expect(page.locator('[data-testid="default-open-dialog-content"]')).toBeHidden()

		await page.locator('[data-testid="counter-button"]').evaluate((element) => {
			;(element as HTMLButtonElement).click()
		})
		await expect(page.locator('[data-testid="counter-value"]')).toContainText('count 1')
	})
})
