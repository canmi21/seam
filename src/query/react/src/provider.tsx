/* src/query/react/src/provider.tsx */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	hydrateFromSeamData,
	registerSharedQueryClient,
	unregisterSharedQueryClient,
} from '@canmi/seam-query'
import type { ProcedureConfigMap, RpcFn } from '@canmi/seam-query'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// Safe at module level — evaluated before skeleton renderer installs traps
const IS_SERVER = typeof window === 'undefined'

export interface SeamQueryContextValue {
	rpcFn: RpcFn
	config?: ProcedureConfigMap
}

const SeamQueryContext = createContext<SeamQueryContextValue | null>(null)

export function useSeamQueryContext(): SeamQueryContextValue {
	const ctx = useContext(SeamQueryContext)
	if (!ctx) throw new Error('useSeamQuery must be used inside <SeamQueryProvider>')
	return ctx
}

export interface SeamQueryProviderProps {
	rpcFn: RpcFn
	config?: ProcedureConfigMap
	queryClient?: QueryClient
	dataId?: string
	children: ReactNode
}

export function SeamQueryProvider({
	rpcFn,
	config,
	queryClient: externalClient,
	dataId,
	children,
}: SeamQueryProviderProps) {
	// On server, skip QueryClient creation to avoid Date.now() trap in skeleton rendering
	const [defaultClient] = useState(() => (IS_SERVER ? null : new QueryClient()))
	const client = IS_SERVER ? null : (externalClient ?? defaultClient)
	const hydrated = useRef(false)

	if (!IS_SERVER && client) {
		registerSharedQueryClient(client)
	}

	useEffect(() => {
		if (!client) return
		return () => {
			unregisterSharedQueryClient(client)
		}
	}, [client])

	if (!IS_SERVER && client && !hydrated.current) {
		try {
			const el = document.getElementById(dataId ?? '__data')
			if (el?.textContent) {
				hydrateFromSeamData(client, JSON.parse(el.textContent) as Record<string, unknown>)
			}
		} catch {
			/* no __data — skip */
		}
		hydrated.current = true
	}

	// Server: passthrough with context only, no QueryClientProvider
	if (IS_SERVER || !client) {
		return <SeamQueryContext value={{ rpcFn, config }}>{children}</SeamQueryContext>
	}

	return (
		<SeamQueryContext value={{ rpcFn, config }}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</SeamQueryContext>
	)
}
