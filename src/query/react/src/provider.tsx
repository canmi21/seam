/* src/query/react/src/provider.tsx */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { hydrateFromSeamData } from '@canmi/seam-query'
import type { LoaderDef, ProcedureConfigMap, RpcFn } from '@canmi/seam-query'
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
	initialData?: Record<string, unknown>
	loaderDefs?: Record<string, LoaderDef>
	children: ReactNode
}

export function SeamQueryProvider({
	rpcFn,
	config,
	queryClient: externalClient,
	initialData,
	loaderDefs,
	children,
}: SeamQueryProviderProps) {
	const [defaultClient] = useState(() => new QueryClient())
	const client = externalClient ?? defaultClient
	const hydrated = useRef(false)

	if (!hydrated.current && initialData && loaderDefs) {
		hydrateFromSeamData(client, initialData, loaderDefs)
		hydrated.current = true
	}

	return (
		<SeamQueryContext value={{ rpcFn, config }}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</SeamQueryContext>
	)
}
