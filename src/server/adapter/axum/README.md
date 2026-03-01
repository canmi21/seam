# seam-server-axum

Axum adapter for the SeamJS Rust server core. Provides HTTP routing, SSE handlers, and page rendering on top of [seam-server](../../core/rust/).

## Usage

```rust
use seam_server::SeamServer;
use seam_server_axum::IntoAxumRouter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    SeamServer::new()
        .procedure(my_procedure())
        .serve("0.0.0.0:3000")
        .await
}
```

## API

- `IntoAxumRouter` trait — extension trait on `SeamServer`
  - `.into_axum_router()` — builds an `axum::Router` with `/_seam/*` routes
  - `.serve(addr)` — binds a TCP listener and serves the router

## Development

```sh
cargo build -p seam-server-axum
cargo test -p seam-server-axum
```
