# Seam Slot Protocol

Server-side HTML data injection. Backends receive an HTML template with slot markers, execute data loaders, and return fully populated HTML.

## Slot Syntax

| Type           | Syntax                                         | Behavior                              |
| -------------- | ---------------------------------------------- | ------------------------------------- |
| Text (escaped) | `<!--seam:path-->`                             | Replace with HTML-escaped value       |
| Raw HTML       | `<!--seam:path:html-->`                        | Replace with unescaped value          |
| Attribute      | `<!--seam:path:attr:name-->`                   | Inject attribute on next opening tag  |
| Conditional    | `<!--seam:if:path-->...<!--seam:endif:path-->` | Keep block if truthy, remove if falsy |
| Else branch    | `<!--seam:if:path-->...<!--seam:else-->...<!--seam:endif:path-->` | Keep then-block if truthy, else-block if falsy |
| Iteration      | `<!--seam:each:path-->...<!--seam:endeach-->`  | Repeat body for each array element    |

## Path Resolution

Dot-separated paths walk nested objects:

```
user.address.city
```

Given `{ user: { address: { city: "Tokyo" } } }`, resolves to `"Tokyo"`.

## `each` Iteration

`<!--seam:each:path-->` repeats the body for each element in the array at `path`.

Inside the body:
- `$` refers to the current array element
- `$$` refers to the outer item when `each` blocks are nested

Example:

```html
<!--seam:each:messages-->
  <li><!--seam:$.text--></li>
<!--seam:endeach-->
```

With `{ messages: [{ text: "hi" }, { text: "bye" }] }` produces:

```html
  <li>hi</li>
  <li>bye</li>
```

Nested example:

```html
<!--seam:each:groups-->
  <h2><!--seam:$.name--></h2>
  <!--seam:each:$.items-->
    <p><!--seam:$.label--> (group: <!--seam:$$.name-->)</p>
  <!--seam:endeach-->
<!--seam:endeach-->
```

## Truthiness

JS-style with one extension. Falsy values: `null`, `undefined`, `false`, `0`, `""`, **empty array `[]`**.

Everything else is truthy (including empty objects and non-empty arrays).

**Breaking change**: empty array `[]` is now falsy. This is needed so `<!--seam:if:items-->` means "has items". In standard JS, `[]` is truthy.

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

AST-based. The template is parsed into a tree of nodes:

```
TextNode(value)
SlotNode(path, mode: text|html)
AttrNode(path, attrName)
IfNode(path, thenNodes[], elseNodes[])
EachNode(path, bodyNodes[])
```

The parser tokenizes the template by scanning for `<!--seam:...-->` markers and builds the tree recursively. The renderer traverses the AST and outputs the final string in a single pass.

This replaces the previous multi-pass regex approach, enabling arbitrary nesting of `each` inside `if`, `if` inside `each`, and same-path nested `if/endif`.

## Edge Cases

| Scenario                    | Behavior                          |
| --------------------------- | --------------------------------- |
| Missing data path (text/raw)| Empty string                      |
| Missing data path (attr)    | Skip injection                    |
| Missing data path (if)      | Remove block (use else if present)|
| Missing data path (each)    | Skip block (no iteration)         |
| Non-string values           | `String(value)` / `.to_string()`  |
| Nested `if/endif` any paths | Supported (AST handles nesting)   |
| `each` with non-array value | Skip block (no iteration)         |
| Empty array in `each`       | No output (zero iterations)       |
| Empty array in `if`         | Falsy (removed / else branch)     |
