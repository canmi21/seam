# packages/cli/core

SeamJS CLI -- builds HTML skeleton templates from React components, generates typed TypeScript clients from procedure manifests, and orchestrates dev servers.

See root CLAUDE.md for general conventions.

## Architecture

| Module                  | Responsibility                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- |
| `main.rs`               | CLI entry point (clap); dispatches `pull`, `generate`, `build`, `dev` subcommands |
| `config.rs`             | Parses `seam.toml`; walks upward to find config (like Cargo.toml discovery)       |
| `manifest.rs`           | `Manifest` / `ProcedureSchema` types (serde, shared across commands)              |
| `pull.rs`               | Fetches `/_seam/manifest.json` from a running server via reqwest                  |
| `codegen/typescript.rs` | JTD schema -> TypeScript interfaces + `createSeamClient` factory                  |
| `build/config.rs`       | `BuildConfig` + `BundlerMode` enum derived from `SeamConfig`; detects fullstack vs frontend-only |
| `build/run.rs`          | Build orchestrator: dispatches frontend-only (4 steps) or fullstack (7 steps) builds |
| `build/route.rs`        | Pipeline steps: skeleton rendering, route processing, manifest extraction, codegen, asset packaging |
| `build/types.rs`        | Shared build types (`AssetFiles`, `SeamManifest`) and manifest reader             |
| `build/skeleton/`       | HTML template extraction pipeline (slot, extract, document)                       |
| `shell.rs`              | Shell command helpers shared across build and dev (`run_command`, `run_builtin_bundler`) |
| `dev.rs`                | Spawns backend + frontend dev processes, pipes labeled output, handles Ctrl+C     |
| `dev_server.rs`         | Embedded axum dev server (static files + API proxy + SPA fallback)                |
| `ui.rs`                 | Terminal output helpers (ANSI colors, step counters, file size formatting)        |

## Skeleton Pipeline

Three-stage pipeline in `build/skeleton/`:

1. **slot** (`slot.rs`) -- replaces `%%SEAM:path%%` sentinels with `<!--seam:path-->` HTML comments; handles both text and attribute sentinels
2. **extract** (`extract/`) -- diffs variant HTML across axes (boolean, nullable, enum, array) to produce conditional/loop template directives; handles nested axes (e.g. `posts.$.hasAuthor` inside `posts` array)
3. **document** (`document.rs`) -- wraps skeleton fragment in minimal HTML5 document with CSS/JS asset references under `/_seam/static/`

The extract module is the most complex part, split into sub-modules:

- `tree_diff.rs` -- DOM tree diffing to find changed/added/removed nodes between variants
- `variant.rs` -- selects which variants correspond to each axis value
- `container.rs` -- unwraps container elements (e.g. `<ul>`) from array loop bodies
- `combo.rs` -- classifies axes into top-level vs nested groups
- `boolean.rs` -- if/else directive generation for boolean and nullable axes
- `enum_axis.rs` -- match/when directive generation for enum axes
- `array.rs` -- each/endeach directive generation for array axes (with nested child support)
- `dom.rs` -- lightweight HTML parser/serializer for DOM tree representation

## Key Files

- `src/main.rs` -- CLI definition and command dispatch (~138 lines)
- `src/build/run.rs` -- build orchestrator (~224 lines)
- `src/build/route.rs` -- pipeline step implementations (~291 lines)
- `src/codegen/typescript.rs` -- JTD-to-TypeScript codegen (~448 lines with tests)
- `src/build/skeleton/extract/mod.rs` -- template extraction engine (~137 lines, tests in `tests.rs`)

## Conventions

- Crate name is `seam-cli`, binary name is `seam` (do NOT use `cargo build -p seam`)
- Build modes: `is_fullstack` is true when `backend_build_command` is set in `seam.toml`
- Fullstack build extracts manifest at build time by importing the router file via bun/node
- Template output goes to `{out_dir}/templates/`, route manifest to `{out_dir}/route-manifest.json`
- Static assets copied to `{out_dir}/public/` in fullstack mode

## Testing

```sh
cargo test -p seam-cli
```

- Unit tests colocated in each module (`#[cfg(test)] mod tests`)
- Integration tests in `build/skeleton/mod.rs` span the full slot -> extract -> document pipeline
- `extract/tests.rs` contains legacy v1 helper tests and regression tests for known bugs (container unwrap, class attribute splitting, stale content after endmatch)

## Gotchas

- `cargo build -p seam` does NOT work; the Cargo.toml package name is `seam-cli`
- Skeleton rendering shells out to `node_modules/@canmi/seam-react/scripts/build-skeletons.mjs`; this must be installed
- Manifest extraction prefers `bun` over `node` (checks via `which`)
- The extract engine uses DOM tree diffing (`tree_diff.rs`) to locate changed nodes, then wraps them in directive comments
