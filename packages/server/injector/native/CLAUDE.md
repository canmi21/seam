# @canmi/seam-injector-native

HTML template injector that replaces `<!--seam:...-->` markers with data-driven content.

## Architecture

- Pipeline: `tokenize` (string -> tokens) -> `parse` (tokens -> AST) -> `render` (AST + data -> HTML) -> `injectAttributes` (phase B)
- Template directives use HTML comment markers: `<!--seam:path-->`, `<!--seam:path:html-->`, `<!--seam:path:attr:name-->`
- Control flow: `if`/`else`/`endif`, `each`/`endeach`, `match`/`when`/`endmatch`
- After rendering, a `<script id="__SEAM_DATA__">` block is injected before `</body>` (unless `skipDataScript` option is set)

## Key Files

| File              | Purpose                                                 |
| ----------------- | ------------------------------------------------------- |
| `src/injector.ts` | Tokenizer, parser, renderer, and `inject()` entry point |
| `src/resolve.ts`  | Dot-path resolver (`"a.b.c"` -> nested value lookup)    |
| `src/escape.ts`   | HTML entity escaping (`&`, `<`, `>`, `"`, `'`)          |
| `src/index.ts`    | Public exports: `inject`, `escapeHtml`, `InjectOptions` |

## Testing

```sh
bun run --filter '@canmi/seam-injector-native' test
```

- Tests in `__tests__/`: `injector.test.ts`, `escape.test.ts`, `resolve.test.ts`

## Gotchas

- `<!--seam:path-->` escapes HTML by default; use `<!--seam:path:html-->` for raw HTML injection
- `each` loops rebind `$` to the current item and `$$` to the parent scope
- Attribute injection (`<!--seam:path:attr:name-->`) uses null-byte markers placed before the target element; the marker must appear immediately before the opening `<` tag
- Unclosed `<!--seam:` markers are treated as plain text (no error thrown)

See root CLAUDE.md for project-wide conventions.
