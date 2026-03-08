# seam-macros

Proc-macro crate providing derive and attribute macros for Seam server definitions.

## Architecture

- Six macros exposed from `lib.rs`:
  - `#[derive(SeamType)]` -- generates `SeamType` trait impl with JTD schema for structs (named fields) and enums (unit variants only)
  - `#[seam_procedure]` -- wraps an async function into a `ProcedureDef` factory; attributes: `name = "..."`, `error = ErrorType`, `context = CtxType`
  - `#[seam_subscription]` -- wraps an async function into a `SubscriptionDef` factory; attributes: `name = "..."`, `context = CtxType`
  - `#[seam_command]` -- wraps an async function into a command `ProcedureDef` factory (sets `ProcedureType::Command`); same attributes as `seam_procedure`
  - `#[seam_stream]` -- wraps an async function into a `StreamDef` factory; attributes: `name = "..."`, `context = CtxType`
  - `#[seam_upload]` -- wraps an async function into an `UploadDef` factory; attributes: `name = "..."`, `error = ErrorPath`, `context = CtxType`
- Each macro delegates to an `expand()` function in its own module
- Generated code references `seam_server::` types (`ProcedureDef`, `SubscriptionDef`, `SeamType`, `SeamError`)

## Key Files

| File                       | Purpose                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `src/lib.rs`               | Macro entry points                                                               |
| `src/seam_type.rs`         | `#[derive(SeamType)]` -- struct/enum to JTD schema                               |
| `src/seam_procedure.rs`    | `#[seam_procedure]` -- generates `{fn_name}_procedure()` factory                 |
| `src/seam_subscription.rs` | `#[seam_subscription]` -- generates `{fn_name}_subscription()` factory           |
| `src/seam_command.rs`      | `#[seam_command]` -- delegates to `seam_procedure` with `ProcedureType::Command` |
| `src/seam_stream.rs`       | `#[seam_stream]` -- generates `{fn_name}_stream()` factory                       |
| `src/seam_upload.rs`       | `#[seam_upload]` -- generates `{fn_name}_upload()` factory                       |

## Testing

```sh
cargo test --workspace
```

- This is a proc-macro crate; it has no standalone unit tests
- Macro expansion is tested indirectly via `seam-server` and `examples/standalone/server-rust`

## Gotchas

- `seam_procedure` expects one input parameter (or two with `context = CtxType`: input + ctx) and a `Result<T, SeamError>` return type; it extracts `T` as the output schema type
- `context = CtxType` attribute generates a two-parameter handler; the context type must implement `SeamType` + `Deserialize`; its JTD schema `properties` keys become `context_keys`
- `seam_subscription` digs three levels deep into generics to extract the output type from `Result<BoxStream<Result<T, SeamError>>, SeamError>`
- `seam_stream` uses the same three-level generic extraction as `seam_subscription` (handler returns `Result<BoxStream<Result<ChunkType, SeamError>>, SeamError>`)
- `seam_upload` expects at least two parameters (input + `SeamFileHandle`) and a `Result<OutputType, SeamError>` return type
- `SeamType` derive only supports structs with named fields and enums with unit variants -- tuple structs and enums with data will fail at compile time
- `Option<T>` fields are emitted as `properties` with `nullable: true` (required but nullable, per JTD spec)
- `#[seam(optional)]` on a field puts it in `optionalProperties` (may be absent); combine with `Option<T>` for optional + nullable

See root CLAUDE.md for project-wide conventions.
