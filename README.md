# SeamJS

**Rendering is a protocol, not a runtime.**

The missing joint between anything that renders and anything that computes. SeamJS decouples your UI framework, backend language, and transport channel into three independent dimensions — any combination works, and adding a new option in one dimension requires zero changes in the others.

> **Audience**: SeamJS is in early development and targets developers who are comfortable reading source code, building from source, and working with unfinished APIs. It is not yet ready for general end-user consumption.
>
> **Status**: core pipeline validated with React + Rust/TypeScript/Go backends. HTTP RPC, SSE, and i18n are ready. See [Roadmap](docs/roadmap.md) for what's next.

## Why SeamJS

SSR and RSC merge rendering into the server runtime. Your backend language must be JavaScript. Your deployment must run Node.js, etc. Your frontend framework must be the one the metaframework chose.

SeamJS rejects this coupling. The server never imports or executes UI code. Instead:

1. **Build time**: UI components are rendered to HTML skeletons with typed injection points
2. **Request time**: the server fills those slots with data via string replacement — in any language
3. **Client**: hydrates the known skeleton structure and takes over

This is **compile-time rendering (CTR)**. The server is a data source with a template engine, not a JavaScript runtime. A Rust backend works the same as a TypeScript one. A Go backend works the same as both. The UI framework is irrelevant to the server.

## Three-Axis Decoupling

SeamJS has three independent dimensions. Changing one never affects the others.

### [UI Layer](docs/ui-layer.md)

Any framework that can `renderToString` can produce a SeamJS skeleton. The framework runs only in the browser — the server never touches it. React is implemented today; Vue, Svelte, Solid, and HTMX are planned.

### [Logic Layer](docs/logic-layer.md)

The server is defined by a protocol (`/_seam/*` endpoints), not a runtime. Any language that can serve HTTP and do string replacement is a valid backend. Rust, TypeScript, and Go are implemented today — with symmetric feature sets across all three.

### [Transport Layer](docs/transport-layer.md)

Procedure handlers are pure `(input) -> output` functions. The transport (HTTP, SSE, WebSocket, IPC) is a separate adapter layer. Today: HTTP RPC, batch RPC, and SSE. Planned: WebSocket, Tauri IPC, Electron IPC.

## Application Scenarios

### Fullstack Web

Any frontend + any backend. A React app calls typed procedures served by Rust, TypeScript, or Go — over HTTP RPC with auto-generated client code. No Node.js needed on the server. CTR replaces SSR: skeletons are built once, data is injected per request.

### Desktop

Tauri and Electron provide a window and IPC channel. SeamJS procedure handlers are transport-agnostic — swap the HTTP adapter for an IPC adapter and the same codebase runs as a desktop app. (Planned; the handler abstraction is ready, adapters are not yet built.)

### The Missing Piece for Backend Developers

If you're a Rust, Go, C++, or C# developer who wants a modern web UI without learning Next.js, Nuxt, or SvelteKit — SeamJS is the bridge. Implement the seam protocol in your language, and you get a typed frontend with React (or any future framework) without touching a JS metaframework. The protocol is simple: serve a manifest, handle RPC calls, inject data into skeletons.

## Rendering Modes

| Mode | Description                                                 | Status      |
| ---- | ----------------------------------------------------------- | ----------- |
| CTR  | Compile-time rendering — skeleton at build, data at request | Implemented |
| SSG  | Static site generation — pre-render pages with known data   | Planned     |
| SSR  | Selective server-side rendering — CTR + SSR hybrid          | Planned     |
| ISR  | Incremental static regeneration — rebuild pages on demand   | Planned     |

## Current Status

**Implemented**: React frontend (client, bindings, router, i18n, linter). Three backend runtimes (Rust, TypeScript, Go) with symmetric feature sets. HTTP RPC, batch RPC, SSE streaming. Full CLI (build, generate, dev, pull, clean). Locale resolution with URL prefix, cookie, accept-language, and query strategies.

**Next**: additional UI frameworks (Vue, Svelte), WebSocket transport, desktop adapters (Tauri/Electron), SSG rendering mode.

See [Roadmap](docs/roadmap.md) for the full list.

## Quick Links

**By dimension**

- [UI Layer](docs/ui-layer.md) — frontend packages and framework support
- [Logic Layer](docs/logic-layer.md) — backend packages, CLI, and the seam protocol
- [Transport Layer](docs/transport-layer.md) — wire protocols and adapter architecture

**Protocol specs**

- [Slot Protocol](docs/slot-protocol.md) — server-side HTML injection syntax
- [Sentinel Protocol](docs/sentinel-protocol.md) — build-time placeholder format
- [Procedure Manifest](docs/procedure-manifest.md) — `/_seam/manifest.json` schema
- [Subscription Protocol](docs/subscription-protocol.md) — SSE streaming specification
- [Skeleton Constraints](docs/skeleton-constraints.md) — rules for build-safe components

**Demos and examples**

- [GitHub Dashboard](examples/github-dashboard/) — CTR with three backend runtimes (Rust, TypeScript, Go)
- [i18n Demo](examples/i18n-demo/) — URL-prefix and hidden locale modes
- [Standalone examples](examples/standalone/) — minimal SDK usage for each language

**Community**

- [Ecosystem](ECOSYSTEM.md) — third-party frameworks, backends, and adapters built with SeamJS
- [Code of Conduct](CODE_OF_CONDUCT.md)

**Development**

- [Development guide](docs/development.md) — prerequisites, build commands, test matrix

## License

MIT License © 2026 [Canmi](https://github.com/canmi21)
