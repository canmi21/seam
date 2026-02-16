# seam-macros

Procedural macro crate providing derive and attribute macros for seam-server.

## Macros

| Macro                  | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `#[derive(SeamType)]`  | Generate `SeamType` trait impl with JTD schema from struct fields |
| `#[seam_procedure]`    | Wrap an async function into a `ProcedureDef` factory              |
| `#[seam_subscription]` | Wrap an async function into a `SubscriptionDef` factory           |

## Structure

- `src/lib.rs` — Macro entry points
- `src/seam_type.rs` — `SeamType` derive logic
- `src/procedure.rs` — Procedure attribute macro
- `src/subscription.rs` — Subscription attribute macro

## Development

- Build: `cargo build -p seam-macros`
- Test: `cargo test -p seam-macros`

## Notes

- This is a `proc-macro = true` crate; it cannot export non-macro items
- Used internally by `seam-server` — consumers use `seam-server`'s re-exports
