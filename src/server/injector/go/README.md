# seam-injector-go

> **Deprecated.** Use `src/server/engine/go` instead, which is a superset
> that includes injector functions plus page assembly, i18n, and build parsing.

Go wrapper around the Rust injector WASM binary using wazero. Provides HTML template injection for the Go server core.

## Structure

- `injector.go` — Embeds WASM binary, initializes wazero runtime, exposes `Inject` / `InjectNoScript`
- `injector.wasm` — Embedded Rust injector binary

## Development

- Test: `go test -v ./...`

## Notes

- Uses wazero's interpreter engine (not compiler) due to externref table limitations
- Runtime is initialized once via `sync.Once`; each call gets a fresh WASM module instance for isolation
- The `.wasm` binary must be manually rebuilt when the Rust injector source changes
