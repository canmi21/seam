# src/cli/core

SeamJS CLI -- orchestrates build pipelines, dev servers, and dispatches subcommands. Skeleton extraction and codegen logic live in separate crates (`seam-skeleton`, `seam-codegen`).

See root CLAUDE.md for general conventions.

## Architecture

| Module            | Responsibility                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `main.rs`         | CLI entry point (clap); dispatches `pull`, `generate`, `build`, `dev`, `clean` subcommands          |
| `config/`         | Parses `seam.toml`; walks upward to find config (like Cargo.toml discovery)                         |
| `pull.rs`         | Fetches `/_seam/manifest.json` from a running server via reqwest                                    |
| `build/config.rs` | `BuildConfig` + `BundlerMode` enum derived from `SeamConfig`; detects fullstack vs frontend-only    |
| `build/run/`      | Build orchestrator: dispatches frontend-only (4 steps) or fullstack (7 steps) builds                |
| `build/route/`    | Pipeline steps: skeleton rendering, route processing, manifest extraction, codegen, asset packaging |
| `build/types.rs`  | Shared build types (`AssetFiles`, `SeamManifest`, re-exported `ViteDevInfo`) and manifest reader    |
| `shell.rs`        | Shell command helpers shared across build and dev (`run_command`, `run_builtin_bundler`)            |
| `dev/`            | Spawns backend + frontend dev processes, pipes labeled output, handles Ctrl+C                       |
| `dev_server.rs`   | Embedded axum dev server (static files + API proxy + SPA fallback)                                  |
| `workspace.rs`    | Workspace mode: resolves members, delegates builds to each                                          |
| `ui.rs`           | Terminal output helpers (ANSI colors, step counters, file size formatting)                          |

## Companion Crates

| Crate           | Path                | What it provides                                                     |
| --------------- | ------------------- | -------------------------------------------------------------------- |
| `seam-skeleton` | `src/cli/skeleton/` | Skeleton pipeline (slot, extract, document), CTR check, slot warning |
| `seam-codegen`  | `src/cli/codegen/`  | TypeScript codegen, Manifest/ProcedureSchema types, RPC hash map     |

## Key Files

- `src/main.rs` -- CLI definition and command dispatch
- `src/config/` -- types (structs), loader (find/load), tests (parsing, workspace, i18n)
- `src/build/run/` -- mod (run_build entry), helpers, frontend, fullstack, rebuild, tests
- `src/build/route/` -- mod (re-exports), types, helpers, process, manifest, tests
- `src/dev/` -- mod (run_dev entry), process, network, ui, fullstack

## Conventions

- Crate name is `seam-cli`, binary name is `seam` (do NOT use `cargo build -p seam`)
- Build modes: `is_fullstack` is true when `backend_build_command` is set in `seam.toml`
- Fullstack build extracts manifest at build time by importing the router file via bun/node
- Template output goes to `{out_dir}/templates/`, route manifest to `{out_dir}/route-manifest.json`
- Static assets copied to `{out_dir}/public/` in fullstack mode

## Testing

```sh
cargo test -p seam-cli
cargo test -p seam-skeleton
cargo test -p seam-codegen
```

- Skeleton pipeline tests (170) are in `seam-skeleton`
- Codegen tests (45) are in `seam-codegen`
- Build orchestration and config tests (94) remain in `seam-cli`

## Gotchas

- `cargo build -p seam` does NOT work; the Cargo.toml package name is `seam-cli`
- Skeleton rendering shells out to `node_modules/@canmi/seam-react/scripts/build-skeletons.mjs`; this must be installed
- Manifest extraction prefers `bun` over `node` (checks via `which`)
