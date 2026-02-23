# Go Server Core (`packages/server/core/go`)

Seam protocol server implementation in Go. Provides `Router` for defining RPC procedures, SSE subscriptions, and server-rendered pages, plus a `ListenAndServe` helper with graceful shutdown.

See root CLAUDE.md for general project rules.

## Architecture

- `seam.go` — public API: `Router`, `HandlerOptions`, type definitions, error constructors
- `handler.go` — internal HTTP handler: mux wiring, RPC/SSE/page handlers, timeout enforcement
- `generics.go` — `Query[In, Out]` and `Subscribe[In, Out]` typed wrappers using generics
- `schema.go` — JTD schema reflection (`SchemaOf[T]()`)
- `serve.go` — `ListenAndServe` with SIGINT/SIGTERM graceful shutdown

## Error Handling

`seam.Error` struct carries `Code`, `Message`, and `Status`. Constructor functions:

| Constructor          | Code               | HTTP Status |
| -------------------- | ------------------ | ----------- |
| `ValidationError()`  | VALIDATION_ERROR   | 400         |
| `UnauthorizedError()` | UNAUTHORIZED      | 401         |
| `ForbiddenError()`   | FORBIDDEN          | 403         |
| `NotFoundError()`    | NOT_FOUND          | 404         |
| `RateLimitedError()` | RATE_LIMITED       | 429         |
| `InternalError()`    | INTERNAL_ERROR     | 500         |
| `NewError()`         | custom             | custom      |

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

## Testing

```sh
go test -v ./...
```

Tests cover: RPC timeout (504), page loader timeout (504), SSE idle timeout (complete event), zero-timeout passthrough, graceful shutdown lifecycle.

## Conventions

- `appState` struct groups mutable state (manifest cache, handler/sub maps, options) — passed as receiver to all internal handlers
- `seam.go` is the sole public API surface; `handler.go` and `serve.go` are internal
- Zero-value `HandlerOptions` fields disable the corresponding timeout
- Page loaders run concurrently via `sync.WaitGroup` + result channel
- Sorted keys for deterministic JSON output (mirrors `BTreeMap` in Rust)
- `Query[In, Out]` and `Subscribe[In, Out]` provide type-safe generic wrappers over raw `HandlerFunc`

## Gotchas

- `go.mod` uses `replace` directive to reference the injector package within the monorepo
- Requires `go 1.24.0` minimum (for `http.NewServeMux` enhanced routing and generics)
- Use `PORT=0` (or `:0` addr) for test port allocation — `ListenAndServe` prints actual port
- `Handler()` uses variadic signature (`opts ...HandlerOptions`) for backward compat, only first element is used
- Route params use `:param` syntax in `PageDef.Route`, converted to Go `{param}` style internally
