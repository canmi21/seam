# @canmi/seam-vite

Vite plugin suite for SeamJS. Provides build configuration, virtual module resolution, per-page code splitting, RPC obfuscation, and dev reload — all composed into a single `seam()` call.

## Usage

```ts
// vite.config.ts
import { seam } from '@canmi/seam-vite'

export default defineConfig({
	plugins: [react(), ...seam()],
})
```

## Exports

| Export                 | Signature                                              | Purpose                                             |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `seam`                 | `(options?: SeamOptions) => Plugin[]`                  | Composite plugin (recommended). Options: `{ devOutDir?: string }` |
| `seamVirtual`          | `() => Plugin`                                         | Resolves `virtual:seam/*` imports to `.seam/generated/` files |
| `seamPageSplit`        | `() => Plugin`                                         | Per-page code splitting (static to dynamic imports) |
| `parseComponentImports`| `(source: string) => Map<string, string>`              | Parse import statements (internal utility)          |

## Composed Sub-Plugins

`seam()` returns an array containing these internal plugins (not exported individually):

- **seamConfigPlugin** -- auto-sets Vite build config from `SEAM_*` env vars (`SEAM_DIST_DIR`, `SEAM_ENTRY`, `SEAM_OBFUSCATE`, `SEAM_SOURCEMAP`, `SEAM_HASH_LENGTH`, `SEAM_TYPE_HINT`)
- **seamRpcPlugin** -- RPC procedure name to hash transform for obfuscation (reads `SEAM_RPC_MAP_PATH`)
- **seamReloadPlugin** -- dev-only HMR full-reload on `.seam/dev-output` changes (imports `watchReloadTrigger` from `@canmi/seam-server`)

## Virtual Modules

Resolved by `seamVirtual()` (also included in `seam()`):

| Module               | Resolves to                    | Fallback                            |
| -------------------- | ------------------------------ | ----------------------------------- |
| `virtual:seam/client`| `.seam/generated/client.ts`    | `export const DATA_ID = "__data"`   |
| `virtual:seam/routes`| `.seam/generated/routes.ts`    | `export default []`                 |
| `virtual:seam/meta`  | `.seam/generated/meta.ts`      | `export const DATA_ID = "__data"`   |
| `virtual:seam/hooks` | `.seam/generated/hooks.ts`     | (empty)                             |

Seam packages (`@canmi/seam-react`, `@canmi/seam-tanstack-router`, `@canmi/seam-client`) are automatically excluded from Vite's esbuild pre-bundling.

## Per-Page Splitting

When `seam build` runs, the `seamPageSplit` plugin:

1. Reads `SEAM_ROUTES_FILE` (set by the CLI) to identify page components from the routes definition
2. Adds each page component as a separate Rollup entry point
3. Transforms static page imports into dynamic `() => import(...)` loaders with `__seamLazy` flag
4. Sets `base: "/_seam/static/"` so runtime chunk resolution matches the SeamJS static serving path

The result: Vite produces per-page chunks instead of one monolithic bundle. The SeamJS build pipeline then maps each route to its specific chunks via `route-manifest.json`, and the engine injects the correct `<script>`, `<link>`, and `<link rel="prefetch">` tags at render time.

Splitting activates only when 2 or more page components are referenced in routes.

## Requirements

- Vite 5 or later
- `seam build` must set the `SEAM_ROUTES_FILE` environment variable for page splitting (automatic when using the CLI)

## Development

- Build: `just build-ts`
- Part of the [SeamJS CLI toolchain](../../../docs/architecture/logic-layer.md#cli)
