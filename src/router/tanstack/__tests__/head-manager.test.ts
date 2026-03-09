/* src/router/tanstack/__tests__/head-manager.test.ts */

/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { updateHead, clearHead } from '../src/head-manager.js'

afterEach(() => {
	// Clean up managed tags
	document.head.querySelectorAll('[data-seam-head]').forEach((el) => el.remove())
	// Reset title
	document.title = ''
})

describe('updateHead', () => {
	it('sets document title', () => {
		updateHead({ title: 'My Page' })
		expect(document.title).toBe('My Page')
	})

	it('adds meta tags with data-seam-head marker', () => {
		updateHead({ meta: [{ name: 'description', content: 'A page' }] })
		const meta = document.head.querySelector('meta[data-seam-head]')
		expect(meta).not.toBeNull()
		expect(meta?.getAttribute('name')).toBe('description')
		expect(meta?.getAttribute('content')).toBe('A page')
	})

	it('adds link tags with data-seam-head marker', () => {
		updateHead({ link: [{ rel: 'canonical', href: 'https://example.com' }] })
		const link = document.head.querySelector('link[data-seam-head]')
		expect(link).not.toBeNull()
		expect(link?.getAttribute('rel')).toBe('canonical')
		expect(link?.getAttribute('href')).toBe('https://example.com')
	})

	it('replaces previous managed tags on second call', () => {
		updateHead({ meta: [{ name: 'description', content: 'first' }] })
		expect(document.head.querySelectorAll('[data-seam-head]').length).toBe(1)

		updateHead({ meta: [{ name: 'description', content: 'second' }] })
		const all = document.head.querySelectorAll('[data-seam-head]')
		expect(all.length).toBe(1)
		expect(all[0]?.getAttribute('content')).toBe('second')
	})

	it('removes SSR-injected meta tag on first SPA navigation', () => {
		// Simulate SSR-injected tag (no marker)
		const ssrMeta = document.createElement('meta')
		ssrMeta.setAttribute('name', 'description')
		ssrMeta.setAttribute('content', 'ssr content')
		document.head.appendChild(ssrMeta)

		updateHead({ meta: [{ name: 'description', content: 'spa content' }] })

		// SSR tag removed
		const unmarked = document.head.querySelector('meta[name="description"]:not([data-seam-head])')
		expect(unmarked).toBeNull()

		// SPA tag present
		const managed = document.head.querySelector('meta[name="description"][data-seam-head]')
		expect(managed?.getAttribute('content')).toBe('spa content')
	})
})

describe('clearHead', () => {
	it('removes all managed tags', () => {
		updateHead({
			title: 'Page',
			meta: [{ name: 'description', content: 'test' }],
			link: [{ rel: 'canonical', href: '/test' }],
		})
		expect(document.head.querySelectorAll('[data-seam-head]').length).toBe(2)

		clearHead()
		expect(document.head.querySelectorAll('[data-seam-head]').length).toBe(0)
	})
})
