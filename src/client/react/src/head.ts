/* src/client/react/src/head.ts */

import type { HeadConfig } from './types.js'

const SLOT_PREFIX = '<!--seam:'
const SLOT_SUFFIX = '-->'

/**
 * Build a deep Proxy that returns slot marker strings for property access.
 * Template literal concatenation works naturally:
 *   `${proxy.post.title} | Blog` → `<!--seam:post.title--> | Blog`
 */
export function buildHeadSlotProxy(prefix = ''): unknown {
	return new Proxy(Object.create(null) as Record<string, unknown>, {
		get(_, prop) {
			if (typeof prop === 'symbol') {
				if (prop === Symbol.toPrimitive) {
					return () => (prefix ? `${SLOT_PREFIX}${prefix}${SLOT_SUFFIX}` : '')
				}
				return undefined
			}
			if (prop === 'then' || prop === 'toJSON') return undefined
			const path = prefix ? `${prefix}.${prop}` : String(prop)
			return buildHeadSlotProxy(path)
		},
	})
}

/**
 * Convert a HeadConfig (where values may contain <!--seam:...--> slot markers)
 * into raw HTML. Slot markers are preserved for the engine's inject_no_script
 * to resolve at request time.
 */
export function headConfigToSlotHtml(config: HeadConfig): string {
	let html = ''
	if (config.title !== undefined) {
		html += `<title>${config.title}</title>`
	}
	for (const meta of config.meta ?? []) {
		html += '<meta'
		for (const [k, v] of Object.entries(meta)) {
			if (v !== undefined) html += ` ${k}="${v}"`
		}
		html += '>'
	}
	for (const link of config.link ?? []) {
		html += '<link'
		for (const [k, v] of Object.entries(link)) {
			if (v !== undefined) html += ` ${k}="${v}"`
		}
		html += '>'
	}
	return html
}
