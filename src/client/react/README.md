# @canmi/seam-react

React bindings for SeamJS, providing hooks and components to consume server-injected data, real-time subscriptions, and streams.

## Key Exports

| Export                 | Purpose                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `defineRoutes`         | Define client-side route configuration                                                                      |
| `Hydrated`             | Declare a hydration boundary: render `fallback` on SSR/CTR, then swap to children after hydration           |
| `useSeamData`          | Access server-injected data: `useSeamData<T>()` (full data) or `useSeamData<T>(key)` (nested field by key)  |
| `SeamDataProvider`     | Context provider for server data                                                                            |
| `parseSeamData`        | Parse JSON from `<script id="__data">`                                                                      |
| `buildSentinelData`    | Build sentinel data for skeleton rendering                                                                  |
| `useSeamSubscription`  | Hook for SSE subscriptions, returns `{ data, error, status, retryCount }`; status includes `'reconnecting'` |
| `useSeamStream`        | Hook for stream procedures, returns `UseSeamStreamResult`                                                   |
| `useSeamNavigate`      | Navigation hook for programmatic route transitions                                                          |
| `SeamNavigateProvider` | Context provider for navigation                                                                             |
| `useSeamHandoff`       | Hook for loader handoff (server-fetched, client-consumed)                                                   |
| `SeamHandoffProvider`  | Context provider for loader handoff data                                                                    |
| `isLoaderError`        | Type guard for detecting failed loaders (`LoaderError`)                                                     |
| `LazyComponentLoader`  | Type for dynamic `() => import(...)` page loaders (per-page splitting)                                      |
| `buildHeadSlotProxy`   | Build a Proxy that generates slot markers for head metadata at skeleton render time                         |
| `headConfigToSlotHtml` | Convert a `HeadConfig` (with slot markers) to HTML string for `<head>` injection                            |

## Types

| Type                        | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `HydratedProps`             | Props for `Hydrated`: required `fallback`, `children` as `ReactNode`            |
| `RouteDef`                  | Route definition with component, loaders, and params                            |
| `LoaderDef`                 | Loader definition for a route                                                   |
| `ParamMapping`              | Parameter mapping configuration                                                 |
| `LazyComponentLoader`       | Function returning `Promise<{ default: ComponentType }>`                        |
| `LoaderError`               | Error marker for failed loaders                                                 |
| `UseSeamSubscriptionResult` | Return type of `useSeamSubscription` (`data`, `error`, `status`, `retryCount`)  |
| `SubscriptionStatus`        | `'connecting' \| 'connected' \| 'reconnecting' \| 'error' \| 'closed'`          |
| `UseSeamStreamResult`       | Return type of `useSeamStream`                                                  |
| `StreamStatus`              | Status for stream procedures                                                    |
| `HeadConfig`                | Head metadata: `title?`, `meta?`, `link?`                                       |
| `HeadFn`                    | `(data: Record<string, unknown>) => HeadConfig` — dynamic head from loader data |
| `HeadMeta`                  | `{ name?: string; property?: string; content: string }`                         |
| `HeadLink`                  | `{ rel: string; href: string; [key: string]: string }`                          |

`RouteDef.component` accepts either a `ComponentType` or a `LazyComponentLoader` (a function returning `Promise<{ default: ComponentType }>`). The lazy variant is produced by `@canmi/seam-vite` when per-page splitting is active.

`RouteDef` also supports `head?: HeadConfig | HeadFn` for per-page structured head metadata, `prerender?: boolean` for SSG opt-in, and `data?: Record<string, unknown>` for static page data.

## Structure

- `src/index.ts` — Public API exports
- `src/hydrated.tsx` — `Hydrated` boundary for post-hydration client enhancement
- `src/use-seam-data.ts` — Data provider and hooks
- `src/use-seam-subscription.ts` — SSE subscription hook with reconnection support
- `src/use-seam-stream.ts` — Stream procedure hook
- `src/use-seam-navigate.ts` — Navigation hook and provider
- `src/use-seam-handoff.ts` — Loader handoff hook and provider
- `src/define-routes.ts` — Route definition utilities
- `src/head.ts` — `buildHeadSlotProxy`, `headConfigToSlotHtml` for head metadata
- `src/types.ts` — `RouteDef`, `HeadConfig`, `HeadFn`, `HeadMeta`, `HeadLink`, and other shared types
- `src/sentinel.ts` — Sentinel data builder for skeleton rendering
- `scripts/` — Build-time scripts

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Peer dependencies: `react` ^18 || ^19, `react-dom` ^18 || ^19
- Depends on `@canmi/seam-client` for underlying RPC and subscription logic
- `parseSeamData()` reads from a `<script>` tag injected by the server during HTML rendering

## Hydration Boundary

Use `Hydrated` when a `page.tsx` needs a stable SSR/CTR shell first and an interactive subtree only after hydration:

```tsx
import { Hydrated, useSeamData } from '@canmi/seam-react'

export default function Page() {
	const data = useSeamData<PageData>()

	return (
		<Hydrated fallback={<StaticAdminWatches watches={data.watches} />}>
			<InteractiveAdminWatches initialWatches={data.watches} />
		</Hydrated>
	)
}
```

- `fallback` is required, but it may be `null` when you intentionally want an empty SSR slot.
- Prefer a real SSR-safe shell whenever possible; `fallback={null}` should be the explicit exception.
- `children` are regular React nodes and may use client-only hooks after hydration.
