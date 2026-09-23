# Svelte's test samples, vendored

This directory holds the sample components from Svelte's own test suites, as their authors wrote
them, taken from one tag of its repository. Nothing here is edited. They are read as fixtures by
`pkgs/suite`, which compiles each one and compares the result against Svelte's own `render()`
of it; `spec/suite.md` says why that comparison exists and what it reports.

## What is here, and where it came from

| | |
| --- | --- |
| upstream | `https://github.com/sveltejs/svelte`, `packages/svelte/tests` |
| tag | `svelte@5.57.1` |
| commit | `636eaaaa6f064b55072e7d192bb76dc9d8c4516e` |
| `tests/server-side-rendering/samples/` | 132 sample directories |
| `tests/runtime-runes/samples/` | 1054 sample directories |
| `tests/runtime-legacy/samples/` | 1209 sample directories |
| `LICENSE` | the repository's `LICENSE.md`, MIT |

5746 files, 2.0 MB of text. `du` reports 22 MB because almost every file is under 500 bytes and
the filesystem allocates a 4 KB block for each.

Taken by downloading the tag's tarball, and copying the three `samples` directories in whole. The
layout under `tests/` is upstream's with the `packages/svelte/` prefix dropped, the way
[`../kit`](../kit/VENDOR.md) drops `packages/kit/`, so that
`git diff <old tag>..<new tag> -- packages/svelte/tests` applies to it as a patch.

## What was not taken

**The harnesses.** `test.ts`, `helpers.js`, `suite.ts`, `html_equal.js` and the rest of
`packages/svelte/tests` are upstream's runners, and they are not used: upstream compares a
sample's output to its `_expected.html` through `assert_html_equal`, which parses both and
compares trees, so attribute order, insignificant whitespace and the exact anchors do not survive
it. The comparison here is byte for byte against `render()`. See `spec/suite.md`.

**The other suites.** `hydration`, `css`, `snapshot`, `parser-*`, `validator`, `compiler-errors`,
`migrate`, `preprocess`, `sourcemaps`, `signals`, `store`, `motion`, `runtime-browser`,
`runtime-xhtml`, `runtime-production` and `types` are about parts of Svelte this compiler does not
stand in for. `hydration` is the one worth revisiting: its samples are server bytes a client is
then hydrated against, which is a question this protocol has and has not asked yet.

**`_config.js` is taken but not run as written.** Each one is upstream's module importing from the
harness above, which is not here; `pkgs/suite` stands in for every import that leaves the sample's
own directory and reads the object off the default export. `test` becomes an identity and the rest
throw if anything calls them, which is upstream's assertion and timing helpers and is only reached
from the `test` function this harness does not run. What it reads out is `props`, and the fields
that say a sample is not ours to run: `skip`, `mode`, `skip_mode`, `error` and `runtime_error`.

The rule stood in for `import { test } from '...'` alone until it was audited, and 342 configs
name something else -- `import { ok, test }` for 276 of them. Those threw on an import nothing
resolves and the samples were counted as upstream's own skips, which is the one thing that column
must not hold. See `spec/suite.md`.

## What is checked

Upstream's samples are not themselves a condition of `verify`. What is, is
`mise run vendor-baseline`: it compiles all 2395 samples, sorts each into pass, skip or fail, and
holds every one to `pkgs/suite/baseline.json`, the list this repository keeps of which state each
has to be and why a skip is one. At the pinned tag it reports 1892 pass, 502 skip -- 242 upstream's and
260 the scope line's -- and one failing, which is owed work: see `spec/conformance.md`. It takes twelve seconds.
`spec/suite.md` holds the states and the list, and `spec/conformance.md` what they have to reach.

The samples are excluded from lint and format with everything else under `vendor/`, which is the
workspace's rule, and from `tsc` because the repository's `include` names `pkgs/*/src` and
`corpus` only.

## Upgrading

1. Download the new tag's tarball, as above.
2. Replace the three `samples` directories and `LICENSE` with the new tag's.
3. Update the tag, commit and directory counts in the table above.
4. Run `mise run vendor-baseline`. It fails on every sample upstream added, removed or changed
   the state of, since the list names each one: read each failure, fix what is work, and record
   the rest with `mise run vendor-baseline -- --write`. The diff of `pkgs/suite/baseline.json` is
   the upgrade's account of what moved, and a sample going from `pass` to `skip` in it is a
   regression unless its reason says otherwise.
5. Update the counts under **What is checked**.
