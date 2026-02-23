/* packages/server/core/typescript/src/index.ts */

export { t } from "./types/index.js";
export { createRouter } from "./router/index.js";
export { SeamError } from "./errors.js";
export { definePage } from "./page/index.js";
export {
  createHttpHandler,
  sseDataEvent,
  sseErrorEvent,
  sseCompleteEvent,
  serialize,
  drainStream,
  toWebResponse,
} from "./http.js";
export { loadBuildOutput } from "./page/build-loader.js";
export { fromCallback } from "./subscription.js";
export { createDevProxy, createStaticHandler } from "./proxy.js";

export type {
  HttpHandler,
  HttpHandlerOptions,
  HttpRequest,
  HttpResponse,
  HttpBodyResponse,
  HttpStreamResponse,
} from "./http.js";
export type { SchemaNode, OptionalSchemaNode, Infer } from "./types/schema.js";
export type {
  ProcedureDef,
  SubscriptionDef,
  DefinitionMap,
  Router,
  RouterOptions,
} from "./router/index.js";
export type { ProcedureManifest, ProcedureEntry, ProcedureType } from "./manifest/index.js";
export type { HandleResult, BatchCall, BatchResultItem } from "./router/handler.js";
export type { HandlePageResult, PageTiming } from "./page/handler.js";
export type { PageDef, LayoutDef, LoaderFn } from "./page/index.js";
export type { ErrorCode } from "./errors.js";
export type { CallbackSink } from "./subscription.js";
export type { DevProxyOptions, StaticHandlerOptions } from "./proxy.js";
