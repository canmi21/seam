# SeamJS

A compile-time rendering (CTR) framework: extract HTML skeletons from React components at build time, inject server data through typed procedures at request time. Instead of blurring the server-client boundary, SeamJS re-establishes it — data fetching stays on the server as typed procedures, rendering stays on the client as React components, and the framework bridges them through schema-driven codegen and template injection.

> Status: core concepts validated; runtime adapters and client libraries in early development.

## Packages

### CLI

| Package | Crate / npm | Description |
|---------|-------------|-------------|
| [cli/core](packages/cli/core/) | `seam-cli` | Build skeletons, generate typed clients, orchestrate dev servers |
| [cli/pkg](packages/cli/pkg/) | `@canmi/seam-cli` | npm distribution wrapper for the CLI binary |

### Server Core

| Package | Crate / npm | Description |
|---------|-------------|-------------|
| [server/core/typescript](packages/server/core/typescript/) | `@canmi/seam-server` | Framework-agnostic server core (procedures, subscriptions, pages, HTTP layer) |
| [server/core/rust](packages/server/core/rust/) | `seam-server` | Rust server core with built-in HTML template injector, built on axum |
| [server/core/rust-macros](packages/server/core/rust-macros/) | `seam-macros` | Proc macros: `#[derive(SeamType)]`, `#[seam_procedure]`, `#[seam_subscription]` |

### Server Adapters

| Package | npm | Description |
|---------|-----|-------------|
| [adapter/hono](packages/server/adapter/hono/) | `@canmi/seam-adapter-hono` | Hono middleware adapter |
| [adapter/bun](packages/server/adapter/bun/) | `@canmi/seam-adapter-bun` | Standalone Bun server adapter |
| [adapter/node](packages/server/adapter/node/) | `@canmi/seam-adapter-node` | Node.js HTTP adapter |

### Client Libraries

| Package | npm | Description |
|---------|-----|-------------|
| [client/vanilla](packages/client/vanilla/) | `@canmi/seam-client` | Framework-agnostic client (RPC calls, SSE subscriptions) |
| [client/react](packages/client/react/) | `@canmi/seam-react` | React bindings (hooks, data provider, route definitions) |

### Template Engine

| Package | npm | Description |
|---------|-----|-------------|
| [server/injector](packages/server/injector/) | `@canmi/seam-injector` | HTML template injector (`<!--seam:...-->` marker replacement) |

## Examples

| Example | Description |
|---------|-------------|
| [react-hono-tanstack](examples/fullstack/react-hono-tanstack/) | Fullstack demo: Hono server + React client with TanStack Query |
| [server-rust](examples/standalone/server-rust/) | Standalone Rust backend |
| [server-bun](examples/standalone/server-bun/) | Standalone Bun server |
| [server-node](examples/standalone/server-node/) | Standalone Node.js server |
| [client-vanilla](examples/standalone/client-vanilla/) | Vanilla JS client |
| [client-react](examples/standalone/client-react/) | React client |

## Development

### Prerequisites

- [Bun](https://bun.sh/) — TypeScript build and test
- [Cargo](https://www.rust-lang.org/tools/install) — Rust build and test
- [Go](https://go.dev/) — integration tests

### Setup

```bash
bun install
```

### Build

```bash
# TypeScript packages
bun run --filter '<pkg>' build

# Rust workspace
cargo build --workspace
```

### Test

```bash
# TypeScript packages
bun run --filter '<pkg>' test

# Rust workspace
cargo test --workspace

# Go integration tests
cd tests/integration && go test -v
cd tests/fullstack && go test -v
```
