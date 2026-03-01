# github-dashboard-go-gin

Go/Gin backend for the [GitHub Dashboard](../../README.md), using the SeamJS Go server core with wazero WASM engine.

## Structure

- `main.go` — Server entry, Gin router, procedure registration, NoRoute page fallback
- `procedures.go` — Procedure definitions matching the Rust/TS backends

## Development

- Build: `go build -o server .`
- Run: `SEAM_OUTPUT_DIR=../../seam-app/.seam/output ./server`
