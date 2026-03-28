# Roadmap

Everything listed here is planned and will be implemented. This is currently a solo project, so progress is steady but not fast. If something here overlaps with your expertise, PRs are very welcome — the decoupled architecture means you only need to implement against the [seam protocol](architecture/logic-layer.md#the-seam-protocol), not understand the rest of the system. It just works.

## Rendering Modes

- [x] CTR — compile-time rendering (nearly zero-cost SSR: skeleton at build, data injection at request)
- [x] SSR — CTR + SSR hybrid (raw HTML slots for Markdown, rich text, server-rendered fragments)
- [x] SSG — hybrid output modes (`static`/`server`/`hybrid`), build-time rendering, SPA navigation via `/_seam/data/{path}`

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
- [x] Per-loader error boundaries (partial page rendering on loader failure)
- [x] Declarative derive layer (route-level data transformations from loader results, executed via QuickJS/goja/Function)

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
- [x] Procedure factory functions (query(), command(), stream(), upload(), subscription())
- [x] createSeamRouter (router-bound typed factories)
- [x] useSeamFetch hook
- [x] Loader input validation (opt-in JTD validation for page loaders)
- [x] SSE heartbeat and idle timeout (transport reliability)
- [x] WebSocket ping/pong half-open connection detection
- [x] Client-side reconnection with exponential backoff
- [x] Built-in JTD input validation (all procedure kinds + loaders)
- [x] Procedure suppress and cache fields
- [x] Cookie and query context extraction sources
- [x] Built-in bundler consolidation (BundlerMode removed)
- [x] Structured head metadata (`HeadConfig`/`HeadFn` on routes)
- [x] Procedure namespaces (dot-path flattening, reserved `seam.` prefix)
- [x] Runtime `defineConfig` validation
- [x] Subscription event IDs (incrementing `id` + `Last-Event-ID` resumption)
- [x] `SubscriptionParams`/`StreamParams` (Rust structured handler signatures)

## Architecture

- [ ] Desktop adapter — Tauri/Electron integration layer
- [ ] Serverless mode — no-filesystem deployment for edge/cloud functions
