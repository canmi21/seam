/* src/server/core/typescript/src/router/categorize.ts */

import type { DefinitionMap, ProcedureKind } from './index.js'
import type { InternalProcedure } from '../procedure.js'
import type { InternalSubscription, InternalStream, InternalUpload } from '../procedure.js'
import type { ContextConfig } from '../context.js'

function resolveKind(name: string, def: DefinitionMap[string]): ProcedureKind {
  if ('kind' in def && def.kind) return def.kind
  if ('type' in def && def.type) {
    console.warn(
      `[seam] "${name}": "type" field in procedure definition is deprecated, use "kind" instead`,
    )
    return def.type
  }
  return 'query'
}

export interface CategorizedProcedures {
  procedureMap: Map<string, InternalProcedure>
  subscriptionMap: Map<string, InternalSubscription>
  streamMap: Map<string, InternalStream>
  uploadMap: Map<string, InternalUpload>
  kindMap: Map<string, ProcedureKind>
}

/** Split a flat definition map into typed procedure/subscription/stream maps */
export function categorizeProcedures(
  definitions: DefinitionMap,
  contextConfig?: ContextConfig,
): CategorizedProcedures {
  const procedureMap = new Map<string, InternalProcedure>()
  const subscriptionMap = new Map<string, InternalSubscription>()
  const streamMap = new Map<string, InternalStream>()
  const uploadMap = new Map<string, InternalUpload>()
  const kindMap = new Map<string, ProcedureKind>()

  for (const [name, def] of Object.entries(definitions)) {
    const kind = resolveKind(name, def)
    kindMap.set(name, kind)
    const contextKeys = (def as { context?: string[] }).context ?? []

    // Validate context keys reference defined fields
    if (contextConfig && contextKeys.length > 0) {
      for (const key of contextKeys) {
        if (!(key in contextConfig)) {
          throw new Error(`Procedure "${name}" references undefined context field "${key}"`)
        }
      }
    }

    if (kind === 'upload') {
      uploadMap.set(name, {
        inputSchema: def.input._schema,
        outputSchema: def.output._schema,
        contextKeys,
        handler: def.handler as InternalUpload['handler'],
      })
    } else if (kind === 'stream') {
      streamMap.set(name, {
        inputSchema: def.input._schema,
        chunkOutputSchema: def.output._schema,
        contextKeys,
        handler: def.handler as InternalStream['handler'],
      })
    } else if (kind === 'subscription') {
      subscriptionMap.set(name, {
        inputSchema: def.input._schema,
        outputSchema: def.output._schema,
        contextKeys,
        handler: def.handler as InternalSubscription['handler'],
      })
    } else {
      procedureMap.set(name, {
        inputSchema: def.input._schema,
        outputSchema: def.output._schema,
        contextKeys,
        handler: def.handler as InternalProcedure['handler'],
      })
    }
  }

  return { procedureMap, subscriptionMap, streamMap, uploadMap, kindMap }
}
