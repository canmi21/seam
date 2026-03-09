/* src/server/core/typescript/src/page/head.ts */

import { escapeHtml } from '@canmi/seam-engine'

interface HeadMeta {
	[key: string]: string | undefined
}

interface HeadLink {
	[key: string]: string | undefined
}

interface HeadConfig {
	title?: string
	meta?: HeadMeta[]
	link?: HeadLink[]
}

export type HeadFn = (data: Record<string, unknown>) => HeadConfig

/**
 * Convert a HeadConfig with real values into escaped HTML.
 * Used at request-time by TS server backends.
 */
export function headConfigToHtml(config: HeadConfig): string {
	let html = ''
	if (config.title !== undefined) {
		html += `<title>${escapeHtml(config.title)}</title>`
	}
	for (const meta of config.meta ?? []) {
		html += '<meta'
		for (const [k, v] of Object.entries(meta)) {
			if (v !== undefined) html += ` ${k}="${escapeHtml(v)}"`
		}
		html += '>'
	}
	for (const link of config.link ?? []) {
		html += '<link'
		for (const [k, v] of Object.entries(link)) {
			if (v !== undefined) html += ` ${k}="${escapeHtml(v)}"`
		}
		html += '>'
	}
	return html
}
