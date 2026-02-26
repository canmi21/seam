# SeamJS

A compile-time rendering (CTR) framework: extract HTML skeletons from UI components at build time, inject server data through typed procedures at request time. Instead of blurring the server-client boundary, SeamJS re-establishes it — data fetching stays on the server as typed procedures, rendering stays on the client as UI components, and the framework bridges them through schema-driven codegen and template injection.

> Status: core concepts validated with React; runtime adapters and client libraries in early development.

## Design Philosophy

SeamJS is a **rendering strategy**, not a full-stack framework tied to specific technologies.

- **UI stack**: React-first for concept validation. The CTR pipeline (skeleton extraction + template injection) is UI-agnostic — adapting other frameworks (Vue, Svelte, Solid, ...) requires a corresponding skeleton extractor and client bindings. Community contributions welcome.
- **API bridge**: Currently uses JSON-RPC over HTTP. Not married to this approach — if a better protocol fits, open an issue or send a PR.
- **Backend runtime**: The server core defines a protocol, not a runtime. TypeScript, Rust, and Go implementations are provided as reference; any language can implement the seam protocol by serving the `/_seam/*` endpoints.

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

| Package                                                      | Crate / npm          | Description                                                                          |
| ------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------ |
| [server/core/typescript](packages/server/core/typescript/)   | `@canmi/seam-server` | Framework-agnostic server core (procedures, subscriptions, pages, HTTP layer)        |
| [server/core/rust](packages/server/core/rust/)               | `seam-server`        | Framework-agnostic Rust server core (procedures, subscriptions, pages, typed schema) |
| [server/core/rust-macros](packages/server/core/rust-macros/) | `seam-macros`        | Proc macros: `#[derive(SeamType)]`, `#[seam_procedure]`, `#[seam_subscription]`      |
| [server/core/go](packages/server/core/go/)                   | Go module            | Go server core with Router, RPC, SSE, pages, and graceful shutdown                   |

### Server Adapters

| Package                                       | Crate / npm                | Description                   |
| --------------------------------------------- | -------------------------- | ----------------------------- |
| [adapter/axum](packages/server/adapter/axum/) | `seam-server-axum`         | Axum adapter for Rust core    |
| [adapter/hono](packages/server/adapter/hono/) | `@canmi/seam-adapter-hono` | Hono middleware adapter       |
| [adapter/bun](packages/server/adapter/bun/)   | `@canmi/seam-adapter-bun`  | Standalone Bun server adapter |
| [adapter/node](packages/server/adapter/node/) | `@canmi/seam-adapter-node` | Node.js HTTP adapter          |

### Client Libraries

| Package                                                    | npm                           | Description                                              |
| ---------------------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| [client/vanilla](packages/client/vanilla/)                 | `@canmi/seam-client`          | Framework-agnostic client (RPC calls, SSE subscriptions) |
| [client/react](packages/client/react/)                     | `@canmi/seam-react`           | React bindings (hooks, data provider, route definitions) |
| [client/tanstack-router](packages/client/tanstack-router/) | `@canmi/seam-tanstack-router` | TanStack Router integration (route definitions, loaders) |

### Server Engine

Page assembly, i18n, build output parsing, and JSON escaping — extracted from duplicated logic across TS/Rust/Go backends into a single Rust crate. The WASM build is a superset of the injector (includes `inject`/`inject_no_script`).

| Package                                     | Crate / npm          | Description                                           |
| ------------------------------------------- | -------------------- | ----------------------------------------------------- |
| [engine/rust](packages/server/engine/rust/) | `seam-engine`        | Pure Rust engine (page assembly, i18n, build parsing) |
| [engine/wasm](packages/server/engine/wasm/) | `seam-engine-wasm`   | WASM bindings (superset of injector WASM)             |
| [engine/js](packages/server/engine/js/)     | `@canmi/seam-engine` | Node.js/Bun wrapper loading the WASM binary           |
| [engine/go](packages/server/engine/go/)     | Go module            | Go wrapper running WASM via Wazero                    |

### Template Injector

Replaces `<!--seam:...-->` markers in HTML skeletons with server data. The Rust implementation is the only source of truth. JS and Go consumers should prefer `@canmi/seam-engine` / `engine/go` which include injector functions as a superset.

