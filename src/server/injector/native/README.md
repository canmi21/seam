# @canmi/seam-injector-native

HTML template injector that replaces `<!--seam:...-->` comment markers with data-driven content.

> **Deprecated.** The maintained injector is the Rust implementation at
> `src/server/injector/rust/`. TS and Go backends consume it via the
> WASM package `@canmi/seam-injector` (`src/server/injector/js/`).

## Pipeline

`tokenize` → `parse` → `render` → `injectAttributes`

## Structure

- `src/injector.ts` — Tokenizer, parser, renderer, and `inject()` entry point
- `src/resolve.ts` — Dot-path data resolver
- `src/escape.ts` — HTML entity escaping

## Development

- Build: `bun run --filter '@canmi/seam-injector-native' build`
- Test: `bun run --filter '@canmi/seam-injector-native' test`

## Notes

- Mirrors the Rust injector in `seam-server` but runs in Node.js/Bun
- Consumed by `@canmi/seam-server` as a dependency
