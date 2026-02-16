# @canmi/seam-adapter-bun

Standalone Bun server adapter that serves a seam router via `Bun.serve()`.

See root CLAUDE.md for general project rules.

## Architecture

- Wraps `createHttpHandler` and `toWebResponse` from `@canmi/seam-server`
- Exports a single `serveBun()` function that calls `Bun.serve()` and returns the server instance
- All requests go through the seam HTTP handler (no prefix filtering; handler routes internally)
- Supports `staticDir` for serving static assets and `fallback` for custom 404 handling

## Key Files

| File                        | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `src/index.ts`              | Sole source file; exports `serveBun()` and `ServeBunOptions`      |
| `__tests__/adapter.test.ts` | Integration tests: manifest, RPC, validation errors, static files |

## Conventions

- `@canmi/seam-server` is a peer dependency; do not bundle it
- Build: `tsdown` (outputs to `dist/`)
- Single entry point: `dist/index.js` + `dist/index.d.ts`

## Testing

```sh
bun run --filter '@canmi/seam-adapter-bun' test
```

- Uses `bun:test` (not vitest) because tests depend on `Bun.serve()`
- Tests bind to port 0 for OS-assigned ports; access via `server.port`
- `afterAll` calls `server.stop()` to clean up

## Gotchas

- Default port is 3000; always pass `port: 0` in tests to avoid conflicts
- Unlike the hono adapter, this adapter does not filter by `/_seam/` prefix; all routing is delegated to `createHttpHandler`
