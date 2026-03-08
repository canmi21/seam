# @canmi/seam-server

Framework-agnostic server core: defines procedures (query, command, subscription, stream, upload), pages, context, and the HTTP protocol layer that adapters consume.

See root CLAUDE.md for general project rules.

## Architecture

```
src/
  index.ts          -- Public API barrel (all exports go through here)
  http.ts           -- createHttpHandler, SSE helpers, serialize, toWebResponse, withSseLifecycle, SseOptions
  proxy.ts          -- createDevProxy (forward to Vite), createStaticHandler
  procedure.ts      -- Internal types: InternalProcedure, InternalSubscription, InternalStream, InternalUpload, SeamFileHandle, HandleResult
  subscription.ts   -- fromCallback: bridge callback event sources to AsyncGenerator
  context.ts        -- ContextConfig, RawContextMap, resolveContext, buildRawContext, contextHasExtracts, parseCookieHeader, extract namespace
  errors.ts         -- SeamError class with open error codes + status, DEFAULT_STATUS map
  factory.ts        -- Procedure factory functions (query, command, subscription, stream, upload)
  seam-router.ts    -- createSeamRouter: router-bound typed procedure factories
  mime.ts           -- MIME_TYPES lookup table
  ws.ts             -- WebSocket handler helpers
  channel.ts        -- Channel types and metadata
  types/
    schema.ts       -- SchemaNode<T> wrapper around JTD Schema (phantom type)
    primitives.ts   -- t.string(), t.int32(), t.float64(), etc.
    composites.ts   -- t.object(), t.array(), t.optional(), t.enum(), t.discriminator()
    index.ts        -- Assembles `t` namespace from primitives + composites
  resolve.ts        -- ResolveStrategy interface, built-in strategies (fromUrlPrefix, fromCookie, fromAcceptLanguage, fromUrlQuery), resolveChain, defaultStrategies
  router/
    index.ts        -- createRouter: wires all 5 procedure kinds, pages, channels; accepts resolveStrategies, context, transportDefaults options; exports ProcedureDef, CommandDef, SubscriptionDef, StreamDef, UploadDef, Router
    categorize.ts   -- categorizeProcedures: splits DefinitionMap into procedureMap, subscriptionMap, streamMap, uploadMap, kindMap based on `kind` field
    handler.ts      -- handleRequest (RPC), handleSubscription (SSE), handleStream (SSE with id), handleBatchRequest, handleUploadRequest; per-loader error boundaries (try-catch per loader, error marker instead of 500), input validation (shouldValidateInput)
    helpers.ts      -- buildStrategies, registerI18nQuery, resolveCtxFor/resolveCtxSafe, matchAndHandlePage, collectChannelMeta, resolveValidationMode, lookupI18nMessages
    state.ts        -- initRouterState (builds procedure/subscription/stream/upload maps + ctxConfig), buildRouterMethods (assembles router method handlers), buildRpcMethods
  page/
    index.ts        -- PageDef, PageAssets, LoaderFn, definePage()
    handler.ts      -- handlePageRequest: runs loaders, passes page_assets to engine, injects data into template
    route-matcher.ts -- RouteMatcher: pattern matching with `:param`, `*name` (catch-all), `*name?` (optional catch-all)
    build-loader.ts -- loadBuild, loadBuildOutput, loadBuildDev, loadRpcHashMap, loadI18nMessages; BuildOutput type; ParamConfig (from: "route" | "query", string shorthand accepted), handoff: "client" support
    loader-error.ts -- LoaderError interface + isLoaderError type guard
  manifest/
    index.ts        -- buildManifest: generates v2 procedure manifest with context, invalidates, chunkOutput, transport
  dev/
    index.ts        -- Dev server utilities
    reload-watcher.ts -- File watcher for dev reload
  validation/
    index.ts        -- validateInput: JTD validation via `jtd` library
```

## Data Flow

