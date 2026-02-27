# @canmi/seam-adapter-bun

Standalone Bun server adapter that serves a seam router via `Bun.serve()`.

## Usage

Exports `serveBun()` which starts a Bun HTTP server with seam routing, optional static file serving, and fallback handling.

## Structure

- `src/index.ts` — `serveBun()` entry point

## Development

- Build: `pnpm --filter '@canmi/seam-adapter-bun' build`
- Test: `pnpm --filter '@canmi/seam-adapter-bun' test`

## Notes

- Peer dependency: `@canmi/seam-server`
- Tests use `bun:test`, not vitest
- Options: `staticDir` for static files, `fallback` for unmatched routes
