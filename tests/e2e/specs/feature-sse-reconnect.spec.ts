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

	test('reconnecting status visible during recovery', async ({ page, context }) => {
		await page.goto('/#reconnect', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')
		await expect(status).toContainText('active', { timeout: 10_000 })

		// Set up route blocking BEFORE going offline so it's in place
		// when onOnline() fires and immediately calls connect()
		await page.route('**/_seam/procedure/onLongTick**', (route) => route.abort())

		// Go offline to break the stream, then online to trigger reconnection
		await context.setOffline(true)
		await page.waitForTimeout(500)
		await context.setOffline(false)

		// RC.onOnline() fires connect() immediately, which hits the route block.
		// Should show reconnecting or error status.
		await expect(status).not.toContainText('active', { timeout: 10_000 })

		// Unblock and let it reconnect
		await page.unroute('**/_seam/procedure/onLongTick**')

		// Should eventually return to active
		await expect(status).toContainText('active', { timeout: 15_000 })
	})

	test('subscription recovers after sustained connection failure', async ({ page, context }) => {
		await page.goto('/#reconnect', { waitUntil: 'domcontentloaded' })
		await waitForHydration(page)

		const status = page.locator('[data-testid="rc-status"]')
		await expect(status).toContainText('active', { timeout: 10_000 })

		// Block reconnection before going offline
		await page.route('**/_seam/procedure/onLongTick**', (route) => route.abort())

		await context.setOffline(true)
		await page.waitForTimeout(500)
		await context.setOffline(false)

		// Reconnection attempts keep failing — status should not be active
		await expect(status).not.toContainText('active', { timeout: 10_000 })

		// Let multiple retries accumulate (initialDelay: 200ms with backoff)
		await page.waitForTimeout(1_500)

		// Still not recovered
		await expect(status).not.toContainText('active')

		// Unblock — next retry should succeed
		await page.unroute('**/_seam/procedure/onLongTick**')
		await expect(status).toContainText('active', { timeout: 15_000 })
	})
})
