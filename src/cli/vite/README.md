# @canmi/seam-vite

Vite plugin for SeamJS per-page code splitting. Automatically transforms single-entry builds into multi-entry builds with lazy page components, enabling MPA-like initial loads while preserving SPA navigation.

## Usage

```ts
// vite.config.ts
import { seamPageSplit } from '@canmi/seam-vite'

export default defineConfig({
  plugins: [react(), seamPageSplit()],
  appType: 'custom',
  build: {
    outDir: process.env.SEAM_DIST_DIR ?? '.seam/dist',
    manifest: true,
    rollupOptions: {
      input: 'src/client/main.tsx',
    },
  },
})
```

## What It Does

When `seam build` runs, the plugin:

1. Reads `SEAM_ROUTES_FILE` (set by the CLI) to identify page components from the routes definition
2. Adds each page component as a separate Rollup entry point
3. Transforms static page imports into dynamic `() => import(...)` loaders
4. Sets `base: "/_seam/static/"` so runtime chunk resolution matches the SeamJS static serving path

The result: Vite produces per-page chunks instead of one monolithic bundle. The SeamJS build pipeline then maps each route to its specific chunks via `route-manifest.json`, and the engine injects the correct `<script>`, `<link>`, and `<link rel="prefetch">` tags at render time.

## Requirements

- Vite 5 or later
- At least 2 page components referenced in routes (single-page apps skip splitting)
- `seam build` must set the `SEAM_ROUTES_FILE` environment variable (automatic when using the CLI)

## Development

- Build: `bun run --filter '@canmi/seam-vite' build`
- Part of the [SeamJS CLI toolchain](../../../docs/architecture/logic-layer.md#cli)
