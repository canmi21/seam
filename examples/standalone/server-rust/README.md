# demo-server-rust

Standalone Rust backend demonstrating seam-server with procedures, subscriptions, and pages.

## Structure

- `src/main.rs` — Server setup with `SeamServer` builder
- `src/procedures/` — Procedure definitions using `#[seam_procedure]`
- `src/subscriptions/` — Subscription definitions using `#[seam_subscription]`
- `src/pages/` — Page definitions with loaders

## Development

- Run: `cargo run -p demo-server-rust`
- Test: `cargo test -p demo-server-rust`
