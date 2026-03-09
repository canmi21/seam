/* src/router/tanstack/src/head-manager.ts */

import type { HeadConfig } from '@canmi/seam-react'

const MARKER = 'data-seam-head'

/** Update document head with structured metadata, replacing previous managed tags. */
export function updateHead(config: HeadConfig): void {
	if (config.title !== undefined) document.title = config.title

	// Remove all previously managed tags
	document.head.querySelectorAll(`[${MARKER}]`).forEach((el) => el.remove())

	for (const meta of config.meta ?? []) {
		// First SPA navigation: remove SSR-injected tag (no marker)
		const selector = meta.name
			? `meta[name="${meta.name}"]:not([${MARKER}])`
			: meta.property
				? `meta[property="${meta.property}"]:not([${MARKER}])`
				: null
		if (selector) {
			const existing = document.head.querySelector(selector)
			if (existing) existing.remove()
		}

		const el = document.createElement('meta')
		el.setAttribute(MARKER, '')
		for (const [k, v] of Object.entries(meta)) {
			if (v !== undefined) el.setAttribute(k, v)
		}
		document.head.appendChild(el)
	}

	for (const link of config.link ?? []) {
		// First SPA navigation: remove SSR-injected tag (no marker)
		const existing = document.head.querySelector(
			`link[rel="${link.rel}"][href="${link.href}"]:not([${MARKER}])`,
		)
		if (existing) existing.remove()

		const el = document.createElement('link')
		el.setAttribute(MARKER, '')
		for (const [k, v] of Object.entries(link)) {
			if (v !== undefined) el.setAttribute(k, v)
		}
		document.head.appendChild(el)
	}
}

/** Remove all Seam-managed head tags from previous page. */
export function clearHead(): void {
	document.head.querySelectorAll(`[${MARKER}]`).forEach((el) => el.remove())
}