- **RPC**: `POST /_seam/procedure/{name}` -> `createHttpHandler` -> `router.handle` -> `resolveCtxSafe` -> `handleRequest` -> validate input -> call handler -> JSON response
- **SSE**: `GET /_seam/procedure/{name}?input=` -> `createHttpHandler` -> `router.handleSubscription` -> `handleSubscription` -> yield SSE events
- **Stream**: `POST /_seam/procedure/{name}` -> `createHttpHandler` -> `router.handleStream` -> `handleStream` -> yield SSE events with incrementing `id`
- **Upload**: `POST /_seam/procedure/{name}` (multipart) -> `createHttpHandler` -> `router.handleUpload` -> `resolveCtxSafe` -> `handleUploadRequest` -> call handler with SeamFileHandle -> JSON response
- **Page**: `GET /_seam/page/{path}` -> `createHttpHandler` -> `router.handlePage` -> `RouteMatcher` -> `handlePageRequest` -> run loaders (with query params, handoff) -> inject into template; each loader wrapped in independent try-catch; failed loaders return `LoaderError` marker, page still returns 200
- **Build Loading**: `loadBuild(distDir)` -> reads `route-manifest.json` + `rpc-hash-map.json` + i18n -> `BuildOutput { pages, rpcHashMap, i18n }`
- **Manifest**: `GET /_seam/manifest.json` -> `router.manifest()` -> `buildManifest` (v2: context, transportDefaults, invalidates, chunkOutput)
- **Context**: rawCtx (from adapter) -> `resolveCtxSafe` -> `resolveContext` -> extract only keys referenced by the procedure

## Key Patterns

- Type system uses phantom types: `SchemaNode<T>` carries JTD schema at runtime, TypeScript type `T` at compile time
- `createRouter` uses `categorizeProcedures` to split `DefinitionMap` into 4 maps (procedure, subscription, stream, upload) + `kindMap` based on the `kind` field
- `resolveCtxSafe` wraps context resolution with SeamError catch -> HandleResult, preventing context errors from crashing the server
- `HttpResponse` is a union: `HttpBodyResponse | HttpStreamResponse` -- adapters check for `"stream" in result`
- `toWebResponse` converts `HttpResponse` to Web API `Response` (used by Hono/Bun adapters); Node adapter uses its own `sendResponse` instead
- `fromCallback` bridges callback-style event emitters to `AsyncGenerator` for subscription handlers
- Stream vs subscription SSE: subscriptions emit bare `data:` events; streams emit `id:` + `data:` events with incrementing IDs
- SSE lifecycle: `withSseLifecycle` wraps subscription/stream SSE with heartbeat and idle timeout; `SseOptions` interface (`heartbeatInterval` default 21s, `sseIdleTimeout` default 30s, 0 disables)
- rpcHashMap propagation: router stores as public property; `createHttpHandler` falls back `opts.rpcHashMap ?? router.rpcHashMap`
- loader_metadata injection: page handler builds `__loaders` metadata from loader configs (`{procedure, input}` per data key) for client-side QueryClient hydration; `loader_metadata` includes optional `error?: true` flag for failed loaders
- Per-loader error boundary: each loader runs in its own try-catch; failed loaders produce `LoaderError` marker in data, page renders partial data at 200 instead of failing entirely at 500
- Loader input validation: gated by `shouldValidateInput` flag; when enabled, loader inputs are validated against JTD schema before execution
- Exported validation types: `ValidationMode`, `ValidationConfig`, `ValidationDetail`

## Dependencies

| Dependency           | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `jtd`                | JSON Type Definition validation                       |
| `@canmi/seam-engine` | Page assembly, template injection, i18n (WASM engine) |

## Commands

- Build: `just build-ts`
- Test: `just test-ts`

## Gotchas

- Page handler skips JTD validation on loader input (trusted server-side code)
- `serialize` handles both string passthrough and JSON.stringify -- used by adapters for body serialization
- Build tool is `tsdown`, not `tsc` -- single ESM entry point with .d.ts generation
