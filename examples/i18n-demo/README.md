# i18n Demo

Two locale resolution modes running on the same React frontend with an Axum backend. Switch between modes via the `I18N_MODE` environment variable.

| App                   | Backend     | Description                                     |
| --------------------- | ----------- | ----------------------------------------------- |
| [seam-app](seam-app/) | Axum (Rust) | Fullstack — frontend + `i18n-demo-axum` backend |

- **Prefix mode** (`I18N_MODE=prefix`): locales in URL path — `/en/`, `/zh/about`
- **Hidden mode** (`I18N_MODE=hidden`): locale from `?lang=`, cookie, or Accept-Language header
