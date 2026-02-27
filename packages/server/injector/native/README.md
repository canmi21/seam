# @canmi/seam-injector-native

> **Deprecated.** The maintained injector is the Rust implementation at
> `packages/server/injector/rust/`. TS and Go backends consume it via the
> WASM package `@canmi/seam-injector` (`packages/server/injector/js/`).

HTML template injector that replaces `<!--seam:...-->` comment markers with data-driven content.

## Pipeline

`tokenize` → `parse` → `render` → `injectAttributes`

## Structure

- `src/injector.ts` — Tokenizer, parser, renderer, and `inject()` entry point
- `src/resolve.ts` — Dot-path data resolver
- `src/escape.ts` — HTML entity escaping

## Development

- Build: `pnpm --filter '@canmi/seam-injector-native' build`
- Test: `pnpm --filter '@canmi/seam-injector-native' test`

## Notes

- Mirrors the Rust injector in `seam-server` but runs in Node.js/Bun
- Consumed by `@canmi/seam-server` as a dependency
