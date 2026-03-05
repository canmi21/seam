/* src/server/core/typescript/src/procedure.ts */

import type { Schema } from 'jtd'

export interface HandleResult {
  status: number
  body: unknown
}

export interface InternalProcedure {
  inputSchema: Schema
  outputSchema: Schema
  contextKeys: string[]
  handler: (params: { input: unknown; ctx: Record<string, unknown> }) => unknown
}

export interface InternalSubscription {
  inputSchema: Schema
  outputSchema: Schema
  contextKeys: string[]
  handler: (params: { input: unknown; ctx: Record<string, unknown> }) => AsyncIterable<unknown>
}

export interface InternalStream {
  inputSchema: Schema
  chunkOutputSchema: Schema
  contextKeys: string[]
  handler: (params: { input: unknown; ctx: Record<string, unknown> }) => AsyncGenerator<unknown>
}

export interface SeamFileHandle {
  stream(): ReadableStream<Uint8Array>
}

export interface InternalUpload {
  inputSchema: Schema
  outputSchema: Schema
  contextKeys: string[]
  handler: (params: {
    input: unknown
    file: SeamFileHandle
    ctx: Record<string, unknown>
  }) => unknown
}
