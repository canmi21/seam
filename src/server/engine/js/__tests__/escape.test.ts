/* src/server/engine/js/__tests__/escape.test.ts */

import { describe, expect, it } from 'vitest'
import { escapeHtml } from '../src/escape.js'

describe('escapeHtml', () => {
	it('escapes all 5 HTML special characters', () => {
		const input = '<script>alert("xss")&\'test\'</script>'
		const expected = '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#x27;test&#x27;&lt;/script&gt;'
		expect(escapeHtml(input)).toBe(expected)
	})

	it('returns empty string unchanged', () => {
		expect(escapeHtml('')).toBe('')
	})

	it('returns string with no special chars unchanged', () => {
		expect(escapeHtml('Hello World 123')).toBe('Hello World 123')
	})

	it('passes through unicode characters', () => {
		expect(escapeHtml('你好世界')).toBe('你好世界')
	})

	it('escapes mixed safe and unsafe characters', () => {
		expect(escapeHtml('a<b>c&d"e\'f')).toBe('a&lt;b&gt;c&amp;d&quot;e&#x27;f')
	})
})
