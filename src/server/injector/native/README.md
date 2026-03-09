> **DEPRECATED** — This package is frozen at v0.4.10. The WASM-based [`@canmi/seam-engine`](https://www.npmjs.com/package/@canmi/seam-engine) is the recommended replacement.

# @canmi/seam-injector-native

HTML template injector that replaces `<!--seam:...-->` comment markers with data-driven content.

> **Deprecated.** The maintained injector is the Rust implementation
> embedded in `seam-engine` (`src/server/engine/rust/`). TS and Go
> backends consume it via the WASM bridge `@canmi/seam-engine`
> (`src/server/engine/js/`).

## Pipeline

`tokenize` → `parse` → `render` → `injectAttributes`

## Structure

- `src/injector.ts` — Tokenizer, parser, renderer, and `inject()` entry point
- `src/resolve.ts` — Dot-path data resolver
- `src/escape.ts` — HTML entity escaping

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Mirrors the Rust injector in `seam-server` but runs in Node.js/Bun
- Consumed by `@canmi/seam-server` as a dependency
