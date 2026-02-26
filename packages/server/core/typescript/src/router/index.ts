/* packages/server/core/typescript/src/router/index.ts */

import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure, ProcedureCtx } from "./handler.js";
import type { InternalSubscription } from "../procedure.js";
import type { HandlePageResult } from "../page/handler.js";
import type { PageDef, I18nConfig } from "../page/index.js";
import { buildManifest } from "../manifest/index.js";
import { handleRequest, handleSubscription, handleBatchRequest } from "./handler.js";
import type { BatchCall, BatchResultItem } from "./handler.js";
import { handlePageRequest } from "../page/handler.js";
import { RouteMatcher } from "../page/route-matcher.js";

export interface ProcedureDef<TIn = unknown, TOut = unknown> {
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  handler: (params: { input: TIn; ctx?: ProcedureCtx }) => TOut | Promise<TOut>;
}

export interface SubscriptionDef<TIn = unknown, TOut = unknown> {
  type: "subscription";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  handler: (params: { input: TIn; ctx?: ProcedureCtx }) => AsyncIterable<TOut>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefinitionMap = Record<string, ProcedureDef<any, any> | SubscriptionDef<any, any>>;

function isSubscriptionDef(def: ProcedureDef | SubscriptionDef): def is SubscriptionDef {
  return "type" in def && def.type === "subscription";
}

export interface RouterOptions {
  pages?: Record<string, PageDef>;
  i18n?: I18nConfig | null;
  validateOutput?: boolean;
}

export interface Router<T extends DefinitionMap> {
  manifest(): ProcedureManifest;
  handle(procedureName: string, body: unknown, ctx?: ProcedureCtx): Promise<HandleResult>;
  handleBatch(calls: BatchCall[], ctx?: ProcedureCtx): Promise<{ results: BatchResultItem[] }>;
  handleSubscription(name: string, input: unknown, ctx?: ProcedureCtx): AsyncIterable<unknown>;
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

  const i18nConfig = opts?.i18n ?? null;
  const localeSet = i18nConfig ? new Set(i18nConfig.locales) : null;

  // Register built-in __seam_i18n_query procedure when i18n is configured
  if (i18nConfig) {
    procedureMap.set("__seam_i18n_query", {
      inputSchema: {},
      outputSchema: {},
      handler: ({ input }) => {
        const { keys, locale } = input as { keys: string[]; locale: string };
        const msgs = i18nConfig.messages[locale] ?? i18nConfig.messages[i18nConfig.default] ?? {};
        const messages: Record<string, string> = {};
        for (const k of keys) {
          messages[k] = msgs[k] ?? k;
        }
        return { messages };
      },
    });
  }

  return {
    procedures,
    hasPages: !!pages && Object.keys(pages).length > 0,
    manifest() {
      return buildManifest(procedures);
    },
    handle(procedureName, body, ctx) {
      return handleRequest(procedureMap, procedureName, body, shouldValidateOutput, ctx);
    },
    handleBatch(calls, ctx) {
      return handleBatchRequest(procedureMap, calls, shouldValidateOutput, ctx);
    },
    handleSubscription(name, input, ctx) {
      return handleSubscription(subscriptionMap, name, input, shouldValidateOutput, ctx);
    },
    async handlePage(path) {
      let locale: string | undefined;

      // Extract locale prefix from URL path when i18n is configured
      if (localeSet && i18nConfig) {
        const segments = path.split("/").filter(Boolean);
        if (segments.length > 0 && localeSet.has(segments[0])) {
          locale = segments[0];
          path = "/" + segments.slice(1).join("/");
          if (path === "/") path = "/"; // normalize
        } else {
          locale = i18nConfig.default;
        }
      }

      const match = pageMatcher.match(path);
      if (!match) return null;

      const i18nOpts = locale && i18nConfig ? { locale, config: i18nConfig } : undefined;
      return handlePageRequest(match.value, match.params, procedureMap, i18nOpts);
    },
  };
}
