# Go Engine (`packages/server/engine/go`)

Wazero-based WASM runner for the Rust engine binary. Superset of `injector/go` — includes injector functions plus page assembly, i18n, and build parsing.

See root CLAUDE.md for general project rules.

## Architecture

- `engine.go` — Embed WASM binary, wazero runtime init, generalized `callWasm` for N string args, public API
- `engine.wasm` — Embedded Rust engine binary (compiled from `packages/server/engine/wasm`)

## Public API

| Function           | Description                                      |
| ------------------ | ------------------------------------------------ |
| `RenderPage`       | Page assembly: inject slots + data script + meta |
| `ParseBuildOutput` | Parse route-manifest.json into page definitions  |
| `ParseI18nConfig`  | Extract i18n configuration from manifest         |
| `ParseRpcHashMap`  | Build reverse lookup from RPC hash map           |
| `AsciiEscapeJSON`  | Escape non-ASCII in JSON strings                 |
| `I18nQuery`        | Look up i18n translation keys                    |
| `Inject`           | Template injection with `__SEAM_DATA__` script   |
| `InjectNoScript`   | Template injection without data script           |

## Key Details

- `sync.Once` ensures runtime initialization happens exactly once
- Uses **interpreter engine** (not compiler) — wazero compiler panics on externref tables
- Fresh module instance per call (`WithName("")`) for isolation
- `callWasm(funcName, args...)` is generalized to handle N string arguments (unlike injector which had fixed 2-arg helpers)
- Memory management: `__wbindgen_malloc` to allocate, `__wbindgen_free` to release

## Testing

```sh
go test -v ./...
```

## Gotchas

- The `.wasm` binary must be rebuilt when the Rust engine source changes
- Module name must be empty string to allow multiple instances without name collision
