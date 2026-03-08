# Go Server Core (`src/server/core/go`)

Seam protocol server implementation in Go. Provides `Router` for defining RPC procedures, SSE subscriptions, streams, uploads, and server-rendered pages, plus a `ListenAndServe` helper with graceful shutdown.

See root CLAUDE.md for general project rules.

## Architecture

- `seam.go` — public API: `Router`, `HandlerOptions`, `PageAssets`, `ContextConfig`, `ProcedureOption`, `StreamDef`, `UploadDef`, `SeamFileHandle`, type definitions, error constructors
- `context.go` — context system: `ContextValue[T]` generic helper, `extractRawContext`, `resolveContextForProc`, `injectContext`
- `handler.go` — core handler: `appState`, `buildHandler`, manifest, RPC handler (uses `engine.I18nQuery` for built-in i18n), error helpers
- `handler_batch.go` — batch RPC handler, SSE subscribe handler, SSE helpers
- `handler_stream.go` — stream handler: SSE with incrementing `id` field, idle timeout, `writeStreamEvent`
- `handler_upload.go` — upload handler: multipart/form-data parsing, `SeamFileHandle`, metadata JSON extraction
- `handler_page.go` — page handler: `makePageHandler`, `servePage`, loader orchestration (delegates to `engine.RenderPage` for slot injection, per-page assets, data script, head meta, and locale)
- `resolve.go` — `ResolveStrategy` interface, `ResolveData`, built-in strategies (`FromUrlPrefix`, `FromCookie`, `FromAcceptLanguage`, `FromUrlQuery`), `ResolveChain`, `DefaultStrategies`
- `generics.go` — `Query[In, Out]`, `Command[In, Out]`, `Subscribe[In, Out]`, `StreamProc[In, Chunk]`, `UploadProc[In, Out]` typed wrappers using generics
- `build_loader.go` — `LoadBuild`, `LoadBuildOutput`, `LoadRpcHashMap`, `LoadI18nConfig`; `BuildOutput` struct; `RpcHashMap` with `ReverseLookup()`
- `schema.go` — JTD schema reflection (`SchemaOf[T]()`)
- `validation.go` — JTD input validator: `compileSchema`, `validateCompiled`, `ValidationMode`, `ValidationDetail`
- `serve.go` — `ListenAndServe` with SIGINT/SIGTERM graceful shutdown

## Error Handling

`seam.Error` struct carries `Code`, `Message`, and `Status`. Constructor functions:

| Constructor                 | Code             | HTTP Status |
| --------------------------- | ---------------- | ----------- |
| `ContextError()`            | CONTEXT_ERROR    | 400         |
| `ValidationError()`         | VALIDATION_ERROR | 400         |
| `UnauthorizedError()`       | UNAUTHORIZED     | 401         |
| `ForbiddenError()`          | FORBIDDEN        | 403         |
| `NotFoundError()`           | NOT_FOUND        | 404         |
| `RateLimitedError()`        | RATE_LIMITED     | 429         |
| `InternalError()`           | INTERNAL_ERROR   | 500         |
| `NewError()`                | custom           | custom      |
| `ValidationErrorDetailed()` | VALIDATION_ERROR | 400         |

`ValidationErrorDetailed` carries a `Details []any` slice with structured validation errors (path/expected/actual). The `Details` field is omitted from JSON when nil.

Error dispatch in handlers: check `context.DeadlineExceeded` first, then type-assert `*Error`, then wrap unknown errors with `InternalError`.

## HandlerOptions

```go
r.Handler() // defaults: 30s RPC, 30s page, 30s SSE idle
r.Handler(seam.HandlerOptions{
    RPCTimeout:     5 * time.Second,
    SSEIdleTimeout: 0, // disable idle timeout
})
```

Zero value disables the corresponding timeout. Variadic signature preserves backward compatibility.

## ListenAndServe

Wraps `http.Server` with signal handling. Prints actual port (useful for `:0` in tests). Returns `nil` on clean shutdown.

## Build Loading

`LoadBuild(dir)` loads all build artifacts in one call, returning `BuildOutput { Pages, RpcHashMap, I18nConfig }`.

`Router.Build(b BuildOutput)` is a chained builder that registers pages and configures rpcHashMap + i18n from a single `BuildOutput` value.

Individual loaders: `LoadBuildOutput(dir)`, `LoadRpcHashMap(dir)`, `LoadI18nConfig(dir)`.

`RpcHashMap.ReverseLookup()` builds a hash-to-original-name map for request dispatching.

## Testing

```sh
go test -v ./...
```

Tests cover: RPC timeout (504), page loader timeout (504), SSE idle timeout (complete event), zero-timeout passthrough, graceful shutdown lifecycle, context extraction/injection (header, missing, nil, struct), manifest v2 context fields.

## Conventions

- `appState` struct groups mutable state (manifest cache, handler/sub maps, strategies, options) — passed as receiver to all internal handlers
- `seam.go` is the sole public API surface; `handler.go`, `resolve.go`, and `serve.go` are internal
- Locale resolution uses `ResolveStrategy` chain via `Router.ResolveStrategies(...)`; defaults to `DefaultStrategies()`
- Zero-value `HandlerOptions` fields disable the corresponding timeout
- Page loaders run concurrently via `sync.WaitGroup` + result channel
- Sorted keys for deterministic JSON output (mirrors `BTreeMap` in Rust)
- `Query[In, Out]`, `Subscribe[In, Out]`, `StreamProc[In, Chunk]`, and `UploadProc[In, Out]` provide type-safe generic wrappers over raw handler funcs
- Context injection uses Go's idiomatic `context.WithValue`; handlers retrieve via generic `ContextValue` helper — handler signature unchanged
- Per-procedure context: only keys declared in `ContextKeys` are injected; batch/page extract raw context once and resolve per-procedure

## Gotchas

- `go.mod` uses `replace` directive to reference the engine package within the monorepo (injector dependency removed)
- Requires `go 1.24.0` minimum (for `http.NewServeMux` enhanced routing and generics)
- Use `PORT=0` (or `:0` addr) for test port allocation — `ListenAndServe` prints actual port
- `Handler()` uses variadic signature (`opts ...HandlerOptions`) for backward compat, only first element is used
- Route params use `:param` syntax in `PageDef.Route`, converted to Go `{param}` style internally
