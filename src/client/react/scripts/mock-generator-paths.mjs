/* src/client/react/scripts/mock-generator-paths.mjs */

function walkSchemaFields(node, prefix, visitField) {
	if (!node || typeof node !== 'object') return

	if (node.nullable) {
		const inner = { ...node }
		delete inner.nullable
		walkSchemaFields(inner, prefix, visitField)
		return
	}

	if (node.properties || node.optionalProperties) {
		for (const [key, sub] of Object.entries({
			...node.properties,
			...node.optionalProperties,
		})) {
			const path = prefix ? `${prefix}.${key}` : key
			visitField(path, sub)
			walkSchemaFields(sub, path, visitField)
		}
		return
	}

	if (node.elements) {
		walkSchemaFields(node.elements, prefix ? `${prefix}.$` : '$', visitField)
	}
}

function withFlattenedPaths(paths) {
	const flattened = new Set(paths)
	for (const path of paths) {
		const dot = path.indexOf('.')
		if (dot !== -1) {
			flattened.add(path.slice(dot + 1))
		}
	}
	return flattened
}

/**
 * Walk JTD schema collecting all valid dot-separated field paths.
 * Returns a Set including both keyed paths and flattened paths
 * (first segment stripped) to match flattenLoaderMock behavior.
 * @param {object} schema - page-level JTD schema
 * @returns {Set<string>}
 */
export function collectSchemaPaths(schema) {
	const paths = new Set()
	walkSchemaFields(schema, '', (path) => paths.add(path))
	return withFlattenedPaths(paths)
}

/**
 * Standard Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
	const m = a.length
	const n = b.length
	const dp = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0))
	for (let i = 0; i <= m; i++) dp[i][0] = i
	for (let j = 0; j <= n; j++) dp[0][j] = j
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				a[i - 1] === b[j - 1]
					? dp[i - 1][j - 1]
					: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
		}
	}
	return dp[m][n]
}

/**
 * Return the closest candidate within Levenshtein distance <= 3, or null.
 * @param {string} name
 * @param {Iterable<string>} candidates
 * @returns {string | null}
 */
export function didYouMean(name, candidates) {
	let best = null
	let bestDist = 4
	for (const candidate of candidates) {
		const distance = levenshtein(name, candidate)
		if (distance < bestDist) {
			bestDist = distance
			best = candidate
		}
	}
	return best
}

export function collectHtmlPaths(schema) {
	const paths = new Set()

	walkSchemaFields(schema, '', (path, node) => {
		if (node?.type === 'string' && node.metadata?.format === 'html') {
			paths.add(path)
		}
	})

	return withFlattenedPaths(paths)
}
