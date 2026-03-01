# @canmi/seam-adapter-node

Node.js HTTP adapter that wraps the seam core router into a `node:http` server.

## Usage

Exports `serveNode()` which creates a Node.js HTTP server with seam routing and optional WebSocket proxy.

## Structure

- `src/index.ts` — `serveNode()` entry point with inline `sendResponse` (writes directly to Node streams)

## Development

- Build: `bun run --filter '@canmi/seam-adapter-node' build`
- Test: `bun run --filter '@canmi/seam-adapter-node' test`

## Notes

- Peer dependency: `@canmi/seam-server`
- Does NOT use `toWebResponse` — has its own `sendResponse` for Node.js stream compatibility
- Optional `wsProxy` option for WebSocket proxy support
