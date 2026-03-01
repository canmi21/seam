# seam-engine (Rust)

Pure Rust engine for page assembly, i18n, build output parsing, and JSON escaping. Extracted from duplicated logic across TS/Rust/Go server backends. All functions take JSON strings in and return JSON strings out for cross-language compatibility.

See root CLAUDE.md for general project rules.

## Architecture

| Module      | Responsibility                                                               |
| ----------- | ---------------------------------------------------------------------------- |
| `escape.rs` | `ascii_escape_json` — escape non-ASCII in JSON string values                 |
| `page.rs`   | Page data assembly: `flatten_for_slots`, `build_seam_data`, `inject_*`, i18n |
| `render.rs` | `render_page` — top-level page pipeline (inject + data script + meta + lang) |
| `build.rs`  | `parse_build_output`, `parse_i18n_config`, `parse_rpc_hash_map`              |
| `lib.rs`    | Public API barrel re-exporting all modules                                   |

## Key Types

- `PageConfig { layout_chain, data_id, head_meta }` — page assembly configuration
- `LayoutChainEntry { id, loader_keys }` — per-layout data grouping (fixes the `_layouts` bug)
- `I18nOpts { locale, default_locale, messages }` — i18n injection (server pre-merges default locale)
- `PageDefOutput` — build output parsing result

## render_page Pipeline

`flatten_for_slots` -> `inject_no_script` (from seam-injector) -> `inject_head_meta` -> `inject_html_lang` -> `build_seam_data` -> `ascii_escape_json` -> `inject_data_script`

## Dependencies

| Dependency      | Purpose                        |
| --------------- | ------------------------------ |
| `seam-injector` | Template injection (slot fill) |
| `serde`         | JSON serialization             |
| `serde_json`    | JSON parsing                   |

## Testing

```sh
cargo test -p seam-engine
```

32 tests covering escape, page assembly, i18n query, render pipeline, and build parsing.

## Conventions

- JSON string in / JSON string out API for WASM compatibility
- `serde_json::Value` used internally; callers pass stringified JSON
- No filesystem I/O — all functions are pure
