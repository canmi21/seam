# tests/fullstack

Go integration tests for the fullstack demo (`examples/fullstack/react-hono-tanstack`), verifying page rendering, RPC, static assets, and SSE after `seam build`.

See root CLAUDE.md for general project rules.

## Prerequisites

Build output must exist before running:

```sh
cd examples/fullstack/react-hono-tanstack && seam build
```

The test checks for `.seam/output/route-manifest.json` and exits immediately if missing.

## Running

```sh
cd tests/fullstack && go test -v -count=1
```

- Starts the built server on port 3456
- Tests: manifest, RPC, page rendering (home/about/posts), static asset caching, SSE

## Gotchas

- Server runs from `.seam/output/` directory, not the source directory
- Port 3456 must be free
- Tests verify `Cache-Control: immutable` on static assets and absence of unresolved `<!--seam:` markers in rendered HTML
