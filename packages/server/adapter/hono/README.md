# @canmi/seam-adapter-hono

Hono middleware adapter that routes `/_seam/*` requests through the seam HTTP handler.

## Usage

Exports a single `seam()` function that returns a Hono `MiddlewareHandler`. Wraps `createHttpHandler` and `toWebResponse` from `@canmi/seam-server`.

## Structure

- `src/index.ts` — Middleware factory

## Development

- Build: `bun run --filter '@canmi/seam-adapter-hono' build`
- Test: `bun run --filter '@canmi/seam-adapter-hono' test`

## Notes

- Peer dependencies: `@canmi/seam-server`, `hono` ^4.0.0
- Designed for use with Hono's `app.use()` middleware registration
