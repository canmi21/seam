# @canmi/seam-client

Framework-agnostic client for calling seam procedures and subscribing to server events.

## Key Exports

| Export            | Purpose                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `createClient`    | Create a `SeamClient` instance with `call()`, `subscribe()`, `fetchManifest()` |
| `SeamClientError` | Typed error class with error codes                                             |

## Structure

- `src/index.ts` — Public API exports
- `src/client.ts` — `SeamClient` implementation (RPC calls, SSE subscriptions)
- `src/errors.ts` — `SeamClientError` typed error class

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Used directly for vanilla JS or as a dependency of `@canmi/seam-react`
- `subscribe()` returns an `EventSource`-based stream with typed data events
