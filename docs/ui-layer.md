# UI Layer

SeamJS extracts HTML skeletons from UI components at build time via `renderToString`. Any framework that can produce an HTML string from a component tree can generate a SeamJS skeleton. The UI framework runs only in the browser — the server never imports or executes UI code.

## Implemented

<table>
<tr>
  <th></th><th>React</th><th>Vue</th><th>Solid</th>
</tr>
<tr>
  <td>Core</td>
  <td colspan="3"><a href="../packages/client/vanilla/"><code>@canmi/seam-client</code></a></td>
</tr>
<tr>
  <td>Bindings</td>
  <td><a href="../packages/client/react/"><code>@canmi/seam-react</code></a></td>
  <td>—</td><td>—</td>
</tr>
<tr>
  <td>Router</td>
  <td><a href="../packages/client/tanstack-router/"><code>@canmi/seam-tanstack-router</code></a></td>
  <td>—</td><td>—</td>
</tr>
<tr>
  <td>i18n</td>
  <td colspan="3"><a href="../packages/i18n/"><code>@canmi/seam-i18n</code></a></td>
</tr>
<tr>
  <td>Linter</td>
  <td><a href="../packages/eslint/"><code>@canmi/eslint-plugin-seam</code></a></td>
  <td>—</td><td>—</td>
</tr>
</table>

## Planned

- Vue bindings
- Svelte bindings
- Solid bindings
- HTMX support
- Shell Router — page-level micro-frontend navigation with per-page UI framework switching

## How It Works

At build time, SeamJS renders each page component to static HTML using `renderToString`. During this process, **sentinel values** (typed placeholders) in the component tree are detected and converted into **slot markers** (`<!--seam:path-->`). The result is a skeleton template: structurally complete HTML with named injection points where server data will be inserted at request time.

The client runtime reads injected data from `__SEAM_DATA__`, hydrates the skeleton, and replaces slot markers with live components. The server never imports React, Vue, or any UI library — it only performs string replacement on the skeleton.

- [Sentinel Protocol](sentinel-protocol.md) — build-time placeholder format
- [Slot Protocol](slot-protocol.md) — server-side HTML injection syntax
- [Skeleton Constraints](skeleton-constraints.md) — rules for build-safe components
