/* src/client/react/__tests__/head-merge.test.ts */

import { describe, expect, it } from 'vitest'
import { mergeHeadConfigs } from '../src/head.js'
import type { HeadConfig, HeadFn } from '../src/types.js'

describe('mergeHeadConfigs', () => {
	it('returns undefined when both are undefined', () => {
		expect(mergeHeadConfigs(undefined, undefined)).toBeUndefined()
	})

	it('returns override when base is undefined', () => {
		const config: HeadConfig = { title: 'Hello' }
		expect(mergeHeadConfigs(undefined, config)).toBe(config)
	})

	it('returns base when override is undefined', () => {
		const config: HeadConfig = { title: 'Hello' }
		expect(mergeHeadConfigs(config, undefined)).toBe(config)
	})

	it('override title wins', () => {
		const base: HeadConfig = { title: 'Base' }
		const override: HeadConfig = { title: 'Override' }
		expect(mergeHeadConfigs(base, override)).toEqual({ title: 'Override' })
	})

	it('keeps base title when override has no title', () => {
		const base: HeadConfig = { title: 'Base' }
		const override: HeadConfig = { meta: [{ name: 'robots', content: 'noindex' }] }
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.title).toBe('Base')
		expect(result.meta).toEqual([{ name: 'robots', content: 'noindex' }])
	})

	it('dedup meta by name, override wins', () => {
		const base: HeadConfig = {
			meta: [{ name: 'description', content: 'base desc' }],
		}
		const override: HeadConfig = {
			meta: [{ name: 'description', content: 'override desc' }],
		}
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.meta).toEqual([{ name: 'description', content: 'override desc' }])
	})

	it('dedup meta by property, override wins', () => {
		const base: HeadConfig = {
			meta: [{ property: 'og:title', content: 'base' }],
		}
		const override: HeadConfig = {
			meta: [{ property: 'og:title', content: 'override' }],
		}
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.meta).toEqual([{ property: 'og:title', content: 'override' }])
	})
})

describe('mergeHeadConfigs - HeadFn', () => {
	it('dedup meta by httpEquiv', () => {
		const base: HeadConfig = {
			meta: [{ httpEquiv: 'refresh', content: '30' }],
		}
		const override: HeadConfig = {
			meta: [{ httpEquiv: 'refresh', content: '60' }],
		}
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.meta).toEqual([{ httpEquiv: 'refresh', content: '60' }])
	})

	it('meta identity key priority: name > property > httpEquiv', () => {
		const base: HeadConfig = {
			meta: [{ name: 'x', property: 'y', content: 'base' }],
		}
		const override: HeadConfig = {
			meta: [{ name: 'x', content: 'override' }],
		}
		// Both keyed by name "x", so override replaces base
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.meta).toHaveLength(1)
		expect(result.meta?.[0].content).toBe('override')
	})

	it('merges non-conflicting meta from both sides', () => {
		const base: HeadConfig = {
			meta: [{ name: 'author', content: 'Base Author' }],
		}
		const override: HeadConfig = {
			meta: [{ name: 'robots', content: 'noindex' }],
		}
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.meta).toHaveLength(2)
	})

	it('concatenates links (base first, then override)', () => {
		const base: HeadConfig = {
			link: [{ rel: 'icon', href: '/favicon.ico' }],
		}
		const override: HeadConfig = {
			link: [{ rel: 'stylesheet', href: '/style.css' }],
		}
		const result = mergeHeadConfigs(base, override) as HeadConfig
		expect(result.link).toEqual([
			{ rel: 'icon', href: '/favicon.ico' },
			{ rel: 'stylesheet', href: '/style.css' },
		])
	})

	it('HeadFn + static returns HeadFn', () => {
		const baseFn: HeadFn = (data) => ({ title: `${data.name}` })
		const override: HeadConfig = { link: [{ rel: 'icon', href: '/icon.png' }] }
		const result = mergeHeadConfigs(baseFn, override)
		expect(typeof result).toBe('function')
		const resolved = (result as HeadFn)({ name: 'Test' })
		expect(resolved.title).toBe('Test')
		expect(resolved.link).toEqual([{ rel: 'icon', href: '/icon.png' }])
	})

	it('static + HeadFn returns HeadFn', () => {
		const base: HeadConfig = { link: [{ rel: 'icon', href: '/icon.png' }] }
		const overrideFn: HeadFn = (data) => ({ title: `${data.name}` })
		const result = mergeHeadConfigs(base, overrideFn)
		expect(typeof result).toBe('function')
		const resolved = (result as HeadFn)({ name: 'Test' })
		expect(resolved.title).toBe('Test')
		expect(resolved.link).toEqual([{ rel: 'icon', href: '/icon.png' }])
	})

	it('HeadFn + HeadFn returns HeadFn that merges both', () => {
		const baseFn: HeadFn = () => ({
			title: 'Base',
			meta: [{ name: 'author', content: 'Author' }],
		})
		const overrideFn: HeadFn = (data) => ({
			title: `${data.name}`,
			meta: [{ name: 'robots', content: 'noindex' }],
		})
		const result = mergeHeadConfigs(baseFn, overrideFn)
		expect(typeof result).toBe('function')
		const resolved = (result as HeadFn)({ name: 'Override' })
		expect(resolved.title).toBe('Override')
		expect(resolved.meta).toHaveLength(2)
	})
})
