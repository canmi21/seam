# seam-engine-go

Wazero-based WASM bridge for the Rust engine. All functions delegate to the embedded [engine/wasm](../wasm/) binary compiled from [engine/rust](../rust/).

## Structure

- `engine.go` — WASM runtime init, `callWasm` dispatcher, public API
- `engine.wasm` — Embedded binary (built by `build-wasm.sh`)

## Key Exports

| Function           | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `RenderPage`       | Page assembly: slots + data script + meta       |
| `ParseBuildOutput` | Parse route-manifest.json into page definitions |
| `ParseI18nConfig`  | Extract i18n configuration from manifest        |
| `ParseRpcHashMap`  | Reverse lookup from RPC hash map                |
| `AsciiEscapeJSON`  | Escape non-ASCII in JSON strings                |
| `I18nQuery`        | Look up i18n translation keys                   |
| `Inject`           | Template injection with data script             |
| `InjectNoScript`   | Template injection without data script          |

## Development

- Test: `go test -v ./...`

## Notes

- Uses wazero **interpreter** engine (compiler panics on externref tables)
- Fresh module instance per call for isolation (`WithName("")`)
- `sync.Once` ensures WASM runtime initializes exactly once
- Rebuild `engine.wasm` when Rust engine source changes
