/* tests/e2e/specs/feature-sse-reconnect.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

test.describe('feature: SSE disconnect recovery', () => {
	test('subscription reconnects after offline/online cycle', async ({ page, context }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' })
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

	test('reconnecting status visible during recovery', async ({ page, context }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')
		await expect(status).toContainText('active', { timeout: 10_000 })

		// Go offline, then online but block the onLongTick endpoint
		await context.setOffline(true)
		await page.waitForTimeout(500)
		await context.setOffline(false)

		// Block reconnection attempts
		await page.route('**/_seam/procedure/onLongTick**', (route) => route.abort())

		// Should show reconnecting or error status
		await expect(status).not.toContainText('active', { timeout: 10_000 })

		// Unblock and let it reconnect
		await page.unroute('**/_seam/procedure/onLongTick**')

		// Should eventually return to active
		await expect(status).toContainText('active', { timeout: 15_000 })
	})

	test('retry count increments on failed reconnection', async ({ page, context }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')
		const retryCount = page.locator('[data-testid="rc-retry"]')

		await expect(status).toContainText('active', { timeout: 10_000 })

		// Block reconnection attempts before going offline
		await page.route('**/_seam/procedure/onLongTick**', (route) => route.abort())

		// Go offline then online to trigger reconnection
		await context.setOffline(true)
		await page.waitForTimeout(500)
		await context.setOffline(false)

		// Wait for retry count to increment (initialDelay: 200ms)
		await expect(retryCount).not.toContainText('RC Retry: 0', { timeout: 10_000 })

		// Unblock and let it recover
		await page.unroute('**/_seam/procedure/onLongTick**')
		await expect(status).toContainText('active', { timeout: 15_000 })
	})
})
