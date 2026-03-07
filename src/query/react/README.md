# @canmi/seam-query-react

React hooks wrapping `@canmi/seam-query` core. Provides `SeamQueryProvider` for SSR hydration and typed hooks for queries, mutations, and data fetching.

## Structure

- `src/index.ts` — Public API exports and re-exports from `@canmi/seam-query`
- `src/provider.tsx` — `SeamQueryProvider` and `useSeamQueryContext`
- `src/use-seam-query.ts` — `useSeamQuery` hook
- `src/use-seam-mutation.ts` — `useSeamMutation` hook
- `src/use-seam-fetch.ts` — `useSeamFetch` and `useFetch` hooks

## Key Exports

| Export                   | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `SeamQueryProvider`      | Context provider: wraps QueryClient, hydrates from `__loaders` |
| `useSeamQueryContext`    | Access `{ rpcFn, config }` from provider context               |
| `useSeamQuery`           | Query hook bound to a Seam procedure                           |
| `useSeamMutation`        | Mutation hook with automatic query invalidation                |
| `useSeamFetch` / `useFetch` | Data fetching hooks                                        |

### Types

| Type                     | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `SeamQueryProviderProps`  | Provider props: `rpcFn`, `config?`, `queryClient?`, `dataId?`, `children` |
| `SeamQueryContextValue`  | Context value: `{ rpcFn, config }`               |
| `UseSeamFetchResult`     | Return type of `useSeamFetch`                    |

## Typed Hooks via Codegen

When `@canmi/seam-query-react` is detected in project dependencies, `seam build` generates `.seam/generated/hooks.ts` with fully typed wrappers. These wrappers are bound to `SeamProcedureMeta` via TypeScript instantiation expressions, so each hook call is type-safe with zero manual generics.

The generated hooks are accessible via the `virtual:seam/hooks` import:

```ts
import { useSeamQuery, useSeamMutation } from 'virtual:seam/hooks'

const { data } = useSeamQuery('listRepos', { org: 'acme' })
//      ^? Repo[]  — fully typed from procedure output schema
```

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Peer dependencies: `react` ^18 || ^19
- Depends on `@tanstack/react-query` ^5.80.0 and `@canmi/seam-query`
