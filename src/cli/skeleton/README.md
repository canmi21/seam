# seam-skeleton

HTML skeleton extraction pipeline for the SeamJS CLI. Converts React-rendered HTML variants into conditional/loop template directives for compile-time rendering. Part of the [CLI toolchain](../../../docs/architecture/logic-layer.md#cli).

## Key Exports

| Export                  | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `sentinel_to_slots`     | Convert `%%SEAM:path%%` sentinels to HTML comments     |
| `extract_template`      | Diff variant HTML to produce conditional/loop skeleton |
| `wrap_document`         | Wrap fragment in HTML5 document shell                  |
| `extract_head_metadata` | Extract CSS/JS references from HTML head               |
| `ctr_check`             | Verify CTR equivalence between React and injector      |
| `slot_warning`          | Warn about open-string slots in style contexts         |

## Development

- Build: `cargo build -p seam-skeleton`
- Test: `cargo test -p seam-skeleton`

## Notes

- Depends on [seam-injector](../../server/injector/rust/) for CTR equivalence checks
- Consumed by [seam-cli](../core/) during the build pipeline
- See [CLAUDE.md](./CLAUDE.md) for internal architecture and sub-module details