| Package                                             | Crate / npm                   | Description                                                  |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------ |
| [injector/rust](packages/server/injector/rust/)     | `seam-injector`               | Core injector library (tokenize, parse, render)              |
| [injector/wasm](packages/server/injector/wasm/)     | `seam-injector-wasm`          | WASM bindings (deprecated, use `seam-engine-wasm`)           |
| [injector/js](packages/server/injector/js/)         | `@canmi/seam-injector`        | Node.js/Bun wrapper (deprecated, use `@canmi/seam-engine`)   |
| [injector/go](packages/server/injector/go/)         | Go module                     | Go wrapper (deprecated, use `engine/go`)                     |
| [injector/native](packages/server/injector/native/) | `@canmi/seam-injector-native` | Original pure TypeScript implementation (deprecated, frozen) |

### Core Libraries

| Package                | npm                | Description                                                      |
| ---------------------- | ------------------ | ---------------------------------------------------------------- |
| [i18n](packages/i18n/) | `@canmi/seam-i18n` | Framework-agnostic i18n core (translation lookup, interpolation) |

### Tooling

| Package                    | npm                         | Description                                |
| -------------------------- | --------------------------- | ------------------------------------------ |
| [eslint](packages/eslint/) | `@canmi/eslint-plugin-seam` | ESLint rules for skeleton component safety |

## Documentation

Protocol specifications and design constraints for implementors.

| Document                                               | Description                                            |
| ------------------------------------------------------ | ------------------------------------------------------ |
| [Slot Protocol](docs/slot-protocol.md)                 | Server-side HTML injection syntax (`<!--seam:path-->`) |
| [Sentinel Protocol](docs/sentinel-protocol.md)         | Build-time placeholder format for skeleton extraction  |
| [Procedure Manifest](docs/procedure-manifest.md)       | JSON schema for the `/_seam/manifest.json` endpoint    |
| [Subscription Protocol](docs/subscription-protocol.md) | SSE-based real-time streaming specification            |
| [Skeleton Constraints](docs/skeleton-constraints.md)   | Rules for build-safe skeleton components               |

## Demo

[**GitHub Dashboard**](examples/github-dashboard/) — same React UI rendered two ways: SeamJS CTR vs Next.js SSR. The CTR side runs on three interchangeable backends (TypeScript, Rust, Go) sharing one React frontend; the Next.js side uses conventional server components. Both fetch live data from the GitHub API.

|         | App                                                                                                          | Backend     | Description                                     |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------- |
| **CTR** | [seam-app](examples/github-dashboard/seam-app/)                                                              | Hono on Bun | Fullstack — frontend and server in one package  |
| **SSR** | [next-app](examples/github-dashboard/next-app/)                                                              | Next.js     | Server-rendered comparison (same UI, no CTR)    |
| **CTR** | [frontend](examples/github-dashboard/frontend/) + [ts-hono](examples/github-dashboard/backends/ts-hono/)     | Hono on Bun | Workspace — shared frontend, TypeScript backend |
| **CTR** | [frontend](examples/github-dashboard/frontend/) + [rust-axum](examples/github-dashboard/backends/rust-axum/) | Axum        | Workspace — shared frontend, Rust backend       |
| **CTR** | [frontend](examples/github-dashboard/frontend/) + [go-gin](examples/github-dashboard/backends/go-gin/)       | Gin         | Workspace — shared frontend, Go backend         |

The three workspace backends serve identical CTR-rendered pages with the same RPC procedures — a cross-language parity test for the seam protocol.

## Examples

Minimal standalone examples showing SDK usage for each language and runtime.

| Example                                               | Description                                         |
| ----------------------------------------------------- | --------------------------------------------------- |
| [server-rust](examples/standalone/server-rust/)       | Rust + Axum backend with `#[seam_procedure]` macros |
| [server-bun](examples/standalone/server-bun/)         | Bun server with Hono adapter                        |
| [server-node](examples/standalone/server-node/)       | Node.js HTTP server                                 |
| [server-go](examples/standalone/server-go/)           | Go backend with standard library                    |
| [server-go-gin](examples/standalone/server-go-gin/)   | Go backend with Gin framework                       |
| [client-vanilla](examples/standalone/client-vanilla/) | Vanilla JS client (RPC + SSE)                       |
| [client-react](examples/standalone/client-react/)     | React client with hooks and routing                 |

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
bun run build:ts         # All TypeScript packages
cargo build --workspace  # All Rust crates
```

### Test

| Command                    | Scope                                            |
| -------------------------- | ------------------------------------------------ |
| `bun run test:unit`        | All unit tests (Rust + TypeScript)               |
| `bun run test:integration` | Go integration tests                             |
| `bun run test:e2e`         | Playwright E2E tests                             |
| `bun run test`             | All layers (unit + integration + e2e)            |
| `bun run typecheck`        | TypeScript type checking across all packages     |
| `bun run verify`           | Full pipeline: format + lint + build + all tests |

## License

MIT License © 2026 [Canmi](https://github.com/canmi21)
