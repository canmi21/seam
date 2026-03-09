/* tests/e2e/specs/feature-sse-reconnect.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

test.describe('feature: SSE disconnect recovery', () => {
	test('subscription reconnects after offline/online cycle', async ({ page, context }) => {
		await page.goto('/#reconnect', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')
		const tick = page.locator('[data-testid="rc-tick"]')

		// Wait for active and some data
		await expect(status).toContainText('active', { timeout: 10_000 })
		await expect(tick).not.toContainText('RC Tick: 0', { timeout: 5_000 })

		// Go offline — breaks the SSE stream
		await context.setOffline(true)
		await page.waitForTimeout(1_000)

		// Go back online — ReconnectController should reconnect
		await context.setOffline(false)

		// Should return to active with new ticks
		await expect(status).toContainText('active', { timeout: 15_000 })
	})

	test('reconnecting status visible when connection fails', async ({ page }) => {
		// Block SSE subscription requests before navigation.
		// Procedure names are hash-obfuscated in the client bundle,
		// so match all procedure endpoints.
		await page.route('**/_seam/procedure/**', (route) => {
			// Only block GET requests (subscriptions); let POST through
			if (route.request().method() === 'GET') return route.abort()
			return route.continue()
		})

		await page.goto('/#reconnect', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')

		// Initial connection fails — RC enters reconnecting state
		await expect(status).toContainText('reconnecting', { timeout: 10_000 })

		// Unblock and let it reconnect
		await page.unroute('**/_seam/procedure/**')

		// Should eventually recover to active
		await expect(status).toContainText('active', { timeout: 15_000 })
	})

	test('subscription recovers after sustained connection failure', async ({ page }) => {
		// Block SSE subscriptions
		await page.route('**/_seam/procedure/**', (route) => {
			if (route.request().method() === 'GET') return route.abort()
			return route.continue()
		})

		await page.goto('/#reconnect', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')

		// Connection keeps failing — should not be active
		await expect(status).not.toContainText('active', { timeout: 5_000 })

		// Let multiple retries accumulate (initialDelay: 200ms with backoff)
		await page.waitForTimeout(2_000)

		// Still not recovered — RC is retrying with exponential backoff
		await expect(status).not.toContainText('active')

		// Unblock — next retry should succeed
		await page.unroute('**/_seam/procedure/**')
		await expect(status).toContainText('active', { timeout: 15_000 })
	})
})
