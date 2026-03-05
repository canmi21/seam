/* src/server/core/typescript/src/page/projection.ts */

export type ProjectionMap = Record<string, string[]>

/** Set a nested field by dot-separated path, creating intermediate objects as needed. */
function setNestedField(target: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split('.')
	let current: Record<string, unknown> = target
	for (let i = 0; i < parts.length - 1; i++) {
		const key = parts[i] as string
		if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
			current[key] = {}
		}
		current = current[key] as Record<string, unknown>
	}
	current[parts[parts.length - 1] as string] = value
}

/** Get a nested field by dot-separated path. */
function getNestedField(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split('.')
	let current: unknown = source
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== 'object') {
			return undefined
		}
		current = (current as Record<string, unknown>)[part]
	}
	return current
}

/** Prune a single value according to its projected field paths. */
function pruneValue(value: unknown, fields: string[]): unknown {
	// Separate $ paths (array element fields) from plain paths
	const arrayFields: string[] = []
	const plainFields: string[] = []

	for (const f of fields) {
		if (f === '$') {
			// Standalone $ means keep entire array elements — return value as-is
			return value
		} else if (f.startsWith('$.')) {
			arrayFields.push(f.slice(2))
		} else {
			plainFields.push(f)
		}
	}

	if (arrayFields.length > 0 && Array.isArray(value)) {
		return value.map((item: unknown) => {
			if (typeof item !== 'object' || item === null) return item
			const pruned: Record<string, unknown> = {}
			for (const field of arrayFields) {
				const val = getNestedField(item as Record<string, unknown>, field)
				if (val !== undefined) {
					setNestedField(pruned, field, val)
				}
			}
			return pruned
		})
	}

	if (plainFields.length > 0 && typeof value === 'object' && value !== null) {
		const source = value as Record<string, unknown>
		const pruned: Record<string, unknown> = {}
		for (const field of plainFields) {
			const val = getNestedField(source, field)
			if (val !== undefined) {
				setNestedField(pruned, field, val)
			}
		}
		return pruned
	}

	return value
}

/** Prune data to only include projected fields. Missing projection = keep all. */
export function applyProjection(
	data: Record<string, unknown>,
	projections: ProjectionMap | undefined,
): Record<string, unknown> {
	if (!projections) return data

	const result: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(data)) {
		const fields = projections[key]
		if (!fields) {
			// No projection for this key — keep full value
			result[key] = value
		} else {
			result[key] = pruneValue(value, fields)
		}
	}
	return result
}
