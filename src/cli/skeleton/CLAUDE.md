# src/cli/skeleton

HTML skeleton extraction pipeline for the SeamJS CLI. Extracted from `seam-cli` as an independent library crate.

See root CLAUDE.md for general conventions.

## Architecture

Three-stage pipeline:

1. **slot** (`slot.rs`) -- replaces `%%SEAM:path%%` sentinels with `<!--seam:path-->` HTML comments; handles text, attribute, and style sentinels
2. **extract** (`extract/`) -- diffs variant HTML across axes (boolean, nullable, enum, array) to produce conditional/loop template directives; handles nested axes (e.g. `posts.$.hasAuthor` inside `posts` array)
3. **document** (`document.rs`) -- wraps skeleton fragment in minimal HTML5 document with CSS/JS asset references under `/_seam/static/`

## Additional Modules

| Module            | Responsibility                                                   |
| ----------------- | ---------------------------------------------------------------- |
| `ctr_check/`      | CTR equivalence verification (React renderToString vs injection) |
| `slot_warning.rs` | Detects open-string slots in style/class contexts                |

## Extract Sub-modules

- `tree_diff.rs` -- DOM tree diffing (LCS-based) to find changed/added/removed nodes
- `variant.rs` -- selects which variants correspond to each axis value
- `container.rs` -- unwraps container elements (e.g. `<ul>`) from array loop bodies
- `combo.rs` -- classifies axes into top-level vs nested groups
- `boolean.rs` -- if/else directive generation for boolean and nullable axes
- `enum_axis.rs` -- match/when directive generation for enum axes
- `array.rs` -- each/endeach directive generation for array axes (with nested child support)
- `dom.rs` -- lightweight HTML parser/serializer for DOM tree representation

## Testing

```sh
cargo test -p seam-skeleton
```

170 tests covering slot conversion, extraction across all axis types, document wrapping, CTR checks, and slot type warnings.
