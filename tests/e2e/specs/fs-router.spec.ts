/* tests/e2e/specs/fs-router.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration, setupHydrationErrorCollector } from './helpers/hydration.js'

test.describe('filesystem router', () => {
	test('home page renders with loader data', async ({ page }) => {
		const getErrors = setupHydrationErrorCollector(page)
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('FS Router Demo')
		expect(getErrors()).toHaveLength(0)
	})

	test('root layout wraps all pages', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('#root-layout')).toBeVisible()
		await expect(page.locator('#root-layout nav a[href="/"]')).toBeVisible()
		await expect(page.locator('#root-layout nav a[href="/about"]')).toBeVisible()
	})

	test('about page renders', async ({ page }) => {
		await page.goto('/about', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('About')
		await expect(page.locator('#root-layout')).toBeVisible()
	})

	test('dynamic route [slug] resolves blog post', async ({ page }) => {
		await page.goto('/blog/hello-world', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Post: hello-world')
	})

	test('optional catch-all [[...path]] renders docs', async ({ page }) => {
		await page.goto('/docs', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Documentation')
	})

	test('optional catch-all with subpath', async ({ page }) => {
		await page.goto('/docs/getting-started/install', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Documentation')
	})

	test('route group (marketing) pricing page', async ({ page }) => {
		await page.goto('/pricing', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Pricing')
		await expect(page.locator('#marketing-layout')).toBeVisible()
	})

	test('route group (marketing) features page', async ({ page }) => {
		await page.goto('/features', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Features')
		await expect(page.locator('#marketing-layout')).toBeVisible()
	})

	test('SPA navigation between pages', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Stamp the layout DOM to detect re-mounts
		await page.evaluate(() => {
			const layout = document.querySelector('#root-layout') as HTMLElement
			if (layout) layout.dataset.spaStamp = 'alive'
		})

		// Navigate via nav link
		await page.click('#root-layout nav a[href="/about"]')
		await expect(page.locator('h1')).toHaveText('About', { timeout: 5_000 })

		// Layout should survive (not re-mounted)
		const stamp = await page.evaluate(() => {
			const layout = document.querySelector('#root-layout') as HTMLElement
			return layout?.dataset.spaStamp
		})
		expect(stamp, 'layout DOM should survive SPA navigation').toBe('alive')
	})

	test('SPA navigation to dynamic route', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Navigate via nav link to blog post
		await page.click('#root-layout nav a[href="/blog/hello-world"]')
		await expect(page.locator('h1')).toHaveText('Post: hello-world', { timeout: 5_000 })
	})
})
