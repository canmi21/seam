/* packages/server/core/typescript/src/router/index.ts */

import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure } from "./handler.js";
import type { InternalSubscription } from "../procedure.js";
import type { HandlePageResult } from "../page/handler.js";
import type { PageDef } from "../page/index.js";
import { buildManifest } from "../manifest/index.js";
import { handleRequest, handleSubscription } from "./handler.js";
import { handlePageRequest } from "../page/handler.js";
import { RouteMatcher } from "../page/route-matcher.js";

export interface ProcedureDef<TIn = unknown, TOut = unknown> {
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  handler: (params: { input: TIn }) => TOut | Promise<TOut>;
}

export interface SubscriptionDef<TIn = unknown, TOut = unknown> {
  type: "subscription";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  handler: (params: { input: TIn }) => AsyncIterable<TOut>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefinitionMap = Record<string, ProcedureDef<any, any> | SubscriptionDef<any, any>>;

/** @deprecated Use DefinitionMap instead */
export type ProcedureMap = DefinitionMap;

function isSubscriptionDef(def: ProcedureDef | SubscriptionDef): def is SubscriptionDef {
  return "type" in def && def.type === "subscription";
}

export interface RouterOptions {
  pages?: Record<string, PageDef>;
  validateOutput?: boolean;
}

export interface Router<T extends DefinitionMap> {
  manifest(): ProcedureManifest;
  handle(procedureName: string, body: unknown): Promise<HandleResult>;
  handleSubscription(name: string, input: unknown): AsyncIterable<unknown>;
  handlePage(path: string): Promise<HandlePageResult | null>;
  readonly hasPages: boolean;
  /** Exposed for adapter access to the definitions */
  readonly procedures: T;
}

export function createRouter<T extends DefinitionMap>(
  procedures: T,
  opts?: RouterOptions,
): Router<T> {
  const procedureMap = new Map<string, InternalProcedure>();
  const subscriptionMap = new Map<string, InternalSubscription>();

  for (const [name, def] of Object.entries(procedures)) {
    if (isSubscriptionDef(def)) {
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

  const shouldValidateOutput =
    opts?.validateOutput ??
    (typeof process !== "undefined" && process.env.NODE_ENV !== "production");

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
      return handleRequest(procedureMap, procedureName, body, shouldValidateOutput);
    },
    handleSubscription(name, input) {
      return handleSubscription(subscriptionMap, name, input, shouldValidateOutput);
    },
    async handlePage(path) {
      const match = pageMatcher.match(path);
      if (!match) return null;
      return handlePageRequest(match.value, match.params, procedureMap);
    },
  };
}
