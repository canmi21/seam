import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure } from "./handler.js";
import { buildManifest } from "../manifest/index.js";
import { handleRequest } from "./handler.js";

export interface ProcedureDef<TIn = unknown, TOut = unknown> {
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  handler: (params: { input: TIn }) => TOut | Promise<TOut>;
}

export type ProcedureMap = Record<string, ProcedureDef<any, any>>;

export interface Router<T extends ProcedureMap> {
  manifest(): ProcedureManifest;
  handle(procedureName: string, body: unknown): Promise<HandleResult>;
  /** Exposed for adapter access to the procedure definitions */
  readonly procedures: T;
}

export function createRouter<T extends ProcedureMap>(procedures: T): Router<T> {
  const internalMap = new Map<string, InternalProcedure>();

  for (const [name, def] of Object.entries(procedures)) {
    internalMap.set(name, {
      inputSchema: def.input._schema,
      outputSchema: def.output._schema,
      handler: def.handler as InternalProcedure["handler"],
    });
  }

  return {
    procedures,
    manifest() {
      return buildManifest(procedures);
    },
    handle(procedureName, body) {
      return handleRequest(internalMap, procedureName, body);
    },
  };
}
