/* tests/e2e/specs/fullstack-derive.spec.ts */
/* oxlint-disable @typescript-eslint/no-non-null-assertion */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

function setupDeriveMismatchCollector(page: Page): () => string[] {
	const consoleMessages: ConsoleMessage[] = []
	const pageErrors: Error[] = []
	const mismatchPattern = /(hydration|mismatch)/i

	page.on('console', (msg) => {
		if (msg.type() !== 'warning' && msg.type() !== 'error') return
		if (mismatchPattern.test(msg.text())) {
			consoleMessages.push(msg)
		}
	})

	page.on('pageerror', (error) => {
		if (mismatchPattern.test(error.message)) {
			pageErrors.push(error)
		}
	})

	return () => [
		...consoleMessages.map((msg) => msg.text()),
		...pageErrors.map((error) => error.message),
	]
}

async function totalStarsText(page: Page): Promise<string> {
	const label = page.locator('p', { hasText: 'Total Stars' })
	await expect(label).toBeVisible()
	const value = label.locator('xpath=preceding-sibling::p[1]')
	await expect(value).toBeVisible()
	const text = (await value.textContent())?.trim() ?? ''
	expect(text).toMatch(/^\d+$/)
	expect(text).not.toBe('undefined')
	return text
}

test.describe('fullstack derive lifecycle', () => {
	test('first screen renders derive value and exposes it in __data', async ({ page }) => {
		const response = await page.goto('/dashboard/octocat', { waitUntil: 'networkidle' })
		const html = await response!.text()
		const totalStars = await totalStarsText(page)

		expect(html).toContain('Total Stars')
		expect(html).toContain(`>${totalStars}<`)

		const data = await page.evaluate(() => {
			const raw = document.getElementById('__data')?.textContent
			if (!raw) return null
			return JSON.parse(raw) as {
				__derived?: { repoStats?: { totalStars?: unknown } }
			}
		})

		expect(data).not.toBeNull()
		expect(typeof data?.__derived?.repoStats?.totalStars).toBe('number')
		expect(String(data?.__derived?.repoStats?.totalStars)).toBe(totalStars)
	})

	test('dashboard hydrates without hydration or mismatch warnings', async ({ page }) => {
		const collectMismatchMessages = setupDeriveMismatchCollector(page)

		await page.goto('/dashboard/octocat', { waitUntil: 'networkidle' })
		await waitForHydration(page)
		await totalStarsText(page)

		expect(collectMismatchMessages(), 'derive hydration warnings').toEqual([])
	})

	test('derive value survives SPA navigation back to dashboard', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.evaluate(() => {
			;(window as unknown as Record<string, unknown>).__DERIVE_SPA_MARKER = true
		})

		await page.fill('input[placeholder="GitHub username"]', 'octocat')
		await page.click('button[type="submit"]')
		await page.waitForURL('**/dashboard/octocat', { timeout: 15_000 })
		await expect(page.locator('h2')).toContainText('Top Repositories')
		const initialTotalStars = await totalStarsText(page)

		const markerAfterFirstVisit = await page.evaluate(
			() => (window as unknown as Record<string, unknown>).__DERIVE_SPA_MARKER === true,
		)
		expect(markerAfterFirstVisit, 'SPA marker lost after first dashboard navigation').toBe(true)

		await page.click('a[href="/"]')
		await page.waitForURL('**/')
		await expect(page.locator('h1')).toContainText('GitHub Dashboard')

		const markerAfterHome = await page.evaluate(
			() => (window as unknown as Record<string, unknown>).__DERIVE_SPA_MARKER === true,
		)
		expect(markerAfterHome, 'SPA marker lost after navigating home').toBe(true)

		await page.fill('input[placeholder="GitHub username"]', 'octocat')
		await page.click('button[type="submit"]')
		await page.waitForURL('**/dashboard/octocat', { timeout: 15_000 })
		await expect(page.locator('h2')).toContainText('Top Repositories')

		const markerAfterReturn = await page.evaluate(
			() => (window as unknown as Record<string, unknown>).__DERIVE_SPA_MARKER === true,
		)
		expect(markerAfterReturn, 'SPA marker lost after returning to dashboard').toBe(true)

		const nextTotalStars = await totalStarsText(page)
		expect(nextTotalStars).toBe(initialTotalStars)
	})
})
