# @canmi/seam-server

Framework-agnostic server core that defines procedures, subscriptions, pages, and the HTTP protocol layer used by all adapters.

## Structure

- `src/index.ts` — Public API barrel export
- `src/http.ts` — `createHttpHandler`, SSE helpers, `serialize`, `toWebResponse`
- `src/proxy.ts` — `createDevProxy`, `createStaticHandler` for dev and static file serving
- `src/procedure.ts` — Internal procedure types
- `src/types/` — JTD schema type system (`t.string()`, `t.object()`, etc.)
- `src/router/` — `createRouter` wiring procedures, subscriptions, and pages together
- `src/page/` — `definePage()`, loader functions, route matching
- `src/manifest/` — `buildManifest` generates manifest from definitions
- `src/validation/` — JTD input validation

## Key Exports

| Export              | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `createRouter`      | Wire procedures, subscriptions, and pages into a router               |
| `createHttpHandler` | Create HTTP request handler from a router                             |
| `definePage`        | Define a page with loaders and route patterns                         |
| `t`                 | JTD schema builder (`t.string()`, `t.object()`, etc.)                 |
| `toWebResponse`     | Convert internal response to Web `Response`                           |
| `serialize`         | Serialize response body to JSON                                       |
| `loadBuildOutput`   | Load pre-built skeleton templates and per-page assets                 |
| `PageAssets`        | Per-page CSS/JS/preload/prefetch references (type)                    |
| `createSeamRouter`  | Router-bound typed procedure factories with context + state inference |

## Development

- Build: `just build-ts`
- Test: `just test-ts`

## Notes

- Adapters depend on this package; it has no framework-specific code
- SSE subscriptions use `text/event-stream` with JSON-encoded data fields
- JTD validation runs at the protocol boundary before procedure handlers execute
- App state: `createRouter({ ..., state })` injects shared state (DB pools, services) into all procedure handlers as the `state` parameter
- Public file serving: `HttpHandlerOptions.publicDir` enables serving files from `public/` directory; `loadBuild()` auto-detects `{distDir}/public-root/`; `Cache-Control: public, max-age=3600`; path traversal protected
- Page handler executes derive functions from route-manifest after loader projection, merging results as `__derived` in page data
