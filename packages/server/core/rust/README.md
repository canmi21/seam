# seam-server

Rust implementation of the SeamJS server core, defining procedures, subscriptions, pages, and an HTML template injector. Built on axum.

## Structure

- `src/lib.rs` — `SeamType` trait and primitive JTD schema implementations
- `src/server.rs` — `SeamServer` builder and axum route handlers
- `src/procedure.rs` — `ProcedureDef` / `SubscriptionDef` type aliases
- `src/page.rs` — `PageDef` / `LoaderDef` types
- `src/manifest.rs` — Build JSON manifest from procedure and subscription definitions
- `src/errors.rs` — `SeamError` enum
- `src/injector/` — HTML template engine (tokenize, parse, render)

## Template Directives

| Directive | Purpose |
|-----------|---------|
| `<!--seam:path-->` | Text slot (HTML-escaped) |
| `<!--seam:path:html-->` | Raw HTML slot |
| `<!--seam:path:attr:name-->` | Inject attribute value |
| `<!--seam:if:path-->...<!--seam:endif:path-->` | Conditional block |
| `<!--seam:each:path-->...<!--seam:endeach-->` | Iteration block |
| `<!--seam:match:path-->...<!--seam:endmatch-->` | Pattern matching block |

## Development

- Build: `cargo build -p seam-server`
- Test: `cargo test -p seam-server`

## Notes

- The `SeamType` trait maps Rust types to JTD schemas; derive it with `#[derive(SeamType)]` from `seam-macros`
- The injector pipeline mirrors the TypeScript `@canmi/seam-injector` but is compiled into this crate
- SSE subscriptions use `BoxStream` for async iteration
