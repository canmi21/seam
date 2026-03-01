# @canmi/seam-tanstack-router

TanStack Router integration for SeamJS client-side hydration and routing. See [UI layer architecture](../../../docs/architecture/ui-layer.md).

## Structure

- `src/hydrate.tsx` — `seamHydrate` entry point for client hydration
- `src/create-router.ts` — `createSeamRouter` with server data bridging
- `src/define-routes.ts` — `defineSeamRoutes` route configuration
- `src/link-interceptor.ts` — `setupLinkInterception` for SPA navigation
- `src/seam-data-bridge.tsx` — React bridge for server-injected `__data`
- `src/seam-outlet.tsx` — Seam-aware route outlet component
- `src/route-matcher.ts` — URL-to-route pattern matching
- `src/create-loader.ts` — Loader factory for route data fetching

## Key Exports

| Export                  | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `seamHydrate`           | Client entry: hydrate server-rendered page |
| `createSeamRouter`      | Create TanStack Router with Seam wiring    |
| `defineSeamRoutes`      | Declare route definitions                  |
| `setupLinkInterception` | Intercept `<a>` clicks for SPA nav         |

## Subpath Exports

- `@canmi/seam-tanstack-router/routes` — `defineSeamRoutes` only (tree-shakeable)

## Development

- Build: `bun run --filter '@canmi/seam-tanstack-router' build`
- Test: `bun run --filter '@canmi/seam-tanstack-router' test`

## Notes

- Peer dependencies: `@tanstack/react-router ^1.0.0`, `react ^18 || ^19`, `react-dom ^18 || ^19`
- Depends on `@canmi/seam-client`, `@canmi/seam-react`, `@canmi/seam-i18n`
