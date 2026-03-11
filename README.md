# SeamJS

**Seam** is a protocol that separates rendering from runtime. **SeamJS** is the framework that implements it — stitching together existing tools (Vite, TanStack Query, TanStack Router) where they already work, and building custom pipelines (skeleton extraction, injection engine, CLI) where they don't.

## How It Works

Traditional SSR calls `renderToString` on every request — your entire component tree is re-evaluated, a virtual DOM is built, and the result is serialized. Even in a pure TypeScript stack, this costs ~100-300ms per page.

SeamJS moves that work to build time:

1. **Build time** — `renderToString` runs once. The output is diffed into an HTML skeleton with typed slot markers
2. **Request time** — the server resolves data loaders, then the engine fills slots via AST-based injection (~1ms)
3. **Client** — hydrates the known skeleton and takes over

No component tree at request time. No virtual DOM. No `renderToString`. The rendering cost becomes negligible — only your data loaders matter.

This is **compile-time rendering (CTR)**. It works with any backend language because the server never imports UI code — it only performs data injection on a pre-built template. Rust, TypeScript, and Go all share the same engine and the same protocol.

## What You Get

| Layer      | Details                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Frontend   | React: client bindings, TanStack Router, filesystem router, i18n, TanStack Query, ESLint plugin      |
| Backend    | Rust (Axum) / TypeScript (Hono, Bun, Node) / Go (Gin, Chi, net/http) — symmetric APIs, same protocol |
| Procedures | query, command, subscription, stream, upload — codegen, namespaces, context, invalidation, JTD       |
| Transport  | HTTP RPC, batch RPC, SSE, WebSocket channels, stream SSE, multipart upload                           |
| Rendering  | CTR (compile-time), SSR ([HTML slot injection](docs/protocol/slot-protocol.md)), SSG (hybrid modes)  |
| CLI        | `build`, `generate`, `dev`, `pull`, `clean` — virtual modules, `loadBuild()`, head metadata          |

## Getting Started

Pick a standalone server example and run it:

```sh
# TypeScript (Bun)
cd examples/standalone/server-bun && bun run src/index.ts

# Rust (Axum)
cd examples/standalone/server-rust && cargo run

# Go (net/http)
cd examples/standalone/server-go && go run .
```

For a fullstack example with React frontend, see the [GitHub Dashboard](examples/github-dashboard/) — same UI running on three interchangeable backends.

## Examples

- [GitHub Dashboard](examples/github-dashboard/) — fullstack CTR with Rust, TypeScript, and Go backends
- [Markdown Demo](examples/markdown-demo/) — SSR via HTML slot injection with server-side rendering
- [i18n Demo](examples/i18n-demo/) — URL-prefix and hidden locale resolution
- [shadcn/ui Demo](examples/shadcn-ui-demo/) — Tailwind CSS v4 + Radix/shadcn behavior under CTR and hydration
- [FS Router Demo](examples/fs-router-demo/) — filesystem router with all route types
- [Feature Demos](examples/features/) — channels, context, streams, queries, and handoff
- [Standalone Servers](examples/standalone/) — minimal SDK usage for each language

## Documentation

**Architecture** — [UI Layer](docs/architecture/ui-layer.md) / [Logic Layer](docs/architecture/logic-layer.md) / [Transport Layer](docs/architecture/transport-layer.md)

**Protocol** — [Slot](docs/protocol/slot-protocol.md) / [Sentinel](docs/protocol/sentinel-protocol.md) / [Manifest](docs/protocol/procedure-manifest.md) / [Subscription](docs/protocol/subscription-protocol.md) / [Channel](docs/protocol/channel-protocol.md) / [Skeleton Constraints](docs/protocol/skeleton-constraints.md)

**Development** — [Build commands, test matrix, prerequisites](docs/development.md)

## Roadmap

Soild, Svelte and Vue frontends. Tauri and Electron desktop adapters. Serverless deployment mode. Island Mode; See the [full roadmap](docs/roadmap.md).

The seam protocol is open — any language that serves HTTP can be a backend. PRs for new UI frameworks, backend languages, and transport adapters are welcome.

## Community

- [Ecosystem](ECOSYSTEM.md) — third-party frameworks, backends, and adapters
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License

MIT License © 2026 [Canmi](https://github.com/canmi21)
