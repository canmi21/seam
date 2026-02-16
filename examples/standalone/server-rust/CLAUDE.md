# demo-server-rust

Standalone Rust backend example using `seam-server` and `seam-macros`.

See root CLAUDE.md for general project rules.

## Structure

- `src/main.rs` -- Entry point; registers procedures, subscriptions, and pages on `SeamServer`
- `src/procedures/` -- One file per procedure (`greet`, `get_user`, `list_users`)
- `src/subscriptions/` -- One file per subscription (`on_count`)
- `src/pages/` -- Page definitions with loaders

## Commands

```sh
cargo build -p demo-server-rust
cargo run -p demo-server-rust
```

- Crate name is `demo-server-rust` (not `server-rust`)
- Default port 3000; override with `PORT` env var

## Gotchas

- Used by `tests/integration/` as one of three backend targets
- Demonstrates `#[seam_procedure]`, `#[seam_subscription]`, and `#[derive(SeamType)]` macro usage
