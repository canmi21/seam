/* tests/e2e/specs/feature-stream-upload.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration, setupHydrationErrorCollector } from './helpers/hydration.js'

test.describe('feature: stream & upload', () => {
	test('displays title from loader data', async ({ page }) => {
		const getErrors = setupHydrationErrorCollector(page)
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await expect(page.locator('h1')).toHaveText('Stream & Upload Demo')
		expect(getErrors()).toHaveLength(0)
	})

	test('stream completes with all chunks', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('button:has-text("Start Stream")')

		// Stream emits 5 chunks (0-4) with 500ms delay each, total ~2.5s
		const streamParagraph = page.locator('p', { hasText: /\d/ }).first()
		await expect(streamParagraph).toContainText('Done', { timeout: 10_000 })
		const text = await streamParagraph.textContent()
		expect(text).toContain('0, 1, 2, 3, 4')
	})

	test('stream can be cancelled mid-flight', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		await page.click('button:has-text("Start Stream")')

		// Wait for at least one chunk to appear
		const streamParagraph = page.locator('p', { hasText: /\d/ }).first()
		await expect(streamParagraph).toContainText('0', { timeout: 5_000 })

		// Cancel before all chunks arrive
		await page.click('button:has-text("Cancel")')

		// After cancel, the text should not contain "Done"
		const text = await streamParagraph.textContent()
		expect(text).not.toContain('Done')
	})

	test('file upload returns fileId and metadata', async ({ page }) => {
		await page.goto('/', { waitUntil: 'networkidle' })
		await waitForHydration(page)

		// Create a test file via setInputFiles
		const fileInput = page.locator('input[type="file"]')
		await fileInput.setInputFiles({
			name: 'hello.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('Hello, Seam!'),
		})

		await page.click('button:has-text("Upload")')

		// Wait for the result to appear
		const fileIdDd = page.locator('dt:has-text("File ID") + dd')
		await expect(fileIdDd).toBeVisible({ timeout: 5_000 })

		// Verify UUID format
		const fileId = await fileIdDd.textContent()
		expect(fileId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

		// Verify filename and size
		await expect(page.locator('dt:has-text("Filename") + dd')).toHaveText('hello.txt')
		await expect(page.locator('dt:has-text("Size") + dd')).toHaveText('12 bytes')
	})
})
