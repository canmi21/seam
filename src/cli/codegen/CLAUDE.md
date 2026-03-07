# src/cli/codegen

TypeScript codegen and manifest types for the SeamJS CLI. Extracted from `seam-cli` as an independent library crate.

See root CLAUDE.md for general conventions.

## Architecture

| Module        | Responsibility                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `manifest/`   | `Manifest`, `ProcedureSchema`, `ChannelSchema`, `ContextSchema`, `TransportConfig`, `InvalidateTarget`, `MappingValue` serde types |
| `rpc_hash.rs` | RPC endpoint hash map generation (SHA256-based, collision-free)                                                                    |
| `typescript/` | JTD schema to TypeScript interfaces, `createSeamClient` factory, meta module, hooks module, type declarations                        |

## Manifest Types (manifest/)

- `ProcedureType`: query, command, subscription, stream, upload
- `ProcedureSchema`: `kind` field (with `type` alias for v1 compat), `input`, `output`, `chunkOutput` (streams), `error`, `invalidates`, `context`, `transport`
- `ContextSchema`: `extract` (extractor name) + `schema` (JTD)
- `TransportConfig`: `prefer` + optional `fallback` array of `TransportPreference` (http/sse/ws/ipc)
- `InvalidateTarget`: `query` + optional `mapping` with `MappingValue` (from + optional each)
- `Manifest`: `version`, `context`, `procedures`, `channels`, `transportDefaults`

## TypeScript Codegen Sub-modules

- `generator/` -- main entry point (`mod.rs`), channel codegen (`channel.rs`), transport hints (`transport.rs`); builds `createSeamClient()` factory, procedure meta; handles all 5 procedure kinds
- `render.rs` -- JTD schema to TypeScript type expressions (recursive renderer)
- `tests/` -- `mod.rs` + `fixtures.rs` (shared builders) + `manifest.rs` + `channel.rs` + `render.rs`

## Codegen Outputs

| File | Generator | Content |
|------|-----------|---------|
| `client.ts` | `generate_typescript()` | createSeamClient factory, types, SeamProcedures, SeamProcedureMeta, seamProcedureConfig, seamTransportHint |
| `meta.ts` | `generate_typescript()` | DATA_ID, seamTransportHint, seamProcedureConfig, SeamProcedureMeta (shared subset of client.ts) |
| `hooks.ts` | `generate_hooks_module()` | Typed hook wrappers via TS instantiation expressions (useSeamFetch, useSeamQuery, useSeamMutation) |
| `seam.d.ts` | `generate_type_declarations()` | Ambient `declare module` for `virtual:seam/client`, `virtual:seam/routes`, `virtual:seam/meta`, `virtual:seam/hooks` |
| `route-procedures.ts` | build pipeline | Procedure-to-route mapping |

`hooks.ts` is only emitted when `@canmi/seam-query-react` is detected in project dependencies.

## Testing

```sh
cargo test -p seam-codegen
```

82 tests covering full manifest rendering, error schemas, RPC hash maps, channel codegen, type rendering, context refs validation, invalidation, transport config, and stream/upload deserialization.
