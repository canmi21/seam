# seam-cli

SeamJS command-line tool for building HTML skeleton templates, generating typed TypeScript clients from procedure manifests, and orchestrating dev servers.

## Structure

- `src/main.rs` — CLI entry point (clap), dispatches subcommands
- `src/config.rs` — Parses `seam.toml`, walks up directory tree to find config
- `src/manifest.rs` — `Manifest` / `ProcedureSchema` types
- `src/pull.rs` — Fetches `/_seam/manifest.json` from a running server
- `src/codegen/typescript.rs` — JTD schema to TypeScript interfaces + `createSeamClient` factory
- `src/build/skeleton/` — HTML template extraction pipeline (slot, extract, document)
- `src/dev.rs` — Starts backend + frontend dev processes
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
- The `build` subcommand orchestrates skeleton extraction: slot detection, content extraction, and document assembly
