# src/cli/codegen

TypeScript codegen and manifest types for the SeamJS CLI. Extracted from `seam-cli` as an independent library crate.

See root CLAUDE.md for general conventions.

## Architecture

| Module        | Responsibility                                                   |
| ------------- | ---------------------------------------------------------------- |
| `manifest.rs` | `Manifest`, `ProcedureSchema`, `ChannelSchema` serde types       |
| `rpc_hash.rs` | RPC endpoint hash map generation (SHA256-based, collision-free)  |
| `typescript/` | JTD schema to TypeScript interfaces + `createSeamClient` factory |

## TypeScript Codegen Sub-modules

- `generator.rs` -- main entry point; builds `createSeamClient()` factory, procedure meta, channel types
- `render.rs` -- JTD schema to TypeScript type expressions (recursive renderer)

## Testing

```sh
cargo test -p seam-codegen
```

45 tests covering full manifest rendering, error schemas, RPC hash maps, channel codegen, and type rendering.
