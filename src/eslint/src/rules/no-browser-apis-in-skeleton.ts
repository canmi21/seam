/* src/eslint/src/rules/no-browser-apis-in-skeleton.ts */

import type { Rule } from 'eslint'

const PAGE_COMPONENT_PATTERN = /(?:^|[\\/])page\.tsx$/

const BROWSER_GLOBALS = new Set([
	'window',
	'document',
	'localStorage',
	'sessionStorage',
	'navigator',
	'location',
])

const rule: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow browser-only APIs (window, document, localStorage, etc.) in page components rendered at build time',
		},
		schema: [],
		messages: {
			forbidden:
				'{{name}} is a browser API and is not available during build-time skeleton rendering (Node/Bun environment). Guard with typeof window !== "undefined" or move logic to useEffect.',
		},
	},
	create(context) {
		if (!PAGE_COMPONENT_PATTERN.test(context.filename)) return {}

		return {
			Identifier(node) {
				if (!BROWSER_GLOBALS.has(node.name)) return

				const parent = node.parent
				if (!parent) return

				// import { window } from '...' — skip specifier
				if (parent.type === 'ImportSpecifier') return

				// obj.window — skip when used as property key (not obj access)
				if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
					return
				}

				// { window: value } — skip shorthand/key in object literal
				if (parent.type === 'Property' && parent.key === node) return

				// typeof window — allowed for guard checks
				if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') {
					return
				}

				context.report({ node, messageId: 'forbidden', data: { name: node.name } })
			},

			MemberExpression(node) {
				// globalThis.document, globalThis.window, etc.
				if (
					node.object.type === 'Identifier' &&
					node.object.name === 'globalThis' &&
					!node.computed &&
					node.property.type === 'Identifier' &&
					BROWSER_GLOBALS.has(node.property.name)
				) {
					// typeof globalThis.window — allowed for guard checks
					if (node.parent?.type === 'UnaryExpression' && node.parent.operator === 'typeof') return
					context.report({
						node,
						messageId: 'forbidden',
						data: { name: `globalThis.${node.property.name}` },
					})
				}
			},
		}
	},
}

export default rule
