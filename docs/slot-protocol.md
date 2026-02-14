# Seam Slot Protocol

Server-side HTML data injection. Backends receive an HTML template with slot markers, execute data loaders, and return fully populated HTML.

## Slot Syntax

| Type           | Syntax                                         | Behavior                              |
| -------------- | ---------------------------------------------- | ------------------------------------- |
| Text (escaped) | `<!--seam:path-->`                             | Replace with HTML-escaped value       |
| Raw HTML       | `<!--seam:path:html-->`                        | Replace with unescaped value          |
| Attribute      | `<!--seam:path:attr:name-->`                   | Inject attribute on next opening tag  |
| Conditional    | `<!--seam:if:path-->...<!--seam:endif:path-->` | Keep block if truthy, remove if falsy |

## Path Resolution

Dot-separated paths walk nested objects:

```
user.address.city
```

Given `{ user: { address: { city: "Tokyo" } } }`, resolves to `"Tokyo"`.

## Truthiness

JS-style. Falsy values: `null`, `undefined`, `false`, `0`, `""`.

Everything else is truthy (including empty objects and arrays).

## Escaping

Text slots (`<!--seam:path-->`) apply HTML entity escaping:

| Character | Entity   |
| --------- | -------- |
| `&`       | `&amp;`  |
| `<`       | `&lt;`   |
| `>`       | `&gt;`   |
| `"`       | `&quot;` |
| `'`       | `&#x27;` |

Raw HTML slots (`<!--seam:path:html-->`) perform no escaping.

## `__SEAM_DATA__` Script Tag

The injector automatically appends a JSON data script before `</body>` (or at the end of the document if no `</body>` tag exists):

```html
<script id="__SEAM_DATA__" type="application/json">
  { "user": { "name": "Alice" } }
</script>
```

This enables client-side hydration without a second network request.

Can be disabled via the `skipDataScript` option.

## Processing Order

1. **Conditional blocks** -- may remove sections containing other slots
2. **Attribute injection** -- two-phase: replace marker with sentinel, then scan for next opening tag
3. **Raw HTML replacement** -- unescaped insertion
4. **Text replacement** -- HTML-escaped insertion
5. **`__SEAM_DATA__` append** -- JSON script tag before `</body>`

Order matters: conditionals run first so removed blocks do not produce stale slot replacements.

## Edge Cases

| Scenario                               | Behavior                                           |
| -------------------------------------- | -------------------------------------------------- |
| Missing data path (text/raw)           | Empty string                                       |
| Missing data path (attr)               | Skip injection                                     |
| Missing data path (if)                 | Remove block                                       |
| Non-string values                      | `String(value)` / `.to_string()`                   |
| Nested `if/endif` with different paths | Supported                                          |
| Same-path nested `if/endif`            | Forbidden (regex backreference cannot distinguish) |
