/* src/server/core/typescript/__tests__/head.test.ts */

import { describe, expect, it } from 'vitest'
import { headConfigToHtml } from '../src/page/head.js'

describe('headConfigToHtml', () => {
	it('converts title with escaping', () => {
		expect(headConfigToHtml({ title: 'My <Blog>' })).toBe('<title>My &lt;Blog&gt;</title>')
	})

	it('converts meta tags with attribute escaping', () => {
		expect(
			headConfigToHtml({
				meta: [{ name: 'description', content: 'A "great" page' }],
			}),
		).toBe('<meta name="description" content="A &quot;great&quot; page">')
	})

	it('converts link tags', () => {
		expect(
			headConfigToHtml({
				link: [{ rel: 'canonical', href: 'https://example.com/a&b' }],
			}),
		).toBe('<link rel="canonical" href="https://example.com/a&amp;b">')
	})

	it('skips undefined values in meta', () => {
		expect(
			headConfigToHtml({
				meta: [{ name: 'description', content: 'test', property: undefined }],
			}),
		).toBe('<meta name="description" content="test">')
	})

	it('returns empty string for empty config', () => {
		expect(headConfigToHtml({})).toBe('')
	})

	it('combines title, meta, and link', () => {
		const html = headConfigToHtml({
			title: 'My Page',
			meta: [{ name: 'description', content: 'desc' }],
			link: [{ rel: 'icon', href: '/favicon.ico' }],
		})
		expect(html).toBe(
			'<title>My Page</title>' +
				'<meta name="description" content="desc">' +
				'<link rel="icon" href="/favicon.ico">',
		)
	})

	it('escapes ampersand in title', () => {
		expect(headConfigToHtml({ title: 'A & B' })).toBe('<title>A &amp; B</title>')
	})

	it('escapes single quotes in attributes', () => {
		expect(
			headConfigToHtml({
				meta: [{ name: 'description', content: "it's good" }],
			}),
		).toBe('<meta name="description" content="it&#x27;s good">')
	})
})
