# react-hono-tanstack

Fullstack demo combining a Hono server with a React client using TanStack Query.

## Structure

- `src/server/` — Hono app with procedures, subscriptions, pages, and shared state
- `src/client/` — React hydration with TanStack Query and skeleton components
- `src/generated/` — Auto-generated typed client (output of `seam generate`)

## Packages Used

- `@canmi/seam-adapter-hono`, `@canmi/seam-server` (server)
- `@canmi/seam-client`, `@canmi/seam-react` (client)

## Development

- Dev: `bun run dev`
- Build: `bun run build`

## Notes

- Build output at `.seam/output/` must exist before page tests run
- Skeleton components in `src/client/pages/*-skeleton.tsx` are extracted at build time
