# seam-go

Go implementation of the SeamJS server core, defining procedures, subscriptions, pages, and an HTTP handler. Uses the Go engine package for template rendering (page assembly, per-page assets, i18n).

## Structure

**Public API:**

- `seam.go` — `Router`, `HandlerOptions`, `PageAssets`, `ContextConfig`, procedure/stream/upload/channel definitions, error constructors

**Core handler + sub-handlers:**

- `handler.go` — `buildHandler`, procedure registration, RPC dispatch, page data endpoint
- `handler_batch.go` — batch RPC (parallel goroutines), SSE subscribe handler
- `handler_stream.go` — stream handler (SSE with incrementing `id`, idle timeout)
- `handler_upload.go` — multipart/form-data parsing, `SeamFileHandle`
- `handler_page.go` — page rendering, loader orchestration (delegates to `engine.RenderPage`)
- `handler_ws.go` — WebSocket channel handler (bidirectional messaging via gorilla/websocket)

**Manifest & build:**

- `manifest.go` — manifest v2 types, `buildManifest`, `handleManifest`
- `build_loader.go` — `LoadBuild`, `LoadBuildOutput`, `LoadRpcHashMap`, `LoadI18nConfig`

**Context & resolution:**

- `context.go` — `ContextValue[T]` generic helper, context extraction and injection
- `resolve.go` — `ResolveStrategy` interface, built-in strategies (URL prefix, cookie, Accept-Language, query)

**Validation:**

- `validation.go` — JTD input validation types and entry points
- `validation_compile.go` — schema compilation
- `validation_check.go` — compiled schema validation logic

**Channels & projection:**

- `channel.go` — `ChannelDef`, `IncomingDef` for bidirectional channels
- `projection.go` — loader data projection (prune to requested fields)

**Utilities:**

- `generics.go` — `Query`, `Command`, `Subscribe`, `StreamProc`, `UploadProc` typed generic wrappers
- `schema.go` — JTD schema reflection (`SchemaOf[T]()`)
- `serve.go` — `ListenAndServe` with SIGINT/SIGTERM graceful shutdown

## Development

- Test: `go test -v ./...`

## Notes

- Uses `go.mod` `replace` directive to reference the engine package within the monorepo
- Supports all procedure kinds: query, command, subscription, stream, upload, and channels
- Page loaders run concurrently via `sync.WaitGroup`; results are sorted for deterministic JSON output
- `Handler()` accepts variadic `HandlerOptions`; zero-value fields disable the corresponding timeout
- Generic helpers handle JSON deserialization and schema generation automatically
- Context injection uses Go's `context.WithValue`; per-procedure context keys control which values are injected
- JTD validation with detailed error reporting (path/expected/actual)
