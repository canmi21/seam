# Svelte's test samples, vendored

This directory holds the sample components from Svelte's own test suites, as their authors wrote
them, taken from one tag of its repository. Nothing here is edited. They are read as fixtures by
`pkgs/suite`, which compiles each one and compares the result against Svelte's own `render()`
of it; `spec/suite.md` says why that comparison exists and what it reports.

## What is here, and where it came from

| | |
| --- | --- |
| upstream | `https://github.com/sveltejs/svelte`, `packages/svelte/tests` |
| tag | `svelte@5.57.0` |
| commit | `7bc0a70fe64dbb3fa3848b741963f31d1e10a8dc` |
| `tests/server-side-rendering/samples/` | 131 sample directories |
| `tests/runtime-runes/samples/` | 1048 sample directories |
| `tests/runtime-legacy/samples/` | 1209 sample directories |
| `LICENSE` | the repository's `LICENSE.md`, MIT |

5731 files, 2.0 MB of text. `du` reports 22 MB because almost every file is under 500 bytes and
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

`mise run suite`, which is part of `verify`. It compiles all 2388 samples and reports how many are
byte-identical to Svelte's own render, how many compiled and differ, how many were refused as a gap,
how many were refused by a decision the scope line settles, how many upstream skips itself and how
many neither side answered for. At the pinned tag it reports 1839 identical and 33 more that agree
on an empty body, nothing differing, no gaps, 259 decided, 239 skipped and 18 with no answer from
either side. It takes twelve seconds. `spec/suite.md` holds the reading of those numbers and the
denominator they are against, and `spec/conformance.md` what they have to reach.

The samples are excluded from lint and format with everything else under `vendor/`, which is the
workspace's rule, and from `tsc` because the repository's `include` names `pkgs/*/src` and
`corpus` only.

## Upgrading

1. Download the new tag's tarball, as above.
2. Replace the three `samples` directories and `LICENSE` with the new tag's.
3. Update the tag, commit and directory counts in the table above.
4. Run `mise run suite` and update the counts under **What is checked**. A sample that upstream
   added is a new construct or a new shape of one; a sample that moved from refused to differing
   is a regression and the suite says so before the counts do.
