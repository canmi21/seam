/* src/server/core/typescript/src/router/index.ts */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaNode } from "../types/schema.js";
import type { ProcedureManifest } from "../manifest/index.js";
import type { HandleResult, InternalProcedure } from "./handler.js";
import type { SeamFileHandle } from "../procedure.js";
import type { HandlePageResult } from "../page/handler.js";
import type { PageDef, I18nConfig } from "../page/index.js";
import type { ChannelResult, ChannelMeta } from "../channel.js";
import type { ContextConfig, RawContextMap } from "../context.js";
import { contextExtractKeys, resolveContext } from "../context.js";
import { SeamError } from "../errors.js";
import { buildManifest } from "../manifest/index.js";
import {
  handleRequest,
  handleSubscription,
  handleStream,
  handleBatchRequest,
  handleUploadRequest,
} from "./handler.js";
import type { BatchCall, BatchResultItem } from "./handler.js";
import { handlePageRequest } from "../page/handler.js";
import { RouteMatcher } from "../page/route-matcher.js";
import { defaultStrategies, resolveChain } from "../resolve.js";
import type { ResolveStrategy } from "../resolve.js";
import { categorizeProcedures } from "./categorize.js";

export type ProcedureKind = "query" | "command" | "subscription" | "stream" | "upload";

export type MappingValue = string | { from: string; each?: boolean };

export type InvalidateTarget =
  | string
  | {
      query: string;
      mapping?: Record<string, MappingValue>;
    };

export type TransportPreference = "http" | "sse" | "ws" | "ipc";

export interface TransportConfig {
  prefer: TransportPreference;
  fallback?: TransportPreference[];
}

export type CacheConfig = false | { ttl: number };

export interface ProcedureDef<TIn = unknown, TOut = unknown> {
  kind?: "query";
  /** @deprecated Use `kind` instead */
  type?: "query";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  context?: string[];
  transport?: TransportConfig;
  suppress?: string[];
  cache?: CacheConfig;
  handler: (params: { input: TIn; ctx: Record<string, unknown> }) => TOut | Promise<TOut>;
}

export interface CommandDef<TIn = unknown, TOut = unknown> {
  kind?: "command";
  /** @deprecated Use `kind` instead */
  type?: "command";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  context?: string[];
  invalidates?: InvalidateTarget[];
  transport?: TransportConfig;
  suppress?: string[];
  handler: (params: { input: TIn; ctx: Record<string, unknown> }) => TOut | Promise<TOut>;
}

export interface SubscriptionDef<TIn = unknown, TOut = unknown> {
  kind?: "subscription";
  /** @deprecated Use `kind` instead */
  type?: "subscription";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  context?: string[];
  transport?: TransportConfig;
  suppress?: string[];
  handler: (params: { input: TIn; ctx: Record<string, unknown> }) => AsyncIterable<TOut>;
}

export interface StreamDef<TIn = unknown, TChunk = unknown> {
  kind: "stream";
  input: SchemaNode<TIn>;
  output: SchemaNode<TChunk>;
  error?: SchemaNode;
  context?: string[];
  transport?: TransportConfig;
  suppress?: string[];
  handler: (params: { input: TIn; ctx: Record<string, unknown> }) => AsyncGenerator<TChunk>;
}

