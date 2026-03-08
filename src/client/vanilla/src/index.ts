/* src/client/vanilla/src/index.ts */

export { createClient } from './client.js'
export { SeamClientError } from './errors.js'
export { parseSseStream } from './sse-parser.js'
export { seamRpc, configureRpcMap } from './rpc.js'
export { createChannelHandle } from './channel-handle.js'
export { createWsChannelHandle } from './ws-channel-handle.js'
export { prefetchRoute } from './prefetch.js'
export { clearPrefetchCache } from './prefetch-cache.js'
export { ReconnectController, defaultReconnectConfig } from './reconnect.js'

export type {
	ClientOptions,
	SeamClient,
	StreamHandle,
	Unsubscribe,
	ChannelTransport,
	ChannelOptions,
	TransportHint,
	TransportOptions,
} from './client.js'
export type { ErrorCode } from './errors.js'
export type { ChannelHandle } from './channel-handle.js'
export type { ConnectionState, ReconnectConfig } from './reconnect.js'
export type { SseCallbacks } from './sse-parser.js'

export type ProcedureKind = 'query' | 'command' | 'subscription' | 'stream' | 'upload'
