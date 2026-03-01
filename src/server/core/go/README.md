# seam-go

Go implementation of the SeamJS server core, defining procedures, subscriptions, pages, and an HTTP handler. Uses the Go injector package for template rendering.

## Structure

- `seam.go` — Public API: `Router`, `HandlerOptions`, error constructors, type definitions
- `handler.go` — Internal HTTP handler: mux wiring, RPC/SSE/page handlers
- `generics.go` — `Query[In, Out]` and `Subscribe[In, Out]` typed wrappers
- `schema.go` — JTD schema reflection via `SchemaOf[T]()`
- `serve.go` — `ListenAndServe` with graceful shutdown

## Development

- Test: `go test -v ./...`

## Notes

- Uses `go.mod` `replace` directive to reference the injector package within the monorepo
- Page loaders run concurrently via `sync.WaitGroup`; results are sorted for deterministic JSON output
- `Handler()` accepts optional `HandlerOptions`; zero-value fields disable the corresponding timeout
- Generic helpers `Query` and `Subscribe` handle JSON deserialization and schema generation automatically