export interface UploadDef<TIn = unknown, TOut = unknown> {
  kind: "upload";
  input: SchemaNode<TIn>;
  output: SchemaNode<TOut>;
  error?: SchemaNode;
  context?: string[];
  transport?: TransportConfig;
  suppress?: string[];
  handler: (params: {
    input: TIn;
    file: SeamFileHandle;
    ctx: Record<string, unknown>;
  }) => TOut | Promise<TOut>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type DefinitionMap = Record<
  string,
  | ProcedureDef<any, any>
  | CommandDef<any, any>
  | SubscriptionDef<any, any>
  | StreamDef<any, any>
  | UploadDef<any, any>
>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface RouterOptions {
  pages?: Record<string, PageDef>;
  i18n?: I18nConfig | null;
  validateOutput?: boolean;
  resolve?: ResolveStrategy[];
  channels?: ChannelResult[];
  context?: ContextConfig;
  transportDefaults?: Partial<Record<ProcedureKind, TransportConfig>>;
}

export interface PageRequestHeaders {
  url?: string;
  cookie?: string;
  acceptLanguage?: string;
}

export interface Router<T extends DefinitionMap> {
  manifest(): ProcedureManifest;
  handle(procedureName: string, body: unknown, rawCtx?: RawContextMap): Promise<HandleResult>;
  handleBatch(calls: BatchCall[], rawCtx?: RawContextMap): Promise<{ results: BatchResultItem[] }>;
  handleSubscription(name: string, input: unknown, rawCtx?: RawContextMap): AsyncIterable<unknown>;
  handleStream(name: string, input: unknown, rawCtx?: RawContextMap): AsyncGenerator<unknown>;
  handleUpload(
    name: string,
    body: unknown,
    file: SeamFileHandle,
    rawCtx?: RawContextMap,
  ): Promise<HandleResult>;
  getKind(name: string): ProcedureKind | null;
  handlePage(path: string, headers?: PageRequestHeaders): Promise<HandlePageResult | null>;
  contextExtractKeys(): string[];
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
    contextKeys: [],
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

/** Collect channel metadata from channel results for manifest */
function collectChannelMeta(
  channels: ChannelResult[] | undefined,
): Record<string, ChannelMeta> | undefined {
  if (!channels || channels.length === 0) return undefined;
  return Object.fromEntries(
    channels.map((ch) => {
      const firstKey = Object.keys(ch.procedures)[0] ?? "";
      const name = firstKey.includes(".") ? firstKey.slice(0, firstKey.indexOf(".")) : firstKey;
      return [name, ch.channelMeta];
    }),
  );
}

/** Resolve context for a procedure, returning undefined if no context needed */
function resolveCtxFor(
  map: Map<string, { contextKeys: string[] }>,
  name: string,
  rawCtx: RawContextMap | undefined,
  extractKeys: string[],
  ctxConfig: ContextConfig,
): Record<string, unknown> | undefined {
  if (!rawCtx || extractKeys.length === 0) return undefined;
  const proc = map.get(name);
  if (!proc || proc.contextKeys.length === 0) return undefined;
  return resolveContext(ctxConfig, rawCtx, proc.contextKeys);
}

/** Resolve locale and match page route */
async function matchAndHandlePage(
  pageMatcher: RouteMatcher<PageDef>,
  procedureMap: Map<string, InternalProcedure>,
  i18nConfig: I18nConfig | null,
  strategies: ResolveStrategy[],
  hasUrlPrefix: boolean,
  path: string,
  headers?: PageRequestHeaders,
): Promise<HandlePageResult | null> {
  let pathLocale: string | null = null;
  let routePath = path;

  if (hasUrlPrefix && i18nConfig) {
    const segments = path.split("/").filter(Boolean);
    const localeSet = new Set(i18nConfig.locales);
    const first = segments[0];
    if (first && localeSet.has(first)) {
      pathLocale = first;
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

  let searchParams: URLSearchParams | undefined;
  if (headers?.url) {
    try {
      const url = new URL(headers.url, "http://localhost");
      if (url.search) searchParams = url.searchParams;
    } catch {
      // Malformed URL — ignore
    }
  }

  const i18nOpts =
    locale && i18nConfig ? { locale, config: i18nConfig, routePattern: match.pattern } : undefined;
  return handlePageRequest(match.value, match.params, procedureMap, i18nOpts, searchParams);
}

/** Catch context resolution errors and return them as HandleResult */
function resolveCtxSafe(
  map: Map<string, { contextKeys: string[] }>,
  name: string,
  rawCtx: RawContextMap | undefined,
  extractKeys: string[],
  ctxConfig: ContextConfig,
): { ctx?: Record<string, unknown>; error?: HandleResult } {
  try {
    return { ctx: resolveCtxFor(map, name, rawCtx, extractKeys, ctxConfig) };
  } catch (err) {
    if (err instanceof SeamError) {
      return { error: { status: err.status, body: err.toJSON() } };
    }
    throw err;
  }
}

export function createRouter<T extends DefinitionMap>(
  procedures: T,
  opts?: RouterOptions,
): Router<T> {
  const ctxConfig = opts?.context ?? {};
  const { procedureMap, subscriptionMap, streamMap, uploadMap, kindMap } = categorizeProcedures(
    procedures,
    Object.keys(ctxConfig).length > 0 ? ctxConfig : undefined,
  );

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

  const channelsMeta = collectChannelMeta(opts?.channels);
  const extractKeys = contextExtractKeys(ctxConfig);

  return {
    procedures,
    hasPages: !!pages && Object.keys(pages).length > 0,
    contextExtractKeys() {
      return extractKeys;
    },
    manifest() {
      return buildManifest(procedures, channelsMeta, ctxConfig, opts?.transportDefaults);
    },
    async handle(procedureName, body, rawCtx) {
      const { ctx, error } = resolveCtxSafe(
        procedureMap,
        procedureName,
        rawCtx,
        extractKeys,
        ctxConfig,
      );
      if (error) return error;
      return handleRequest(procedureMap, procedureName, body, shouldValidateOutput, ctx);
    },
    handleBatch(calls, rawCtx) {
      const ctxResolver = rawCtx
        ? (name: string) => resolveCtxFor(procedureMap, name, rawCtx, extractKeys, ctxConfig) ?? {}
        : undefined;
      return handleBatchRequest(procedureMap, calls, shouldValidateOutput, ctxResolver);
    },
    handleSubscription(name, input, rawCtx) {
      const ctx = resolveCtxFor(subscriptionMap, name, rawCtx, extractKeys, ctxConfig);
      return handleSubscription(subscriptionMap, name, input, shouldValidateOutput, ctx);
    },
    handleStream(name, input, rawCtx) {
      const ctx = resolveCtxFor(streamMap, name, rawCtx, extractKeys, ctxConfig);
      return handleStream(streamMap, name, input, shouldValidateOutput, ctx);
    },
    async handleUpload(name, body, file, rawCtx) {
      const { ctx, error } = resolveCtxSafe(uploadMap, name, rawCtx, extractKeys, ctxConfig);
      if (error) return error;
      return handleUploadRequest(uploadMap, name, body, file, shouldValidateOutput, ctx);
    },
    getKind(name) {
      return kindMap.get(name) ?? null;
    },
    handlePage(path, headers) {
      return matchAndHandlePage(
        pageMatcher,
        procedureMap,
        i18nConfig,
        strategies,
        hasUrlPrefix,
        path,
        headers,
      );
    },
  };
}
