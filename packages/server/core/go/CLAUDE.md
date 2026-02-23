# Go Server Core (`packages/server/core/go`)

Seam protocol server implementation in Go. Provides `Router` for defining RPC procedures, SSE subscriptions, and server-rendered pages, plus a `ListenAndServe` helper with graceful shutdown.

## Architecture

- `seam.go` — public API: `Router`, `HandlerOptions`, type definitions, error constructors
- `handler.go` — internal HTTP handler: mux wiring, RPC/SSE/page handlers, timeout enforcement
- `schema.go` — JTD schema reflection (`SchemaOf[T]()`)
- `serve.go` — `ListenAndServe` with SIGINT/SIGTERM graceful shutdown

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
