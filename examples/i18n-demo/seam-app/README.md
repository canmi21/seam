# i18n-demo-seam-app

Fullstack SeamJS app demonstrating i18n with per-locale templates, cookie-based locale switching, and SPA message loading.

## Structure

- `src/server/` — Server router with i18n resolve strategies
- `src/client/` — React frontend with `useT()` translations
- `locales/` — Per-locale message files (`en.json`, `zh.json`)
- `vite.config.ts` — Vite configuration

## Development

- Dev: `I18N_MODE=prefix seam dev`
- Build: `I18N_MODE=prefix seam build`

## Notes

- `I18N_MODE` accepts `prefix` (locale in URL path) or `hidden` (locale from cookie/query/header)
