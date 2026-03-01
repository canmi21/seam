# seam-engine

Pure Rust engine for page assembly, i18n resolution, build output parsing, and JSON escaping. Single source of truth for logic shared across TS, Go, and WASM runtimes. See [architecture overview](../../../../docs/architecture/logic-layer.md).

## Structure

- `src/render.rs` — `render_page` top-level pipeline (inject + data script + meta + lang)
- `src/page.rs` — Page data assembly: `flatten_for_slots`, `build_seam_data`, i18n helpers
- `src/build.rs` — `parse_build_output`, `parse_i18n_config`, `parse_rpc_hash_map`
- `src/escape.rs` — `ascii_escape_json` for non-ASCII character escaping

## Key Exports

| Function             | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `render_page`        | Full page pipeline: slots + data + meta + lang  |
| `parse_build_output` | Parse route-manifest.json into page definitions |
| `parse_i18n_config`  | Extract i18n configuration from manifest        |
| `parse_rpc_hash_map` | Build reverse lookup from RPC hash map          |
| `ascii_escape_json`  | Escape non-ASCII in JSON string values          |
| `i18n_query`         | Look up translation keys from locale messages   |

## Development

- Build: `cargo build -p seam-engine`
- Test: `cargo test -p seam-engine`

## Notes

- All functions take JSON strings in and return JSON strings out for WASM compatibility
- Depends on [seam-injector](../../injector/rust/) for template slot injection
- Consumed by [engine/wasm](../wasm/), which exposes these functions to JS and Go runtimes
