/* src/client/react/__tests__/head.test.ts */

import { describe, expect, it } from 'vitest'
import { buildHeadSlotProxy, headConfigToSlotHtml } from '../src/head.js'
import type { HeadConfig } from '../src/types.js'

describe('buildHeadSlotProxy', () => {
	it('returns slot marker for simple property access', () => {
		const proxy = buildHeadSlotProxy() as Record<string, unknown>
		expect(`${proxy.title}`).toBe('<!--seam:title-->')
	})

	it('returns slot marker for nested property access', () => {
		const proxy = buildHeadSlotProxy() as Record<string, unknown>
		const post = proxy.post as Record<string, unknown>
		expect(`${post.title}`).toBe('<!--seam:post.title-->')
	})

	it('works with template literal concatenation', () => {
		const proxy = buildHeadSlotProxy() as Record<string, unknown>
		const post = proxy.post as Record<string, unknown>
		expect(`${post.title} | Blog`).toBe('<!--seam:post.title--> | Blog')
	})

	it('handles deep nesting', () => {
		const proxy = buildHeadSlotProxy() as Record<string, unknown>
		const a = proxy.a as Record<string, unknown>
		const b = a.b as Record<string, unknown>
		expect(`${b.c}`).toBe('<!--seam:a.b.c-->')
	})

	it('returns empty string for root-level toPrimitive', () => {
		const proxy = buildHeadSlotProxy()
		expect(`${proxy}`).toBe('')
	})
})

describe('headConfigToSlotHtml', () => {
	it('converts title with slot', () => {
		const config: HeadConfig = { title: '<!--seam:post.title--> | Blog' }
		expect(headConfigToSlotHtml(config)).toBe('<title><!--seam:post.title--> | Blog</title>')
	})

	it('converts meta tags', () => {
		const config: HeadConfig = {
			meta: [{ name: 'description', content: '<!--seam:post.excerpt-->' }],
		}
		expect(headConfigToSlotHtml(config)).toBe(
			'<meta name="description" content="<!--seam:post.excerpt-->">',
		)
	})

	it('converts link tags', () => {
		const config: HeadConfig = {
			link: [{ rel: 'canonical', href: '<!--seam:url-->' }],
		}
		expect(headConfigToSlotHtml(config)).toBe('<link rel="canonical" href="<!--seam:url-->">')
	})

	it('skips undefined values', () => {
		const config: HeadConfig = {
			meta: [{ name: 'description', content: 'test', property: undefined }],
		}
		expect(headConfigToSlotHtml(config)).toBe('<meta name="description" content="test">')
	})

	it('returns empty string for empty config', () => {
		expect(headConfigToSlotHtml({})).toBe('')
	})

	it('combines title, meta, and link', () => {
		const config: HeadConfig = {
			title: '<!--seam:title-->',
			meta: [{ name: 'description', content: '<!--seam:desc-->' }],
			link: [{ rel: 'canonical', href: '<!--seam:url-->' }],
		}
		const html = headConfigToSlotHtml(config)
		expect(html).toBe(
			'<title><!--seam:title--></title>' +
				'<meta name="description" content="<!--seam:desc-->">' +
				'<link rel="canonical" href="<!--seam:url-->">',
		)
	})

	it('end-to-end: proxy → head function → slot HTML', () => {
		const proxy = buildHeadSlotProxy() as Record<string, unknown>
		const post = proxy.post as Record<string, unknown>
		const headFn = (data: Record<string, unknown>) => {
			const p = data.post as Record<string, unknown>
			return {
				title: `${p.title} | Blog`,
				meta: [
					{ name: 'description', content: `${p.excerpt}` },
					{ property: 'og:title', content: `${p.title}` },
				],
				link: [{ rel: 'canonical', href: `https://example.com/${p.slug}` }],
			}
		}
		const config = headFn({ post } as Record<string, unknown>)
		const html = headConfigToSlotHtml(config)
		expect(html).toBe(
			'<title><!--seam:post.title--> | Blog</title>' +
				'<meta name="description" content="<!--seam:post.excerpt-->">' +
				'<meta property="og:title" content="<!--seam:post.title-->">' +
				'<link rel="canonical" href="https://example.com/<!--seam:post.slug-->">',
		)
	})
})
