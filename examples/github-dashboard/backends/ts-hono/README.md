# github-dashboard-ts-hono

Hono/Bun backend for the [GitHub Dashboard](../../README.md), with dev-mode WebSocket live reload.

## Structure

- `src/index.ts` — Server entry, Seam middleware, dev proxy, static serving

## Development

- Run: `bun run dev`
- Env: `PORT`, `SEAM_DEV`, `SEAM_VITE`, `SEAM_OUTPUT_DIR`
