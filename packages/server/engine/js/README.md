# @canmi/seam-engine

Node.js/Bun WASM bridge for the Rust engine. All functions delegate to the [engine/wasm](../wasm/) binary compiled from [engine/rust](../rust/).

## Structure

- `src/wasm-bridge.ts` — Synchronous WASM initialization and typed wrappers
- `src/escape.ts` — `escapeHtml` (pure JS, HTML entity escaping)
- `src/index.ts` — Barrel exports
- `pkg/` — WASM artifacts (built by `build-wasm.sh`)

## Key Exports

| Export             | Source  | Purpose                                    |
| ------------------ | ------- | ------------------------------------------ |
| `renderPage`       | WASM    | Page assembly: slots + data script + meta  |
| `parseBuildOutput` | WASM    | Parse route-manifest.json into definitions |
| `parseI18nConfig`  | WASM    | Extract i18n config from manifest          |
| `parseRpcHashMap`  | WASM    | Reverse lookup from RPC hash map           |
| `asciiEscapeJson`  | WASM    | Escape non-ASCII in JSON strings           |
| `i18nQuery`        | WASM    | Look up i18n translation keys              |
| `inject`           | WASM    | Template injection with data script        |
| `injectNoScript`   | WASM    | Template injection without data script     |
| `escapeHtml`       | Pure JS | HTML entity escaping                       |

## Development

- Build WASM: `bash packages/server/engine/build-wasm.sh`
- Build JS: `bun run --filter '@canmi/seam-engine' build`
- Test: `bun run --filter '@canmi/seam-engine' test`

## Notes

- WASM imports use `eslint-disable` + `@ts-expect-error` — no `.d.ts` for wasm-bindgen output
- Rebuild `pkg/` when Rust engine source changes
