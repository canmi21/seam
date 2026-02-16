# @canmi/seam-react

React bindings for SeamJS, providing hooks and components to consume server-injected data and real-time subscriptions.

## Key Exports

| Export                | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `defineRoutes`        | Define client-side route configuration                        |
| `useSeamData`         | Access server-injected data from `SeamDataProvider` context   |
| `SeamDataProvider`    | Context provider for server data                              |
| `parseSeamData`       | Parse JSON from `<script id="__SEAM_DATA__">`                 |
| `buildSentinelData`   | Build sentinel data for skeleton rendering                    |
| `useSeamSubscription` | Hook for SSE subscriptions, returns `{ data, error, status }` |

## Structure

- `src/index.ts` — Public API exports
- `src/use-seam-data.ts` — Data provider and hooks
- `src/use-seam-subscription.ts` — SSE subscription hook
- `src/define-routes.ts` — Route definition utilities
- `src/sentinel.ts` — Sentinel data builder for skeleton rendering
- `scripts/` — Build-time scripts

## Development

- Build: `bun run --filter '@canmi/seam-react' build`
- Test: `bun run --filter '@canmi/seam-react' test`

## Notes

- Peer dependencies: `react` ^18 || ^19, `react-dom` ^18 || ^19
- Depends on `@canmi/seam-client` for underlying RPC and subscription logic
- `parseSeamData()` reads from a `<script>` tag injected by the server during HTML rendering
