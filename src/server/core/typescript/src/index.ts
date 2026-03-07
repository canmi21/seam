/* src/server/core/typescript/src/index.ts */

export { t } from './types/index.js'
export { createRouter } from './router/index.js'
export { createChannel } from './channel.js'
export { SeamError } from './errors.js'
export { definePage } from './page/index.js'
export {
	createHttpHandler,
	sseDataEvent,
	sseDataEventWithId,
	sseErrorEvent,
	sseCompleteEvent,
	serialize,
	drainStream,
	toWebResponse,
} from './http.js'
export {
	loadBuild,
	loadBuildDev,
	loadBuildOutput,
	loadBuildOutputDev,
	loadRpcHashMap,
	loadI18nMessages,
} from './page/build-loader.js'
export { fromCallback } from './subscription.js'
export { startChannelWs } from './ws.js'
export { createDevProxy, createStaticHandler } from './proxy.js'
export { watchReloadTrigger } from './dev/index.js'
export {
	fromUrlPrefix,
	fromCookie,
	fromAcceptLanguage,
	fromUrlQuery,
	resolveChain,
	defaultStrategies,
} from './resolve.js'

export type {
	HttpHandler,
	HttpHandlerOptions,
	HttpRequest,
	HttpResponse,
	HttpBodyResponse,
	HttpStreamResponse,
	RpcHashMap,
} from './http.js'
export type { SchemaNode, OptionalSchemaNode, Infer } from './types/schema.js'
export type {
	ProcedureDef,
	QueryDef,
	CommandDef,
	SubscriptionDef,
	StreamDef,
	UploadDef,
	DefinitionMap,
	ProcedureKind,
	Router,
	RouterOptions,
	PageRequestHeaders,
	InvalidateTarget,
	MappingValue,
	TransportPreference,
	TransportConfig,
} from './router/index.js'
export type { SeamFileHandle } from './procedure.js'
export type { ResolveStrategy, ResolveData } from './resolve.js'
export type {
	ProcedureManifest,
	ProcedureEntry,
	ProcedureType,
	NormalizedInvalidateTarget,
	NormalizedMappingValue,
	ContextManifestEntry,
} from './manifest/index.js'
export type { ContextFieldDef, ContextConfig, RawContextMap } from './context.js'
export type { HandleResult, BatchCall, BatchResultItem } from './router/handler.js'
export type { HandlePageResult, PageTiming, I18nOpts } from './page/handler.js'
export type { BuildOutput } from './page/build-loader.js'
export type { PageDef, LayoutDef, LoaderFn, I18nConfig } from './page/index.js'
export type { ErrorCode } from './errors.js'
export type { CallbackSink } from './subscription.js'
export type { ChannelDef, ChannelResult, ChannelMeta, IncomingDef } from './channel.js'
export type { WsSink, ChannelWsSession, ChannelWsOptions } from './ws.js'
export type { DevProxyOptions, StaticHandlerOptions } from './proxy.js'
export type { ReloadWatcher } from './dev/index.js'
