# Seam Sentinel Protocol

Build-time format for detecting data-bound regions in React-rendered HTML. Sentinels are placeholder strings that React renders as text/attribute values, which the build pipeline then converts to slot markers (see `slot-protocol.md`).

## Sentinel Format

```
%%SEAM:<dotted.path>%%
```

Example: `%%SEAM:user.name%%` marks the location where `user.name` data appears.

## Generation

`buildSentinelData(mockData)` recursively replaces every leaf value with its sentinel string:

```js
buildSentinelData({ user: { name: "Alice", age: 30 } });
// => { user: { name: "%%SEAM:user.name%%", age: "%%SEAM:user.age%%" } }
```

Rules:

- Nested objects are recursed
- Arrays, nulls, and primitives become leaf sentinels
- The dotted path reflects the full nesting depth

Implemented in: `packages/client/react/src/sentinel.ts`

## Build Pipeline

```
React component + sentinel data
        |
        v  renderToString()
   Raw HTML with sentinels
        |
        v  sentinel_to_slots()
   HTML with slot markers (<!--seam:...-->)
        |
        v  detect_conditional() + apply_conditionals()
   HTML with conditional blocks
        |
        v  wrap_document()
   Full HTML template
```

### Sentinel-to-Slot Conversion

| Context   | Sentinel               | Slot                                    |
| --------- | ---------------------- | --------------------------------------- |
| Text node | `%%SEAM:path%%`        | `<!--seam:path-->`                      |
| Attribute | `attr="%%SEAM:path%%"` | `<!--seam:path:attr:attr-->` before tag |

Implemented in:

- Rust: `packages/cli/core/src/build/skeleton.rs` (`sentinel_to_slots`)
- JS (test only): `packages/client/react/__tests__/round-trip.test.ts` (`sentinelToSlots`)

### Conditional Detection

Conditional blocks are detected by diffing two renders:

1. Full render (all sentinel data)
2. Nulled render (one nullable field set to `null`)

The diff reveals which HTML fragment disappears when a field is null. That fragment gets wrapped in `<!--seam:if:field-->...<!--seam:endif:field-->`.

Known limitation: when `<` is shared between the conditional block boundary and an adjacent tag, the diff may produce an off-by-one boundary. The build pipeline uses space separators at conditional edges to avoid this.

## Dual Implementation

The sentinel-to-slot conversion exists in both Rust and JS:

- **Rust** (`skeleton.rs`): production build pipeline via `seam-cli build`
- **JS** (`round-trip.test.ts`): test verification only

Changes to the sentinel format must be synchronized across both.
