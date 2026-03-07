/* src/query/react/src/provider.tsx */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { hydrateFromSeamData } from '@canmi/seam-query'
import type { ProcedureConfigMap, RpcFn } from '@canmi/seam-query'
import { createContext, useContext, useRef, useState, type ReactNode } from 'react'

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
	const [defaultClient] = useState(() => new QueryClient())
	const client = externalClient ?? defaultClient
	const hydrated = useRef(false)

	if (!hydrated.current) {
		if (typeof document !== 'undefined') {
			try {
				const el = document.getElementById(dataId ?? '__data')
				if (el?.textContent) {
					hydrateFromSeamData(client, JSON.parse(el.textContent) as Record<string, unknown>)
				}
			} catch {
				/* no __data — skip */
			}
		}
		hydrated.current = true
	}

	return (
		<SeamQueryContext value={{ rpcFn, config }}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</SeamQueryContext>
	)
}
