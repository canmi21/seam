# Roadmap

Everything listed here is planned and will be implemented. This is currently a solo project, so progress is steady but not fast. If something here overlaps with your expertise, PRs are very welcome — the decoupled architecture means you only need to implement against the [seam protocol](architecture/logic-layer.md#the-seam-protocol), not understand the rest of the system. It just works.

## Rendering Modes

- [x] CTR — compile-time rendering (nearly zero-cost SSR: skeleton at build, data injection at request)
- [ ] SSR — CTR + SSR hybrid (raw HTML slots for Markdown, rich text, server-rendered fragments)
- [ ] ISR — incremental cache layer (cache assembled CTR + SSR pages, not incremental rendering)
- ~~SSG~~ — not planned (pure static pages need no cross-dimension abstraction)

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
- [x] WebSocket (bidirectional streaming for channels)
- [ ] Tauri IPC (desktop)
- [ ] Electron IPC (desktop)

## Abstractions

- [x] Channel abstraction (Level 1 -> Level 0 expansion)
- [x] Codegen transport hint (automatic WebSocket selection)
- [x] Query/Command distinction (5 procedure kinds: query, command, subscription, stream, upload)
- [x] Stream procedures (POST + SSE response with chunkOutput)
- [x] Upload procedures (multipart/form-data with SeamFileHandle)
- [x] Declarative context extraction (manifest-level context definitions)
- [x] Command invalidation (invalidates field with mapping support)
- [x] Per-procedure transport configuration (prefer + fallback)
- [x] Query params in page loaders (from: "query" mapping)
- [x] Loader handoff (handoff: "client" for one-time server-fetched loaders)

## Router

- [x] TanStack Router integration
- [x] Filesystem router (convention-based `src/pages/`)
- [ ] Shell Router — page-level micro-frontend navigation, per-page UI framework switching

## Developer Experience

- [x] `createSeamApp()` zero-config client entry
- [x] Virtual module system (`virtual:seam/client`, `routes`, `meta`, `hooks`)
- [x] Typed hook codegen (auto-generated query/mutation hooks)
- [x] `loadBuild()` combined build artifact loader (TS + Go)
- [x] `__loaders` auto-hydration (server loader metadata to QueryClient)
- [x] `seam()` composite Vite plugin
- [x] TanStack Query integration (`@canmi/seam-query` + `@canmi/seam-query-react`)
- [x] Config priority: `seam.config.ts` > `.mjs` > `.toml`

## Architecture

- [ ] Desktop adapter — Tauri/Electron integration layer
- [ ] Serverless mode — no-filesystem deployment for edge/cloud functions
