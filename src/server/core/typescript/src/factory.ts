/* src/server/core/typescript/src/factory.ts */

import type { QueryDef, CommandDef, SubscriptionDef, StreamDef, UploadDef } from './router/index.js'

export function query<TIn, TOut>(
	def: Omit<QueryDef<TIn, TOut>, 'kind' | 'type'>,
): QueryDef<TIn, TOut> {
	return { ...def, kind: 'query' } as QueryDef<TIn, TOut>
}

export function command<TIn, TOut>(
	def: Omit<CommandDef<TIn, TOut>, 'kind' | 'type'>,
): CommandDef<TIn, TOut> {
	return { ...def, kind: 'command' } as CommandDef<TIn, TOut>
}

export function subscription<TIn, TOut>(
	def: Omit<SubscriptionDef<TIn, TOut>, 'kind' | 'type'>,
): SubscriptionDef<TIn, TOut> {
	return { ...def, kind: 'subscription' } as SubscriptionDef<TIn, TOut>
}

export function stream<TIn, TChunk>(
	def: Omit<StreamDef<TIn, TChunk>, 'kind'>,
): StreamDef<TIn, TChunk> {
	return { ...def, kind: 'stream' } as StreamDef<TIn, TChunk>
}

export function upload<TIn, TOut>(def: Omit<UploadDef<TIn, TOut>, 'kind'>): UploadDef<TIn, TOut> {
	return { ...def, kind: 'upload' } as UploadDef<TIn, TOut>
}
