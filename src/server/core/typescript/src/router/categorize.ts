/* src/server/core/typescript/src/router/categorize.ts */

import type { DefinitionMap, ProcedureKind } from "./index.js";
import type { InternalProcedure } from "../procedure.js";
import type { InternalSubscription, InternalStream } from "../procedure.js";

function resolveKind(name: string, def: DefinitionMap[string]): ProcedureKind {
  if ("kind" in def && def.kind) return def.kind;
  if ("type" in def && def.type) {
    console.warn(
      `[seam] "${name}": "type" field in procedure definition is deprecated, use "kind" instead`,
    );
    return def.type;
  }
  return "query";
}

export interface CategorizedProcedures {
  procedureMap: Map<string, InternalProcedure>;
  subscriptionMap: Map<string, InternalSubscription>;
  streamMap: Map<string, InternalStream>;
  kindMap: Map<string, ProcedureKind>;
}

/** Split a flat definition map into typed procedure/subscription/stream maps */
export function categorizeProcedures(definitions: DefinitionMap): CategorizedProcedures {
  const procedureMap = new Map<string, InternalProcedure>();
  const subscriptionMap = new Map<string, InternalSubscription>();
  const streamMap = new Map<string, InternalStream>();
  const kindMap = new Map<string, ProcedureKind>();

  for (const [name, def] of Object.entries(definitions)) {
    const kind = resolveKind(name, def);
    kindMap.set(name, kind);

    if (kind === "stream") {
      streamMap.set(name, {
        inputSchema: def.input._schema,
        chunkOutputSchema: def.output._schema,
        handler: def.handler as InternalStream["handler"],
      });
    } else if (kind === "subscription") {
      subscriptionMap.set(name, {
        inputSchema: def.input._schema,
        outputSchema: def.output._schema,
        handler: def.handler as InternalSubscription["handler"],
      });
    } else {
      procedureMap.set(name, {
        inputSchema: def.input._schema,
        outputSchema: def.output._schema,
        handler: def.handler as InternalProcedure["handler"],
      });
    }
  }

  return { procedureMap, subscriptionMap, streamMap, kindMap };
}
