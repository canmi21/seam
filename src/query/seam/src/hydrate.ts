/* src/query/seam/src/hydrate.ts */

import type { QueryClient } from '@tanstack/query-core'

// Module-level store for server-computed derive results
let hydratedDerived: Record<string, unknown> | null = null
let sharedQueryClient: QueryClient | null = null
let pendingLoaderEntries: Array<{ procedure: string; input: unknown; data: unknown }> = []

/** Register the active QueryClient for non-hook cache sync (e.g. router SPA loaders). */
export function registerSharedQueryClient(queryClient: QueryClient): void {
	sharedQueryClient = queryClient
	if (pendingLoaderEntries.length > 0) {
		for (const entry of pendingLoaderEntries) {
			sharedQueryClient.setQueryData([entry.procedure, entry.input], entry.data)
		}
		pendingLoaderEntries = []
	}
}

/** Remove the registered QueryClient when the owner provider unmounts. */
export function unregisterSharedQueryClient(queryClient: QueryClient): void {
	if (sharedQueryClient === queryClient) {
		sharedQueryClient = null
	}
}

/** Clear the registered QueryClient (primarily for tests). */
export function clearSharedQueryClient(): void {
	sharedQueryClient = null
	pendingLoaderEntries = []
}

/** Write a loader result into the registered QueryClient cache when available. */
export function cacheLoaderData(procedure: string, input: unknown, data: unknown): void {
	if (sharedQueryClient) {
		sharedQueryClient.setQueryData([procedure, input], data)
		return
	}
	pendingLoaderEntries.push({ procedure, input, data })
}

/** Retrieve hydrated __derived values (set during hydrateFromSeamData). */
export function getHydratedDerived(): Record<string, unknown> | null {
	return hydratedDerived
}

/** Hydrate QueryClient cache from server-rendered __data with __loaders metadata. */
export function hydrateFromSeamData(
	queryClient: QueryClient,
	seamData: Record<string, unknown>,
): void {
	const loaders = seamData.__loaders as
		| Record<string, { procedure: string; input: unknown; error?: boolean }>
		| undefined
	if (!loaders) return
	for (const [key, meta] of Object.entries(loaders)) {
		if (meta.error) continue
		const data = seamData[key]
		if (data === undefined) continue
		queryClient.setQueryData([meta.procedure, meta.input], data)
	}

	// Store __derived for useSeamDerive first-render access
	const derived = seamData.__derived as Record<string, unknown> | undefined
	if (derived) {
		hydratedDerived = derived
	}
}
