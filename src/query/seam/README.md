# @canmi/seam-query

UI-agnostic TanStack Query integration core for SeamJS. Provides query/mutation option factories and SSR hydration utilities without depending on any UI framework.

## Structure

- `src/index.ts` — Public API exports
- `src/query-options.ts` — `createSeamQueryOptions` and `resolveStaleTime` factories
- `src/mutation-options.ts` — `createSeamMutationOptions` and `invalidateFromConfig` factories
- `src/hydrate.ts` — `hydrateFromSeamData` for SSR hydration from server-injected data
- `src/types.ts` — Shared type definitions

## Key Exports

| Export                      | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `createSeamQueryOptions`    | Build TanStack Query options from a Seam procedure           |
| `resolveStaleTime`          | Resolve stale time from procedure cache config               |
| `createSeamMutationOptions` | Build TanStack Mutation options with automatic invalidation  |
| `invalidateFromConfig`      | Invalidate related queries after a mutation based on config  |
| `hydrateFromSeamData`       | Populate QueryClient from server-injected `__loaders` data   |

### Types

| Type                 | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `ProcedureConfigEntry` | Procedure metadata: `kind`, optional `cache` (ttl), optional `invalidates` |
| `ProcedureConfigMap` | `Record<string, ProcedureConfigEntry>` — full procedure registry         |
| `SeamQueryConfig`    | Global config: `staleTime`, `gcTime`                                     |
| `ProcedureMetaBase`  | Generic procedure type map: `Record<string, { kind, input, output }>`    |
| `RpcFn`              | RPC call signature: `(procedure: string, input?) => Promise<unknown>`    |

## How Hydration Works

During SSR, the server injects a `__loaders` object into the Seam data script tag. Each entry maps a loader key to `{ procedure, input }` metadata, with the corresponding data stored alongside it:

```json
{
  "__loaders": {
    "repos": { "procedure": "listRepos", "input": { "org": "acme" } }
  },
  "repos": [{ "name": "app" }, { "name": "lib" }]
}
```

On the client, `hydrateFromSeamData(queryClient, seamData)` iterates over `__loaders` and calls `queryClient.setQueryData([procedure, input], data[key])` for each entry, pre-populating the QueryClient cache so queries resolve instantly without refetching.

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Depends on `@tanstack/query-core` ^5.80.0
- No React or any other UI framework dependency — use `@canmi/seam-query-react` for React hooks
