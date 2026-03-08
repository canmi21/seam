# @canmi/seam-client

Framework-agnostic client for calling seam procedures, subscribing to server events, and managing real-time connections.

## Key Exports

| Export                   | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `createClient`           | Create a `SeamClient` instance with `call()`, `subscribe()`, `fetchManifest()` |
| `SeamClientError`        | Typed error class with error codes                                             |
| `ReconnectController`    | Automatic reconnection with exponential backoff                                |
| `defaultReconnectConfig` | Default reconnect configuration                                                |
| `parseSseStream`         | Fetch-based SSE stream parser                                                  |
| `seamRpc`                | Low-level RPC call helper                                                      |
| `configureRpcMap`        | Configure RPC hash map for obfuscated endpoints                                |
| `createChannelHandle`    | Create an SSE-based channel handle                                             |
| `createWsChannelHandle`  | Create a WebSocket-based channel handle                                        |
| `prefetchRoute`          | Prefetch route data for faster navigation                                      |
| `clearPrefetchCache`     | Clear prefetched route cache                                                   |

### Types

| Type              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `ConnectionState` | Reconnection state (`connected`, `reconnecting`, `disconnected`) |
| `ReconnectConfig` | Reconnect configuration (maxRetries, baseDelay, etc.)            |
| `SseCallbacks`    | Callback interface for SSE stream events                         |
| `ChannelHandle`   | Handle for managing channel connections                          |
| `ErrorCode`       | String union of standard error codes                             |
| `ProcedureKind`   | `'query' \| 'command' \| 'subscription' \| 'stream' \| 'upload'` |

## Structure

- `src/index.ts` — Public API exports
- `src/client.ts` — `SeamClient` implementation (RPC calls, SSE subscriptions)
- `src/errors.ts` — `SeamClientError` typed error class
- `src/reconnect.ts` — `ReconnectController` with exponential backoff
- `src/sse-parser.ts` — Fetch-based SSE stream parser with `Last-Event-ID` support
- `src/rpc.ts` — `seamRpc` / `configureRpcMap` low-level RPC helpers
- `src/channel-handle.ts` — SSE-based channel handle
- `src/ws-channel-handle.ts` — WebSocket-based channel handle
- `src/prefetch.ts` — Route prefetching
- `src/prefetch-cache.ts` — Prefetch cache management
- `src/batch.ts` — Batch RPC call support

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Used directly for vanilla JS or as a dependency of `@canmi/seam-react`
- `subscribe()` uses fetch-based SSE with `Last-Event-ID` reconnection support
- `ReconnectController` handles automatic reconnection with configurable exponential backoff
