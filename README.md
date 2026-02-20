# SeamJS

A compile-time rendering (CTR) framework: extract HTML skeletons from UI components at build time, inject server data through typed procedures at request time. Instead of blurring the server-client boundary, SeamJS re-establishes it — data fetching stays on the server as typed procedures, rendering stays on the client as UI components, and the framework bridges them through schema-driven codegen and template injection.

> Status: core concepts validated with React; runtime adapters and client libraries in early development.

## Design Philosophy

SeamJS is a **rendering strategy**, not a full-stack framework tied to specific technologies.

- **UI stack**: React-first for concept validation. The CTR pipeline (skeleton extraction + template injection) is UI-agnostic — adapting other frameworks (Vue, Svelte, Solid, ...) requires a corresponding skeleton extractor and client bindings. Community contributions welcome.
- **API bridge**: Currently uses JSON-RPC over HTTP. Not married to this approach — if a better protocol fits, open an issue or send a PR.
- **Backend runtime**: The server core defines a protocol, not a runtime. TypeScript and Rust implementations are provided as reference; any language can implement the seam protocol by serving the `/_seam/*` endpoints.

### How CTR Differs

- **vs SSG / SSR**: SSG bakes data into HTML at build time (static); SSR renders full HTML at every request (dynamic). CTR splits the two — structure is extracted once at build time, data is injected per request. No server-side rendering runtime, no stale static pages.
- **vs CSR / SSR**: CSR ships an empty shell and renders everything client-side; SSR duplicates rendering logic on the server to produce HTML. CTR avoids both extremes — the server never runs UI components, it only fills typed slots in a pre-built skeleton. The client hydrates a known structure instead of reconciling server-rendered markup.

## Packages

### CLI

| Package                        | Crate / npm       | Description                                                      |
| ------------------------------ | ----------------- | ---------------------------------------------------------------- |
| [cli/core](packages/cli/core/) | `seam-cli`        | Build skeletons, generate typed clients, orchestrate dev servers |
| [cli/pkg](packages/cli/pkg/)   | `@canmi/seam-cli` | npm distribution wrapper for the CLI binary                      |

### Server Core

| Package                                                      | Crate / npm          | Description                                                                     |
| ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| [server/core/typescript](packages/server/core/typescript/)   | `@canmi/seam-server` | Framework-agnostic server core (procedures, subscriptions, pages, HTTP layer)   |
| [server/core/rust](packages/server/core/rust/)               | `seam-server`        | Rust server core with built-in HTML template injector, built on axum            |
| [server/core/rust-macros](packages/server/core/rust-macros/) | `seam-macros`        | Proc macros: `#[derive(SeamType)]`, `#[seam_procedure]`, `#[seam_subscription]` |

### Server Adapters

| Package                                       | npm                        | Description                   |
| --------------------------------------------- | -------------------------- | ----------------------------- |
| [adapter/hono](packages/server/adapter/hono/) | `@canmi/seam-adapter-hono` | Hono middleware adapter       |
| [adapter/bun](packages/server/adapter/bun/)   | `@canmi/seam-adapter-bun`  | Standalone Bun server adapter |
| [adapter/node](packages/server/adapter/node/) | `@canmi/seam-adapter-node` | Node.js HTTP adapter          |

### Client Libraries

| Package                                    | npm                  | Description                                              |
| ------------------------------------------ | -------------------- | -------------------------------------------------------- |
| [client/vanilla](packages/client/vanilla/) | `@canmi/seam-client` | Framework-agnostic client (RPC calls, SSE subscriptions) |
| [client/react](packages/client/react/)     | `@canmi/seam-react`  | React bindings (hooks, data provider, route definitions) |

### Template Engine

| Package                                      | npm                    | Description                                                   |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| [server/injector](packages/server/injector/) | `@canmi/seam-injector` | HTML template injector (`<!--seam:...-->` marker replacement) |

### Tooling

| Package                                            | npm                         | Description                                |
| -------------------------------------------------- | --------------------------- | ------------------------------------------ |
| [eslint-plugin-seam](packages/eslint-plugin-seam/) | `@canmi/eslint-plugin-seam` | ESLint rules for skeleton component safety |

## Examples

| Example                                               | Description                                            |
| ----------------------------------------------------- | ------------------------------------------------------ |
| [github-dashboard](examples/github-dashboard/)        | GitHub Dashboard: SeamJS CTR vs Next.js SSR comparison |
| [server-rust](examples/standalone/server-rust/)       | Standalone Rust backend                                |
| [server-bun](examples/standalone/server-bun/)         | Standalone Bun server                                  |
| [server-node](examples/standalone/server-node/)       | Standalone Node.js server                              |
| [client-vanilla](examples/standalone/client-vanilla/) | Vanilla JS client                                      |
| [client-react](examples/standalone/client-react/)     | React client                                           |

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
cd tests/integration && go test -v -count=1
cd tests/fullstack && go test -v -count=1
```
