/* src/client/react/scripts/mock-generator-tracking.mjs */

import { collectSchemaPaths, didYouMean } from './mock-generator-paths.mjs'

// Keys to ignore in Proxy tracking — React internals, framework hooks, and prototype methods
const SKIP_KEYS = new Set([
	'$$typeof',
	'then',
	'toJSON',
	'constructor',
	'valueOf',
	'toString',
	'hasOwnProperty',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'toLocaleString',
	'__proto__',
	'_owner',
	'_store',
	'ref',
	'key',
	'type',
	'props',
	'_self',
	'_source',
])

const ARRAY_METHODS = new Set([
	'length',
	'map',
	'filter',
	'forEach',
	'find',
	'findIndex',
	'some',
	'every',
	'reduce',
	'reduceRight',
	'includes',
	'indexOf',
	'lastIndexOf',
	'flat',
	'flatMap',
	'slice',
	'concat',
	'join',
	'sort',
	'reverse',
	'entries',
	'keys',
	'values',
	'at',
	'fill',
	'copyWithin',
	'push',
	'pop',
	'shift',
	'unshift',
	'splice',
])

/**
 * Wrap an object with a Proxy that records all property access paths into `accessed`.
 * Nested objects/arrays are recursively wrapped.
 * @param {unknown} obj - object to wrap
 * @param {Set<string>} accessed - set to record accessed paths
 * @param {string} [prefix=""] - current dot-separated path prefix
 * @returns {unknown}
 */
export function createAccessTracker(obj, accessed, prefix = '') {
	if (obj === null || obj === undefined || typeof obj !== 'object') return obj

	return new Proxy(obj, {
		get(target, prop, receiver) {
			if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
			if (SKIP_KEYS.has(prop)) return Reflect.get(target, prop, receiver)

			const isArr = Array.isArray(target)
			if (isArr && ARRAY_METHODS.has(prop)) {
				return Reflect.get(target, prop, receiver)
			}

			if (isArr && /^\d+$/.test(prop)) {
				const path = prefix ? `${prefix}.$` : '$'
				accessed.add(path)
				const value = target[prop]
				if (value !== null && value !== undefined && typeof value === 'object') {
					return createAccessTracker(value, accessed, path)
				}
				return value
			}

			const path = prefix ? `${prefix}.${prop}` : prop
			accessed.add(path)

			const value = Reflect.get(target, prop, receiver)
			if (value !== null && value !== undefined && typeof value === 'object') {
				return createAccessTracker(value, accessed, path)
			}
			return value
		},
	})
}

/**
 * Compare accessed property paths against schema-defined paths.
 * Returns an array of warning strings for fields accessed but not in schema.
 * @param {Set<string>} accessed - paths recorded by createAccessTracker
 * @param {object | null} schema - page-level JTD schema
 * @param {string} routePath - route path for warning messages
 * @returns {string[]}
 */
export function checkFieldAccess(accessed, schema, routePath) {
	if (!schema) return []

	const known = collectSchemaPaths(schema)
	if (known.size === 0) return []

	const warnings = []
	const leafNames = new Set()
	for (const path of known) {
		const dot = path.lastIndexOf('.')
		leafNames.add(dot === -1 ? path : path.slice(dot + 1))
	}

	for (const path of accessed) {
		if (known.has(path)) continue

		let isParent = false
		for (const knownPath of known) {
			if (knownPath.startsWith(path + '.')) {
				isParent = true
				break
			}
		}
		if (isParent) continue

		const fieldName = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path
		const suggestion = didYouMean(fieldName, leafNames)
		const knownList = [...leafNames].sort().join(', ')

		let message = `Route "${routePath}" component accessed data.${path},\n       but schema only defines: ${knownList}`
		if (suggestion) {
			message += `\n       Did you mean: ${suggestion}?`
		}
		warnings.push(message)
	}

	return warnings
}
