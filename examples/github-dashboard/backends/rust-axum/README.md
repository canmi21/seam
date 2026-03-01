# github-dashboard-axum

Axum backend for the [GitHub Dashboard](../../README.md), serving SeamJS CTR pages with Rust procedures.

## Structure

- `src/main.rs` — Server entry, procedure registration, page/static routing
- `src/procedures.rs` — `get_session`, `get_home_data`, `get_user`, `get_user_repos`

## Development

- Build: `cargo build -p github-dashboard-axum`
- Run: `SEAM_OUTPUT_DIR=../../seam-app/.seam/output cargo run -p github-dashboard-axum`
