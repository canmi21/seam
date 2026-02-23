# Go Injector (`packages/server/injector/go`)

Wazero-based WASM runner for the Rust injector binary. Provides `Inject` and `InjectNoScript` functions that call into the compiled WASM module.

See root CLAUDE.md for general project rules.

## Architecture

- `injector.go` — embed WASM binary, wazero runtime init, `Inject` / `InjectNoScript` public API
- `seam_injector_wasm.wasm` — embedded Rust injector binary (compiled from `packages/server/injector/rust`)

## Key Details

- `sync.Once` ensures runtime initialization happens exactly once across all calls
- Uses **interpreter engine** (not compiler) — wazero's compiler (wazevo) panics on externref tables exported by wasm-bindgen
- Fresh module instance per call (`wazero.NewModuleConfig().WithName("")`) for isolation
- `__wbindgen_init_externref_table` import provided as a no-op host function — the injector only uses string args/returns, no externrefs
- Memory management: manually allocates WASM memory via `__wbindgen_malloc`, frees result via `__wbindgen_free`

## Testing

```sh
go test -v ./...
```

## Gotchas

- The `.wasm` binary must be rebuilt when the Rust injector source changes — it is not auto-rebuilt
- Wazero compiler engine panics on externref; interpreter engine is slower but necessary
- Module name must be empty string (`""`) to allow multiple instances without name collision
- `__wbindgen_start` is called after instantiation to run wasm-bindgen initialization
