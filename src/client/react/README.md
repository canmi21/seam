# @canmi/seam-react

React bindings for SeamJS, providing hooks and components to consume server-injected data and real-time subscriptions.

## Key Exports

| Export                | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `defineRoutes`        | Define client-side route configuration                                 |
| `useSeamData`         | Access server-injected data: `useSeamData<T>()` (full data) or `useSeamData<T>(key)` (nested field by key) |
| `SeamDataProvider`    | Context provider for server data                                       |
| `parseSeamData`       | Parse JSON from `<script id="__data">`                                 |
| `buildSentinelData`   | Build sentinel data for skeleton rendering                             |
| `useSeamSubscription` | Hook for SSE subscriptions, returns `{ data, error, status }`          |
| `LazyComponentLoader` | Type for dynamic `() => import(...)` page loaders (per-page splitting) |

## Types

`RouteDef.component` accepts either a `ComponentType` or a `LazyComponentLoader` (a function returning `Promise<{ default: ComponentType }>`). The lazy variant is produced by `@canmi/seam-vite` when per-page splitting is active.

## Structure

- `src/index.ts` — Public API exports
- `src/use-seam-data.ts` — Data provider and hooks
- `src/use-seam-subscription.ts` — SSE subscription hook
- `src/define-routes.ts` — Route definition utilities
- `src/sentinel.ts` — Sentinel data builder for skeleton rendering
- `scripts/` — Build-time scripts

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Peer dependencies: `react` ^18 || ^19, `react-dom` ^18 || ^19
- Depends on `@canmi/seam-client` for underlying RPC and subscription logic
- `parseSeamData()` reads from a `<script>` tag injected by the server during HTML rendering
