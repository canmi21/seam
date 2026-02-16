# seam-server (Rust)

Rust server core: defines procedures, subscriptions, pages, and the HTML template injector. Built on axum.

See root CLAUDE.md for general project rules.

## Architecture

| Module | Responsibility |
|---|---|
| `server.rs` | `SeamServer` builder + axum route handlers (manifest, RPC, SSE, page) |
| `procedure.rs` | `ProcedureDef` / `SubscriptionDef` type aliases (`HandlerFn`, `BoxFuture`, `BoxStream`) |
| `page.rs` | `PageDef` / `LoaderDef` -- page routes with data loaders that call procedures |
| `manifest.rs` | Builds JSON manifest from registered procedures and subscriptions |
| `errors.rs` | `SeamError` enum (Validation/NotFound/Internal) implementing axum `IntoResponse` |
| `injector/` | HTML template engine: tokenize -> parse -> render pipeline |
| `lib.rs` | Re-exports, `SeamType` trait + primitive JTD schema impls |

## Injector Pipeline

`injector::inject(template, data)` runs three phases:
1. **Tokenize** (`token.rs`) -- split HTML into `Text` / `Marker` tokens at `<!--seam:...-->` boundaries
2. **Parse** (`parser.rs`) -- build AST nodes: `Slot`, `Attr`, `If`/`Else`, `Each`, `Match`/`When`
3. **Render** (`render.rs`) -- walk AST against JSON data, collect deferred attribute injections
4. Post-render: splice `AttrEntry` markers into next sibling element, append `__SEAM_DATA__` script

- Helpers in `helpers.rs`: `resolve` (dot-path lookup), `is_truthy`, `stringify`, `escape_html`
- All sub-module functions are `pub(super)`; only `inject()` in `mod.rs` is public

## Data Flow

```
User code -> SeamServer::new().procedure(...).page(...).serve()
                                |
                         into_router() builds AppState (manifest, handlers, subscriptions, pages)
                                |
         /_seam/manifest.json   /_seam/rpc/{name}   /_seam/subscribe/{name}   /_seam/page{route}
```

- Page handler: runs loaders concurrently via `JoinSet`, merges results, calls `injector::inject`
- Subscribe handler: wraps `BoxStream` into SSE events with `data`/`error`/`complete` event types

## Key Types

- `SeamType` trait -- derive with `#[derive(SeamType)]` (from `seam-macros`) for JTD schema generation
- `HandlerFn` -- `Arc<dyn Fn(Value) -> BoxFuture<Result<Value, SeamError>> + Send + Sync>`
- `SubscriptionHandlerFn` -- returns `BoxFuture<Result<BoxStream<Result<Value, SeamError>>, SeamError>>`

## Template Syntax (injector directives)

| Directive | Purpose |
|---|---|
| `<!--seam:path-->` | Text slot (HTML-escaped) |
| `<!--seam:path:html-->` | Raw HTML slot (no escaping) |
| `<!--seam:path:attr:name-->` | Inject attribute on next sibling element |
| `<!--seam:if:path-->...<!--seam:else-->...<!--seam:endif:path-->` | Conditional |
| `<!--seam:each:path-->...<!--seam:endeach-->` | Iteration (`$` = current, `$$` = parent) |
| `<!--seam:match:path--><!--seam:when:val-->...<!--seam:endmatch-->` | Pattern matching |

## Testing

```sh
cargo test -p seam-server
```

- `helpers.rs` has unit tests for `resolve`, `is_truthy`, `stringify`, `escape_html`
- `injector/mod.rs` has integration tests for all directive types via `inject_no_script` helper
- `lib.rs` tests `SeamType` JTD schema derivation for primitives, Vec, Option, HashMap, enums

## Conventions

- `#[cfg(test)] extern crate self as seam_server` in `lib.rs` -- allows derive macros to reference `seam_server::SeamType` in tests
- Injector uses null-byte sentinel markers (`\x00SEAM_ATTR_N\x00`) for deferred attribute injection
- `BTreeMap` in manifest for deterministic JSON key ordering
- Page loaders run concurrently via `JoinSet`; each loader maps route params to procedure input

## Gotchas

- The crate name is `seam-server`, not `seam` -- use `cargo test -p seam-server`
- Attribute slots inject into the **next** HTML element after the marker, not the parent
- `resolve()` does not support array indexing -- paths are dot-separated object keys only
- Unclosed `<!--seam:` markers are treated as plain text (no error)
