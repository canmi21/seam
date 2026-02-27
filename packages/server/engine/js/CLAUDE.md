# @canmi/seam-engine (JS)

Node.js/Bun WASM bridge for the Rust engine. Superset of `@canmi/seam-injector` — includes injector functions plus page assembly, i18n, and build parsing.

See root CLAUDE.md for general project rules.

## Architecture

- `src/wasm-bridge.ts` — Synchronous WASM initialization, typed wrappers for all engine + injector functions
- `src/escape.ts` — `escapeHtml` (HTML entity escaping, pure JS)
- `src/index.ts` — Barrel exports
- `pkg/` — WASM artifacts (built by `packages/server/engine/build-wasm.sh`)

## Exported Functions

| Function           | Source        | Description                                      |
| ------------------ | ------------- | ------------------------------------------------ |
| `renderPage`       | WASM engine   | Page assembly: inject slots + data script + meta |
| `parseBuildOutput` | WASM engine   | Parse route-manifest.json into page definitions  |
| `parseI18nConfig`  | WASM engine   | Extract i18n configuration from manifest         |
| `parseRpcHashMap`  | WASM engine   | Build reverse lookup from RPC hash map           |
| `asciiEscapeJson`  | WASM engine   | Escape non-ASCII in JSON strings                 |
| `i18nQuery`        | WASM engine   | Look up i18n translation keys                    |
| `inject`           | WASM injector | Template injection with `__SEAM_DATA__` script   |
| `injectNoScript`   | WASM injector | Template injection without data script           |
| `escapeHtml`       | Pure JS       | HTML entity escaping                             |

## Build

```sh
bash packages/server/engine/build-wasm.sh  # rebuild WASM
bun run --filter '@canmi/seam-engine' build  # rebuild JS
```

## Gotchas

- WASM imports use `eslint-disable` + `@ts-expect-error` — no `.d.ts` for wasm-bindgen generated code
- Build tool is `tsdown`
- `pkg/` must be rebuilt when the Rust engine source changes
