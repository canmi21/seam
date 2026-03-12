/* src/client/react/scripts/mock-generator-schema.mjs */

const STRING_RULES = [
	{ test: (f) => /name/i.test(f), value: 'Example Name' },
	{ test: (f) => /url|href|src/i.test(f), value: 'https://example.com' },
	{ test: (f) => /email/i.test(f), value: 'user@example.com' },
	{ test: (f) => /color/i.test(f), value: '#888888' },
	{ test: (f) => /description|bio|summary/i.test(f), value: 'Sample description' },
	{ test: (f) => /title/i.test(f), value: 'Sample Title' },
	{ test: (f) => /^id$/i.test(f), value: 'sample-id' },
]

function inferStringValue(fieldPath) {
	const lastSegment = fieldPath ? fieldPath.split('.').pop() : ''
	for (const rule of STRING_RULES) {
		if (rule.test(lastSegment)) return rule.value
	}
	const label = lastSegment ? lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1) : 'text'
	return `Sample ${label}`
}

/**
 * Recursively traverse a JTD schema and produce deterministic mock values.
 * @param {object} schema - JTD schema node
 * @param {string} [fieldPath=""] - dot-separated path for semantic string inference
 * @returns {unknown}
 */
export function generateMockFromSchema(schema, fieldPath = '') {
	if (!schema || typeof schema !== 'object') return {}

	if (schema.nullable) {
		const inner = { ...schema }
		delete inner.nullable
		return generateMockFromSchema(inner, fieldPath)
	}

	if (schema.type === 'string' && schema.metadata?.format === 'html') {
		return '<p>Sample HTML content</p>'
	}

	if (schema.type) {
		switch (schema.type) {
			case 'string':
				return inferStringValue(fieldPath)
			case 'boolean':
				return true
			case 'int8':
			case 'int16':
			case 'int32':
			case 'uint8':
			case 'uint16':
			case 'uint32':
			case 'float32':
			case 'float64':
				return 1
			case 'timestamp':
				return '2024-01-01T00:00:00Z'
			default:
				return `Sample ${schema.type}`
		}
	}

	if (schema.enum) {
		return schema.enum[0]
	}

	if (schema.properties || schema.optionalProperties) {
		const result = {}
		const props = schema.properties || {}
		const optProps = schema.optionalProperties || {}
		for (const [key, sub] of Object.entries(props)) {
			result[key] = generateMockFromSchema(sub, fieldPath ? `${fieldPath}.${key}` : key)
		}
		for (const [key, sub] of Object.entries(optProps)) {
			result[key] = generateMockFromSchema(sub, fieldPath ? `${fieldPath}.${key}` : key)
		}
		return result
	}

	if (schema.elements) {
		return [
			generateMockFromSchema(schema.elements, fieldPath ? `${fieldPath}.$` : '$'),
			generateMockFromSchema(schema.elements, fieldPath ? `${fieldPath}.$` : '$'),
		]
	}

	if (schema.values) {
		return {
			item1: generateMockFromSchema(schema.values, fieldPath ? `${fieldPath}.item1` : 'item1'),
			item2: generateMockFromSchema(schema.values, fieldPath ? `${fieldPath}.item2` : 'item2'),
		}
	}

	if (schema.discriminator && schema.mapping) {
		const tag = schema.discriminator
		const mappingKeys = Object.keys(schema.mapping)
		if (mappingKeys.length === 0) return { [tag]: '' }
		const firstKey = mappingKeys[0]
		const variant = generateMockFromSchema(schema.mapping[firstKey], fieldPath)
		return { [tag]: firstKey, ...variant }
	}

	return {}
}

/**
 * Replicate page handler's merge logic: keyed loader data flattened
 * so that top-level keys from each loader's object result are also
 * accessible at the root level.
 * @param {Record<string, unknown>} keyedMock
 * @returns {Record<string, unknown>}
 */
export function flattenLoaderMock(keyedMock) {
	const flat = { ...keyedMock }
	for (const value of Object.values(keyedMock)) {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			Object.assign(flat, value)
		}
	}
	return flat
}

/**
 * Build a populated structural sample from schema + actual mock data.
 * This keeps the caller's real mock untouched while ensuring skeleton extraction
 * still has a representative item for populated array / nullable-object branches.
 * @param {object} schema
 * @param {unknown} data
 * @param {string} [fieldPath=""]
 * @returns {unknown}
 */
export function buildStructuralSample(schema, data, fieldPath = '') {
	if (!schema || typeof schema !== 'object') return data

	if (schema.nullable) {
		const inner = { ...schema }
		delete inner.nullable
		const seed =
			data === null || data === undefined ? generateMockFromSchema(inner, fieldPath) : data
		return buildStructuralSample(inner, seed, fieldPath)
	}

	if (schema.elements) {
		const itemPath = fieldPath ? `${fieldPath}.$` : '$'
		const item =
			Array.isArray(data) && data.length > 0
				? data[0]
				: generateMockFromSchema(schema.elements, itemPath)
		return [buildStructuralSample(schema.elements, item, itemPath)]
	}

	if (schema.properties || schema.optionalProperties) {
		const input = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
		const result = {}
		for (const [key, sub] of Object.entries({
			...schema.properties,
			...schema.optionalProperties,
		})) {
			const path = fieldPath ? `${fieldPath}.${key}` : key
			result[key] = buildStructuralSample(sub, input[key], path)
		}
		return result
	}

	if (schema.values || (schema.discriminator && schema.mapping)) {
		return data === undefined ? generateMockFromSchema(schema, fieldPath) : data
	}

	return data === undefined ? generateMockFromSchema(schema, fieldPath) : data
}

/**
 * Deep merge base with override:
 * - object + object -> recursive merge
 * - array in override -> replaces entirely
 * - primitive/null in override -> replaces
 * - keys only in base -> preserved
 * @param {unknown} base
 * @param {unknown} override
 * @returns {unknown}
 */
export function deepMerge(base, override) {
	if (override === null || override === undefined) return override
	if (typeof override !== 'object' || Array.isArray(override)) return override
	if (typeof base !== 'object' || base === null || Array.isArray(base)) return override

	const result = { ...base }
	for (const [key, val] of Object.entries(override)) {
		if (
			key in result &&
			typeof result[key] === 'object' &&
			result[key] !== null &&
			!Array.isArray(result[key]) &&
			typeof val === 'object' &&
			val !== null &&
			!Array.isArray(val)
		) {
			result[key] = deepMerge(result[key], val)
		} else {
			result[key] = val
		}
	}
	return result
}
