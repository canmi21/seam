/* src/client/vanilla/src/prefetch-cache.ts */

type CacheEntry = { data: unknown; timestamp: number; ttl: number }

const dataCache = new Map<string, CacheEntry>()
const pendingCache = new Map<string, Promise<unknown>>()

function cacheKey(procedure: string, input: unknown): string {
	return `${procedure}:${JSON.stringify(input)}`
}

/** Returns cached Promise or undefined. Checks data (with TTL) then pending. */
export function getFromCache(procedure: string, input: unknown): Promise<unknown> | undefined {
	const key = cacheKey(procedure, input)
	const entry = dataCache.get(key)
	if (entry) {
		if (Date.now() - entry.timestamp < entry.ttl * 1000) {
			return Promise.resolve(entry.data)
		}
		dataCache.delete(key)
	}
	return pendingCache.get(key)
}

/** Store an in-flight promise; on resolve, move to data cache. */
export function storePending(
	procedure: string,
	input: unknown,
	promise: Promise<unknown>,
	ttl: number,
): void {
	const key = cacheKey(procedure, input)
	const wrapped = promise.then((data) => {
		pendingCache.delete(key)
		dataCache.set(key, { data, timestamp: Date.now(), ttl })
		return data
	})
	pendingCache.set(key, wrapped)
}

export function clearPrefetchCache(): void {
	dataCache.clear()
	pendingCache.clear()
}
