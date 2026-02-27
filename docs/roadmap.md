# Roadmap

Everything listed here is planned and will be implemented. This is currently a solo project, so progress is steady but not fast. If something here overlaps with your expertise, PRs are very welcome — the decoupled architecture means you only need to implement against the [seam protocol](logic-layer.md#the-seam-protocol), not understand the rest of the system. It just works.

## Rendering Modes

- [x] CTR — compile-time rendering (skeleton extraction + request-time injection)
- [ ] SSG — static site generation (pre-render pages with known data at build time)
- [ ] SSR — selective server-side rendering (CTR + SSR hybrid for dynamic pages)
- [ ] ISR — incremental static regeneration (rebuild individual pages on demand)

## UI Frameworks

- [x] React (bindings, router, i18n, linter)
- [ ] Vue
- [ ] Svelte
- [ ] Solid
- [ ] HTMX

## Backend Languages

- [x] Rust (core, macros, Axum adapter, engine)
- [x] TypeScript (core, Node/Bun/Hono adapters, engine via WASM)
- [x] Go (core, engine via WASM)
- [ ] Python
- [ ] C# / .NET
- Any language — implement the protocol, get a typed frontend

## Transport Channels

- [x] HTTP RPC (request/response)
- [x] SSE (streaming subscriptions)
- [x] Batch RPC (bundled calls)
- [ ] WebSocket (bidirectional streaming)
- [ ] Tauri IPC (desktop)
- [ ] Electron IPC (desktop)

## Architecture

- [ ] Shell Router — page-level micro-frontend navigation, per-page UI framework switching
- [ ] Desktop adapter — Tauri/Electron integration layer
- [ ] Serverless mode — no-filesystem deployment for edge/cloud functions
