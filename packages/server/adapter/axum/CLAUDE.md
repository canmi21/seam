# seam-server-axum

Axum adapter for the SeamJS Rust server core. Converts `SeamServer` into an Axum router with HTTP handlers.

See root CLAUDE.md for general project rules.

## Architecture

| Module       | Responsibility                                                           |
| ------------ | ------------------------------------------------------------------------ |
| `lib.rs`     | `IntoAxumRouter` trait + impl for `SeamServer`, re-exports `seam_server` |
| `handler.rs` | `AppState`, `build_router()`, 4 handler fns (manifest, rpc, sse, page)  |
| `error.rs`   | `AxumError` newtype, `impl IntoResponse`, `impl From<SeamError>`        |

## Data Flow

```
SeamServer::into_axum_router()
  -> into_parts() returns SeamParts (procedures, subscriptions, pages)
  -> build_manifest() produces manifest JSON
  -> build_router() wires /_seam/* routes with AppState
```

## Orphan Rule (CRITICAL)

Rust orphan rule prevents `impl IntoResponse for SeamError` in this crate because both types are foreign. Solution: `AxumError(pub SeamError)` newtype with `impl From<SeamError>` so `?` operator works transparently in handlers.

## Key Types

- `IntoAxumRouter` — extension trait providing `.into_axum_router()` and `.serve(addr)`
- `AxumError` — `pub(crate)` newtype around `SeamError` for `IntoResponse` impl
- `AppState` — shared state holding manifest, handlers, subscriptions, pages

## Testing

```sh
cargo test -p seam-server-axum
```

- `into_axum_router_builds_without_panic` — basic smoke test
- Full integration coverage via Go tests and Playwright E2E (they exercise the demo server)

## Gotchas

- Crate name is `seam-server-axum`, not `seam-axum`
- `futures-core` is needed for `Stream` trait in SSE handler
- `seam-injector` is a direct dependency (page handler calls `inject()`)
