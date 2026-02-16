# @canmi/seam-adapter-hono

Hono middleware adapter that routes `/_seam/*` requests through the seam HTTP handler.

See root CLAUDE.md for general project rules.

## Architecture

- Wraps `createHttpHandler` and `toWebResponse` from `@canmi/seam-server`
- Exports a single `seam()` function returning a Hono `MiddlewareHandler`
- Requests not matching `/_seam/` prefix pass through to `next()`
- Converts Hono's `c.req.raw` (Web Request) into the seam handler input shape

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Sole source file; exports `seam()` middleware and `SeamHonoOptions` |

## Conventions

- `hono` and `@canmi/seam-server` are peer dependencies; do not bundle them
- Build: `tsdown` (outputs to `dist/`)
- Single entry point: `dist/index.js` + `dist/index.d.ts`

## Testing

```sh
bun run --filter '@canmi/seam-adapter-hono' test
```

- Uses vitest (`vitest run`)
- No tests exist yet; test files go in `__tests__/*.test.ts`

## Gotchas

- The `SEAM_PREFIX` (`/_seam/`) is hardcoded; all seam traffic must use this prefix
- The middleware returns a raw `Response` (via `toWebResponse`), not a Hono `c.json()` response
