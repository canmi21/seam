# seam-cli

SeamJS command-line tool for building HTML skeleton templates, generating typed TypeScript clients from procedure manifests, and orchestrating dev servers.

## Crate Structure

The CLI is split into three crates:

- `seam-skeleton` (`src/cli/skeleton/`) — HTML skeleton extraction pipeline (slot, extract, document, CTR check)
- `seam-codegen` (`src/cli/codegen/`) — TypeScript codegen, manifest types, RPC hash map
- `seam-cli` (`src/cli/core/`) — Build orchestration, dev servers, CLI entry point (this crate)

## Modules

- `src/main.rs` — CLI entry point (clap), dispatches subcommands
- `src/config/` — Parses `seam.toml`, walks up directory tree to find config
- `src/pull.rs` — Fetches `/_seam/manifest.json` from a running server
- `src/build/` — Build pipeline orchestration (route processing, asset packaging)
- `src/dev/` — Starts backend + frontend dev servers
- `src/ui.rs` — Terminal output formatting

## Commands

| Command         | Description                                        |
| --------------- | -------------------------------------------------- |
| `seam pull`     | Fetch procedure manifest from a running server     |
| `seam generate` | Generate typed client from a manifest file         |
| `seam build`    | Extract HTML skeletons and run full build pipeline |
| `seam dev`      | Start backend and frontend dev servers             |

## Development

- Build: `cargo build -p seam-cli`
- Test: `cargo test -p seam-cli`
- Run: `cargo run -p seam-cli -- <command>`

## Notes

- The crate name is `seam-cli`, but the binary name is `seam`
- Config file lookup walks up the directory tree until it finds `seam.toml`
- Skeleton logic lives in `seam-skeleton`, codegen in `seam-codegen`
