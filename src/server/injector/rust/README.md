# seam-injector

Rust HTML template injector implementing the [slot protocol](../../../../docs/protocol/slot-protocol.md). Parses `<!--seam:...-->` directives and fills them with JSON data.

## Structure

- `src/token.rs` — Tokenizer: splits HTML into text and seam directive tokens
- `src/parser.rs` — Parser: builds AST from token stream with diagnostics
- `src/ast.rs` — AST node types (text, slot, conditional, each, match)
- `src/render.rs` — Renderer: walks AST and interpolates data values
- `src/helpers.rs` — HTML escaping and formatting helpers
- `src/tests/` — Unit tests

## Key Exports

| Export                              | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `inject`                            | Fill template slots and append data script |
| `inject_no_script`                  | Fill template slots without data script    |
| `inject_no_script_with_diagnostics` | Same with parse diagnostic reporting       |

## Slot Directives

| Directive                                       | Purpose             |
| ----------------------------------------------- | ------------------- |
| `<!--seam:path-->`                              | Text slot (escaped) |
| `<!--seam:path:html-->`                         | Raw HTML slot       |
| `<!--seam:path:attr:name-->`                    | Attribute injection |
| `<!--seam:if:path-->...<!--seam:endif:path-->`  | Conditional block   |
| `<!--seam:each:path-->...<!--seam:endeach-->`   | Iteration block     |
| `<!--seam:match:path-->...<!--seam:endmatch-->` | Pattern matching    |

## Development

- Build: `cargo build -p seam-injector`
- Test: `cargo test -p seam-injector`

## Notes

- Two-phase rendering: Phase A walks the AST, Phase B splices deferred attributes
- Consumed by [seam-engine](../../engine/rust/) for page assembly
