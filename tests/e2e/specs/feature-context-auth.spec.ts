/* tests/e2e/specs/feature-context-auth.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration, setupHydrationErrorCollector } from './helpers/hydration.js'

test.describe('feature: context auth', () => {
	test('displays public info on first screen', async ({ page }) => {
		const getErrors = setupHydrationErrorCollector(page)
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Context Auth Demo')
		await expect(page.locator('p', { hasText: 'This is public' })).toBeVisible()
		expect(getErrors()).toHaveLength(0)
	})

	test('unauthenticated fetch secret shows error', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('button:has-text("Fetch Secret")')

		const errorMsg = page.locator('p[style*="color: red"]')
		await expect(errorMsg).toBeVisible({ timeout: 5_000 })
		await expect(errorMsg).toContainText('Error:')
	})

	test('login changes status display', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('button:has-text("Login (fake token)")')

		await expect(page.locator('p', { hasText: 'Logged in as user-42' })).toBeVisible()
		await expect(page.locator('button:has-text("Logout")')).toBeVisible()
	})

	test('authenticated fetch secret succeeds', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('button:has-text("Login (fake token)")')
		await expect(page.locator('p', { hasText: 'Logged in as user-42' })).toBeVisible()

		await page.click('button:has-text("Fetch Secret")')

		await expect(
			page.locator('p', { hasText: 'Secret: Hello user-42, your role is admin' }),
		).toBeVisible({ timeout: 5_000 })
	})

	test('authenticated update profile succeeds', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('button:has-text("Login (fake token)")')
		await expect(page.locator('p', { hasText: 'Logged in as user-42' })).toBeVisible()

		await page.click('button:has-text("Update Profile")')

		await expect(page.locator('p', { hasText: 'Profile: Updated by user-42' })).toBeVisible({
			timeout: 5_000,
		})
	})
})
