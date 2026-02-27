# @canmi/seam-adapter-node

Node.js HTTP adapter for `@canmi/seam-server` — wraps the core router into a `node:http` server.

## Architecture

- Uses `createHttpHandler` from `@canmi/seam-server` to build a handler, then bridges it to Node `IncomingMessage`/`ServerResponse`
- Unlike hono/bun adapters, this adapter does NOT use `toWebResponse` — Node `ServerResponse` is not a Web `Response`, so it has its own `sendResponse` that writes directly to the Node stream
- Optional WebSocket proxy (`wsProxy` option) forwards non-`/_seam/` upgrade requests to a dev server (e.g. Vite HMR)

## Key Files

| File                        | Role                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `src/index.ts`              | Single-file adapter: `serveNode`, `sendResponse`, `readBody` |
| `__tests__/adapter.test.ts` | Integration tests against a real HTTP server on port 0       |

## Conventions

- See root `CLAUDE.md` for general rules
- `readBody` and `sendResponse` are package-private helpers, not exported
- Only `serveNode` and `ServeNodeOptions` are public API
- `serialize` is imported from `@canmi/seam-server` for body serialization — response delivery is handled locally

## Testing

```sh
pnpm --filter '@canmi/seam-adapter-node' test
```

- Tests start a real `node:http` server on port 0 and use `fetch` to exercise RPC, manifest, and error paths

## Gotchas

- `sendResponse` handles both streaming (SSE) and non-streaming responses; streaming iterates `result.stream` and checks `res.writable` before each write
- Do NOT replace `sendResponse` with `toWebResponse` — Node `ServerResponse` requires direct `.writeHead()` / `.write()` / `.end()` calls
- The `wsProxy` upgrade handler skips `/_seam/` paths so internal WebSocket routes remain on this server
