# demo-fullstack-react-hono-tanstack

Fullstack demo: Hono server + React client with TanStack Query, built and served via `seam build` / `seam dev`.

See root CLAUDE.md for general project rules.

## Structure

```
src/
  server/
    index.ts       -- Hono app entry; mounts seam middleware + static/proxy handlers
    router.ts      -- Procedure/subscription map, exported for manifest extraction
    procedures.ts  -- RPC handlers (getPageData, getMessages, addMessage, etc.)
    subscriptions.ts -- SSE handlers (onMessage)
    state.ts       -- In-memory message store (shared mutable state)
    pages/home.tsx -- Page definition with loader
  client/
    main.tsx       -- React hydration entry
    app.tsx        -- TanStack QueryClientProvider + router shell
    routes.ts      -- Client-side route definitions
    seam.ts        -- Generated seam client instance
    pages/*-skeleton.tsx -- Skeleton components (build-time rendered)
  generated/
    client.ts      -- Auto-generated typed client (via `seam generate`)
```

## Commands

- Dev: `seam dev` (starts backend + embedded dev server with Rolldown)
- Build: `seam build` (outputs to `.seam/output/`)
- Build output must exist at `.seam/output/` before fullstack integration tests can run

## Gotchas

- `router.ts` exports a default router without pages for manifest extraction at build time
- Skeleton components are React components that render the static HTML shell; they are NOT interactive
- `state.ts` uses a simple callback array for pub/sub; not production-grade
