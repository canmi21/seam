/* tests/e2e/specs/fullstack-page-split.spec.ts */

import { test, expect } from '@playwright/test'
import { waitForHydration } from './helpers/hydration.js'

const PAGE_SCRIPT_RE = /<script[^>]+type="module"[^>]+src="(\/[^"]+)"/g
const PREFETCH_RE = /<link[^>]+rel="prefetch"[^>]+href="([^"]+)"/g

function extractMatches(html: string, re: RegExp): string[] {
  const urls: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) urls.push(m[1])
  return urls
}

test.describe('page split', () => {
  test('different pages serve different page-specific scripts', async ({ request }) => {
    const homeRes = await request.get('/')
    const dashRes = await request.get('/dashboard/octocat')
    const homeHTML = await homeRes.text()
    const dashHTML = await dashRes.text()

    const homeScripts = extractMatches(homeHTML, new RegExp(PAGE_SCRIPT_RE.source, 'g'))
    const dashScripts = extractMatches(dashHTML, new RegExp(PAGE_SCRIPT_RE.source, 'g'))

    expect(homeScripts.length).toBeGreaterThan(0)
    expect(dashScripts.length).toBeGreaterThan(0)

    // Script sets should not be identical — each page has its own entry chunk
    const homeSet = new Set(homeScripts)
    const dashSet = new Set(dashScripts)
    const identical = homeSet.size === dashSet.size && [...homeSet].every((s) => dashSet.has(s))
    expect(identical, 'expected different script sets for different pages').toBe(false)
  })

  test('home page contains prefetch links', async ({ request }) => {
    const res = await request.get('/')
    const html = await res.text()

    const prefetchLinks = extractMatches(html, new RegExp(PREFETCH_RE.source, 'g'))
    expect(prefetchLinks.length).toBeGreaterThan(0)

    const hasStaticJS = prefetchLinks.some(
      (link) => link.startsWith('/_seam/static/') && link.endsWith('.js'),
    )
    expect(hasStaticJS, 'expected prefetch link to /_seam/static/*.js').toBe(true)
  })

  test('lazy component loads correctly on SPA navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await waitForHydration(page)

    // Track network requests for new JS chunks during navigation
    const newChunks: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('/_seam/static/') && url.endsWith('.js')) {
        newChunks.push(url)
      }
    })

    // Navigate to dashboard via form submit (SPA navigation)
    await page.fill('input[placeholder="GitHub username"]', 'octocat')
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard/octocat', { timeout: 15_000 })
    await waitForHydration(page)

    // Lazy component should have rendered dashboard content
    await expect(page.locator('text=Top Repositories')).toBeVisible({ timeout: 10_000 })

    // At least one new JS chunk should have been loaded during navigation
    expect(newChunks.length).toBeGreaterThan(0)
  })
})
