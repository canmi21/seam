# @canmi/seam-i18n

Client-side i18n runtime for SeamJS: message lookup with interpolation, locale switching (reload or SPA mode), and browser storage helpers.

## Structure

- `src/index.ts` — `createI18n`, `switchLocale`, `cleanLocaleQuery`, `sortMessages`
- `src/react.ts` — React bindings: `I18nProvider`, `useT`, `useLocale`, `useSwitchLocale`
- `src/storage.ts` — Cookie and localStorage helpers for locale persistence
- `src/hash.ts` — FNV-1a route hashing (matches Rust build-time implementation)
- `src/cache.ts` — `I18nCache` for localStorage-backed message caching

## Subpath Exports

| Subpath                    | Purpose                                  |
| -------------------------- | ---------------------------------------- |
| `@canmi/seam-i18n`         | Core: `createI18n`, `switchLocale`       |
| `@canmi/seam-i18n/react`   | React: `useT`, `useLocale`, providers    |
| `@canmi/seam-i18n/storage` | Cookie/localStorage locale helpers       |
| `@canmi/seam-i18n/hash`    | `fnv1a32`, `routeHash`                   |
| `@canmi/seam-i18n/cache`   | `I18nCache` with content hash validation |

## Development

- Build: `bun run --filter '@canmi/seam-i18n' build`
- Test: `bun run --filter '@canmi/seam-i18n' test`

## Notes

- `react` is an optional peer dependency — core functions work without React
- Server pre-merges default locale messages, so `t()` falls back to key (no client-side fallback chain)
- `switchLocale` supports both full-page reload and SPA mode (RPC-based message fetching)
