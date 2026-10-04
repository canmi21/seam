# SvelteKit, forked

This package is SvelteKit's own source, taken from [`vendor/kit`](../../vendor/kit/VENDOR.md) and
changed here, and it is the package a project installs in Kit's place:

    "@sveltejs/kit": "npm:@canmi/seamjs@<version>"

Why the framework is a fork rather than a plugin beside Kit, and when it would stop being one, is
in [spec/framework.md](../../spec/framework.md), "Kit is replaced, until it offers a seam to plug
into". This file is the fork's own record: what it was taken from, every change made to it, and how
it is upgraded.

## What it was taken from

| | |
| --- | --- |
| upstream | `vendor/kit`, which is `https://github.com/sveltejs/kit`, `packages/kit` |
| tag | `@sveltejs/kit@3.0.0`, the tag `vendor/kit` holds |
| `src/`, `types/`, `LICENSE`, `.gitignore` | `vendor/kit`'s, whole |
| `svelte-kit.js` | the published package's bin, which `vendor/kit` does not take, byte for byte |
| `package.json` | the published package's, with the changes listed below |

The layout, the language and the formatting are upstream's -- JavaScript with JSDoc, left alone by
this repository's linter and formatter -- so that upstream's diff between two tags merges here.

## Every change

**A change to Kit's code is a call point and nothing else.** Where this framework does something
Kit does not, the code here gains a call into a package of the `@seam-js` scope, and the logic
lives in that package. Each one is a row below, and a change not listed here is a defect.

| file | call point | calls | why |
| --- | --- | --- | --- |
| `src/exports/vite/index.js` | `sveltekit()` returns `seam()` after Kit's own plugins | `@seam-js/plugin` | the compile at the build, and the root that renders from what it wrote; the same plugin a project without the fork puts beside Kit's |
| `src/runtime/server/remote-functions.js` | `collect_remote_data` takes a `streamed`, and offers it every entry of the implicit pass | `@seam-js/stream` | what a render left unsettled is streamed after the page |
| `src/runtime/server/page/render.js` | makes the `streamed` it hands `collect_remote_data`, unless prerendering or under a hashed CSP; pushes its declaration into the boot script; sends its chunks beside Kit's | `@seam-js/stream` | the same |
| `src/runtime/client/client.js` | `_start` puts what the page declared as coming into `query_responses` | `@seam-js/stream/client` | the same |
| `src/runtime/client/remote-functions/query/instance.svelte.js` | a query's first run waits for a streamed value instead of fetching | `@seam-js/stream/client` | the same |
| `src/runtime/client/remote-functions/query-live/instance.svelte.js` | a live query takes a streamed first value, unless its connection delivered one | `@seam-js/stream/client` | the same |

Each is marked in the code by a comment beginning `seam:`, so that a merge shows it.

`package.json` differs from the published one in its name, `private`, version, description,
`repository`, and `keywords` without `official`; in `exports`, which has `./src/*` and `./types/*`
as `vendor/kit`'s does, so that this repository reaches the files directly; in its dependencies on
`@seam-js/plugin` and `@seam-js/stream`, which the call points call; and in one dev dependency,
`"@sveltejs/kit": "link:."`. The source imports itself by Kit's name --
`@sveltejs/kit/internal` and the rest -- which a project installing this under the alias resolves
to this package, and which inside this repository would otherwise resolve to `vendor/kit`, the
other package of that name.

## Upgrading

1. Upgrade `vendor/kit` to the new tag, as its `VENDOR.md` says, and commit that alone.
2. Merge `vendor/kit`'s diff between the old tag and the new into this package: the diff of the
   commit above, restricted to `src/` and `types/`. A conflict lands on a call point listed above,
   since nothing else here differs from upstream.
3. Take the published package's `package.json` fields and `svelte-kit.js` at the new tag, and keep
   the differences listed above.
4. Update the tag in the table above, and run the checks.
