# seam-engine-wasm

wasm-bindgen layer exposing [seam-engine](../rust/) functions to JavaScript and Go runtimes. Superset of the injector — includes all engine functions plus `inject` and `inject_no_script`.

## Structure

- `src/lib.rs` — `#[wasm_bindgen]` wrappers delegating to `seam_engine` and `seam_injector`

## Exported Functions

| Function             | Source        |
| -------------------- | ------------- |
| `render_page`        | seam-engine   |
| `parse_build_output` | seam-engine   |
| `parse_i18n_config`  | seam-engine   |
| `parse_rpc_hash_map` | seam-engine   |
| `ascii_escape_json`  | seam-engine   |
| `i18n_query`         | seam-engine   |
| `inject`             | seam-injector |
| `inject_no_script`   | seam-injector |

## Development

- Build: `bash packages/server/engine/build-wasm.sh`
- The output `.wasm` binary is embedded by [engine/js](../js/) and [engine/go](../go/)

## Notes

- All functions use string-in/string-out signatures for wasm-bindgen compatibility
- Rebuild when either `seam-engine` or `seam-injector` source changes
