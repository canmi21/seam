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
- `src/types.ts` — `HydrateOptions`, `ClientLoaderFn`, `SeamRouterOptions`, `SeamRouteDef`
- `src/virtual-seam.d.ts` — Ambient type declarations for `virtual:seam/*`
- `src/seam-core-bridge.tsx` — React bridge between seam data and TanStack Router context
- `src/convert-routes.ts` — Convert `SeamRouteDef[]` to TanStack route tree
- `src/i18n.ts` — i18n locale detection and URL rewriting
- `src/bridge-helpers.ts` — `mergeLoaderData`, `applyHeadUpdate` helpers for loader/head bridging
- `src/head-manager.ts` — `updateHead`, `clearHead` for SPA head tag management (`data-seam-head` markers)
- `src/use-i18n-state.ts` — Extracted i18n state hook (refactored from `seam-i18n-bridge.tsx`)

## Key Exports

| Export                  | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `seamHydrate`           | Client entry: hydrate server-rendered page         |
| `createSeamRouter`      | Create TanStack Router with Seam wiring            |
| `defineSeamRoutes`      | Declare route definitions                          |
| `setupLinkInterception` | Intercept `<a>` clicks for SPA nav                 |
| `isLazyLoader`          | Check if a component is a lazy loader (page-split) |
| `collectLeafPaths`      | Extract leaf paths from a nested route tree        |
| `createSeamApp`         | Zero-config client entry (alias for `seamHydrate`) |
| `HydrateOptions`        | Type: options for `seamHydrate`/`createSeamApp`    |
| `ClientLoaderFn`        | Type: client-side loader function signature        |
| `SeamRouterOptions`     | Type: router creation options                      |
| `SeamRouteDef`          | Type: route definition shape                       |

## Per-Page Splitting

When the Vite plugin (`@canmi/seam-vite`) transforms page imports into dynamic `() => import(...)` loaders, the router detects these via `isLazyLoader()` and resolves them in the route's `loader` (before render). Resolved components are cached in `lazyComponentCache` for instant reuse on SPA navigation.

## Virtual Module Consumption

`seamHydrate`/`createSeamApp` auto-imports `virtual:seam/routes` and `virtual:seam/meta` when not provided manually. Requires `@canmi/seam-vite` or an equivalent virtual module resolver to be present in the Vite config.

## Subpath Exports

- `@canmi/seam-tanstack-router/routes` — `defineSeamRoutes` only (tree-shakeable)

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Peer dependencies: `@tanstack/react-router ^1.0.0`, `react ^18 || ^19`, `react-dom ^18 || ^19`
- Depends on `@canmi/seam-client`, `@canmi/seam-react`, `@canmi/seam-i18n`
