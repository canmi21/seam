# @canmi/seam

Lightweight config package — exports `defineConfig` helper and `SeamConfig` types for `seam.config.ts`.

## Structure

- `config.mjs` — `defineConfig` with runtime validation (routes/pagesDir exclusion, hashLength range 4-64, i18n.locales non-empty, renderer must be `'react'`, removed `bundlerCommand` detection)
- `config.d.ts` — `SeamConfig` and all section interfaces; includes `SeamConfig.output` field (`'static' | 'server' | 'hybrid'`, default `'hybrid'`)

## Key Points

- Peer dependency on `vite` (for `ViteUserConfig` type in the `vite` config field)
- Extracted from `@canmi/seam-cli/config` so projects can depend on config types without pulling in the full CLI toolchain
- Published in npm layer 1 (before `@canmi/seam-cli` which depends on it)
- No build step — ships raw `.mjs` and `.d.ts`
