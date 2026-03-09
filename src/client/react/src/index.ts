/* src/client/react/src/index.ts */

export { defineRoutes } from './define-routes.js'
export { useSeamData, SeamDataProvider, parseSeamData, isLoaderError } from './use-seam-data.js'
export { buildSentinelData } from './sentinel.js'
export { useSeamSubscription } from './use-seam-subscription.js'
export { useSeamStream } from './use-seam-stream.js'
export { useSeamNavigate, SeamNavigateProvider } from './use-seam-navigate.js'
export { useSeamHandoff, SeamHandoffProvider } from './use-seam-handoff.js'
export { buildHeadSlotProxy, headConfigToSlotHtml } from './head.js'
export type {
	RouteDef,
	LoaderDef,
	ParamMapping,
	LazyComponentLoader,
	HeadConfig,
	HeadMeta,
	HeadLink,
	HeadFn,
} from './types.js'
export type { LoaderError } from './use-seam-data.js'
export type {
	UseSeamSubscriptionResult,
	SubscriptionStatus,
	UseSeamSubscriptionOptions,
} from './use-seam-subscription.js'
export type { UseSeamStreamResult, StreamStatus } from './use-seam-stream.js'
