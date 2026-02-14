/* packages/server/src/router/index.ts */

import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure } from "./handler.js";
import type { HandlePageResult } from "../page/handler.js";
import type { PageDef } from "../page/index.js";
import { buildManifest } from "../manifest/index.js";
import { handleRequest } from "./handler.js";
import { handlePageRequest } from "../page/handler.js";
import { RouteMatcher } from "../page/route-matcher.js";

export interface ProcedureDef<TIn = unknown, TOut = unknown> {
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  handler: (params: { input: TIn }) => TOut | Promise<TOut>;
}

export type ProcedureMap = Record<string, ProcedureDef<any, any>>;

export interface RouterOptions {
  pages?: Record<string, PageDef>;
}

export interface Router<T extends ProcedureMap> {
  manifest(): ProcedureManifest;
  handle(procedureName: string, body: unknown): Promise<HandleResult>;
  handlePage(path: string): Promise<HandlePageResult | null>;
  readonly hasPages: boolean;
  /** Exposed for adapter access to the procedure definitions */
  readonly procedures: T;
}

export function createRouter<T extends ProcedureMap>(
  procedures: T,
  opts?: RouterOptions,
): Router<T> {
  const internalMap = new Map<string, InternalProcedure>();

  for (const [name, def] of Object.entries(procedures)) {
    internalMap.set(name, {
      inputSchema: def.input._schema,
      outputSchema: def.output._schema,
      handler: def.handler as InternalProcedure["handler"],
    });
  }

  const pageMatcher = new RouteMatcher<PageDef>();
  const pages = opts?.pages;
  if (pages) {
    for (const [pattern, page] of Object.entries(pages)) {
      pageMatcher.add(pattern, page);
    }
  }

  return {
    procedures,
    hasPages: !!pages && Object.keys(pages).length > 0,
    manifest() {
      return buildManifest(procedures);
    },
    handle(procedureName, body) {
      return handleRequest(internalMap, procedureName, body);
    },
    async handlePage(path) {
      const match = pageMatcher.match(path);
      if (!match) return null;
      return handlePageRequest(match.value, match.params, internalMap);
    },
  };
}
