/* src/client/react/src/types.ts */

import type { ComponentType, ReactNode } from 'react'

export interface ParamMapping {
	from: string
	type?: 'string' | 'int'
}

export interface LoaderDef {
	procedure: string
	params?: Record<string, string | ParamMapping>
	handoff?: 'client'
}

/** Lazy component loader returned by dynamic import (per-page splitting) */
export type LazyComponentLoader = () => Promise<{
	default: ComponentType<Record<string, unknown>>
	[key: string]: unknown
}>

export interface HeadMeta {
	name?: string
	property?: string
	httpEquiv?: string
	content: string
	[key: string]: string | undefined
}

export interface HeadLink {
	rel: string
	href: string
	[key: string]: string | undefined
}

export interface HeadConfig {
	title?: string
	meta?: HeadMeta[]
	link?: HeadLink[]
}

export type HeadFn = (data: Record<string, unknown>) => HeadConfig

export interface RouteDef {
	path: string
	component?: ComponentType<Record<string, unknown>> | LazyComponentLoader
	layout?: ComponentType<{ children: ReactNode }>
	children?: RouteDef[]
	loaders?: Record<string, LoaderDef>
	mock?: Record<string, unknown>
	nullable?: string[]
	staleTime?: number
	head?: HeadConfig | HeadFn
	/** Internal: override layout ID for group layouts to avoid toLayoutId collision */
	_layoutId?: string
}
