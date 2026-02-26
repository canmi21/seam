/* packages/server/core/typescript/src/router/index.ts */

import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure } from "./handler.js";
import type { InternalSubscription } from "../procedure.js";
import type { HandlePageResult } from "../page/handler.js";
import type { PageDef, I18nConfig } from "../page/index.js";
import { buildManifest } from "../manifest/index.js";
import { handleRequest, handleSubscription, handleBatchRequest } from "./handler.js";
import type { BatchCall, BatchResultItem } from "./handler.js";
import { handlePageRequest } from "../page/handler.js";
import { RouteMatcher } from "../page/route-matcher.js";
import { defaultStrategies, resolveChain } from "../resolve.js";
import type { ResolveLocaleFn, ResolveStrategy, ResolveData } from "../resolve.js";

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

function isSubscriptionDef(def: ProcedureDef | SubscriptionDef): def is SubscriptionDef {
  return "type" in def && def.type === "subscription";
}

export interface RouterOptions {
  pages?: Record<string, PageDef>;
  i18n?: I18nConfig | null;
  validateOutput?: boolean;
  resolveLocale?: ResolveLocaleFn;
  resolveStrategies?: ResolveStrategy[];
}

export interface PageRequestHeaders {
  url?: string;
  cookie?: string;
  acceptLanguage?: string;
}

export interface Router<T extends DefinitionMap> {
  manifest(): ProcedureManifest;
  handle(procedureName: string, body: unknown): Promise<HandleResult>;
  handleBatch(calls: BatchCall[]): Promise<{ results: BatchResultItem[] }>;
  handleSubscription(name: string, input: unknown): AsyncIterable<unknown>;
  handlePage(path: string, headers?: PageRequestHeaders): Promise<HandlePageResult | null>;
  readonly hasPages: boolean;
  /** Exposed for adapter access to the definitions */
  readonly procedures: T;
}

/** Build the resolve strategy list from options, wrapping legacy resolveLocale if needed */
function buildStrategies(opts?: RouterOptions): { strategies: ResolveStrategy[]; hasUrlPrefix: boolean } {
  if (opts?.resolveStrategies) {
    return {
      strategies: opts.resolveStrategies,
      hasUrlPrefix: opts.resolveStrategies.some((s) => s.kind === "url_prefix"),
    };
  }
  if (opts?.resolveLocale) {
    const legacyFn = opts.resolveLocale;
    return {
      strategies: [{
        kind: "legacy",
        resolve: (data: ResolveData) => legacyFn({
          pathLocale: data.pathLocale,
          cookie: data.cookie,
          acceptLanguage: data.acceptLanguage,
          locales: data.locales,
          defaultLocale: data.defaultLocale,
        }),
      }],
      hasUrlPrefix: true, // backward compat: always extract prefix
    };
  }
  return { strategies: defaultStrategies(), hasUrlPrefix: true };
}

/** Register built-in __seam_i18n_query procedure */
function registerI18nQuery(procedureMap: Map<string, InternalProcedure>, config: I18nConfig): void {
  procedureMap.set("__seam_i18n_query", {
    inputSchema: {},
    outputSchema: {},
    handler: ({ input }) => {
      const { keys, locale } = input as { keys: string[]; locale: string };
      const msgs = config.messages[locale] ?? config.messages[config.default] ?? {};
      const messages: Record<string, string> = {};
      for (const k of keys) {
        messages[k] = msgs[k] ?? k;
      }
      return { messages };
    },
  });
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
  const { strategies, hasUrlPrefix } = buildStrategies(opts);
  if (i18nConfig) registerI18nQuery(procedureMap, i18nConfig);

  return {
    procedures,
    hasPages: !!pages && Object.keys(pages).length > 0,
    manifest() {
      return buildManifest(procedures);
    },
    handle(procedureName, body) {
      return handleRequest(procedureMap, procedureName, body, shouldValidateOutput);
    },
    handleBatch(calls) {
      return handleBatchRequest(procedureMap, calls, shouldValidateOutput);
    },
    handleSubscription(name, input) {
      return handleSubscription(subscriptionMap, name, input, shouldValidateOutput);
    },
    async handlePage(path, headers) {
      let pathLocale: string | null = null;
      let routePath = path;

      if (hasUrlPrefix && i18nConfig) {
        const segments = path.split("/").filter(Boolean);
        const localeSet = new Set(i18nConfig.locales);
        if (segments.length > 0 && localeSet.has(segments[0])) {
          pathLocale = segments[0];
          routePath = "/" + segments.slice(1).join("/") || "/";
        }
      }

      let locale: string | undefined;
      if (i18nConfig) {
        locale = resolveChain(strategies, {
          url: headers?.url ?? "",
          pathLocale,
          cookie: headers?.cookie,
          acceptLanguage: headers?.acceptLanguage,
          locales: i18nConfig.locales,
          defaultLocale: i18nConfig.default,
        });
      }

      const match = pageMatcher.match(routePath);
      if (!match) return null;

      const i18nOpts = locale && i18nConfig ? { locale, config: i18nConfig } : undefined;
      return handlePageRequest(match.value, match.params, procedureMap, i18nOpts);
    },
  };
}
