/* packages/server/core/typescript/src/router/index.ts */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure } from "./handler.js";
import type { InternalSubscription } from "../procedure.js";
import type { HandlePageResult } from "../page/handler.js";
import type { PageDef, I18nConfig } from "../page/index.js";
import type { ChannelResult, ChannelMeta } from "../channel.js";
import { buildManifest } from "../manifest/index.js";
import { handleRequest, handleSubscription, handleBatchRequest } from "./handler.js";
import type { BatchCall, BatchResultItem } from "./handler.js";
import { handlePageRequest } from "../page/handler.js";
import { RouteMatcher } from "../page/route-matcher.js";
import { defaultStrategies, resolveChain } from "../resolve.js";
import type { ResolveStrategy } from "../resolve.js";

export interface ProcedureDef<TIn = unknown, TOut = unknown> {
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  handler: (params: { input: TIn }) => TOut | Promise<TOut>;
}

export interface CommandDef<TIn = unknown, TOut = unknown> {
  type: "command";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  handler: (params: { input: TIn }) => TOut | Promise<TOut>;
}

export interface SubscriptionDef<TIn = unknown, TOut = unknown> {
  type: "subscription";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  handler: (params: { input: TIn }) => AsyncIterable<TOut>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DefinitionMap = Record<
  string,
  ProcedureDef<any, any> | CommandDef<any, any> | SubscriptionDef<any, any>
>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function isSubscriptionDef(
  def: ProcedureDef | CommandDef | SubscriptionDef,
): def is SubscriptionDef {
  return "type" in def && def.type === "subscription";
}

export interface RouterOptions {
  pages?: Record<string, PageDef>;
  i18n?: I18nConfig | null;
  validateOutput?: boolean;
  resolve?: ResolveStrategy[];
  channels?: ChannelResult[];
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

/** Build the resolve strategy list from options */
function buildStrategies(opts?: RouterOptions): {
  strategies: ResolveStrategy[];
  hasUrlPrefix: boolean;
} {
  const strategies = opts?.resolve ?? defaultStrategies();
  return {
    strategies,
    hasUrlPrefix: strategies.some((s) => s.kind === "url_prefix"),
  };
}

/** Register built-in __seam_i18n_query procedure (route-hash-based lookup) */
function registerI18nQuery(procedureMap: Map<string, InternalProcedure>, config: I18nConfig): void {
  procedureMap.set("__seam_i18n_query", {
    inputSchema: {},
    outputSchema: {},
    handler: ({ input }) => {
      const { route, locale } = input as { route: string; locale: string };
      const messages = lookupI18nMessages(config, route, locale);
      const hash = config.contentHashes[route]?.[locale] ?? "";
      return { hash, messages };
    },
  });
}

/** Look up messages by route hash + locale for RPC query */
function lookupI18nMessages(
  config: I18nConfig,
  routeHash: string,
  locale: string,
): Record<string, string> {
  if (config.mode === "paged" && config.distDir) {
    const filePath = join(config.distDir, "i18n", routeHash, `${locale}.json`);
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string>;
    }
    return {};
  }
  return config.messages[locale]?.[routeHash] ?? {};
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
      // Both ProcedureDef (query) and CommandDef share the same handler path
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

  // Collect channel metadata for manifest
  const channelsMeta: Record<string, ChannelMeta> | undefined =
    opts?.channels && opts.channels.length > 0
      ? Object.fromEntries(
          opts.channels.map((ch) => {
            // Derive name from the first procedure key prefix
            const firstKey = Object.keys(ch.procedures)[0] ?? "";
            const name = firstKey.includes(".")
              ? firstKey.slice(0, firstKey.indexOf("."))
              : firstKey;
            return [name, ch.channelMeta];
          }),
        )
      : undefined;

  return {
    procedures,
    hasPages: !!pages && Object.keys(pages).length > 0,
    manifest() {
      return buildManifest(procedures, channelsMeta);
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

      const i18nOpts =
        locale && i18nConfig
          ? { locale, config: i18nConfig, routePattern: match.pattern }
          : undefined;
      return handlePageRequest(match.value, match.params, procedureMap, i18nOpts);
    },
  };
}
