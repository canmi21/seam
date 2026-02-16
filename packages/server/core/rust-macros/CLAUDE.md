# seam-macros

Proc-macro crate providing derive and attribute macros for Seam server definitions.

## Architecture

- Three macros exposed from `lib.rs`:
  - `#[derive(SeamType)]` -- generates `SeamType` trait impl with JTD schema for structs (named fields) and enums (unit variants only)
  - `#[seam_procedure]` -- wraps an async function into a `ProcedureDef` factory; optional `name = "..."` attribute overrides the procedure name
  - `#[seam_subscription]` -- wraps an async function into a `SubscriptionDef` factory; same `name` attribute support
- Each macro delegates to an `expand()` function in its own module
- Generated code references `seam_server::` types (`ProcedureDef`, `SubscriptionDef`, `SeamType`, `SeamError`)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib.rs` | Macro entry points |
| `src/seam_type.rs` | `#[derive(SeamType)]` -- struct/enum to JTD schema |
| `src/seam_procedure.rs` | `#[seam_procedure]` -- generates `{fn_name}_procedure()` factory |
| `src/seam_subscription.rs` | `#[seam_subscription]` -- generates `{fn_name}_subscription()` factory |

## Testing

```sh
cargo test --workspace
```

- This is a proc-macro crate; it has no standalone unit tests
- Macro expansion is tested indirectly via `seam-server` and `examples/standalone/server-rust`

## Gotchas

- `seam_procedure` expects exactly one input parameter and a `Result<T, SeamError>` return type; it extracts `T` as the output schema type
- `seam_subscription` digs three levels deep into generics to extract the output type from `Result<BoxStream<Result<T, SeamError>>, SeamError>`
- `SeamType` derive only supports structs with named fields and enums with unit variants -- tuple structs and enums with data will fail at compile time
- `Option<T>` fields are emitted as JTD `optionalProperties` with `nullable: true`

See root CLAUDE.md for project-wide conventions.
