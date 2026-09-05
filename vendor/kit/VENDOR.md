# SvelteKit, vendored

This directory holds SvelteKit's source as it was written, taken from one tag of its repository
and kept apart from the repository's own code. Nothing in `src/` or `types/` is edited here; what
this repository needs from it is reached through one package, and what it changes about it is
written in that package rather than in these files.

## What is here, and where it came from

| | |
| --- | --- |
| upstream | `https://github.com/sveltejs/kit`, `packages/kit` |
| tag | `@sveltejs/kit@2.70.2` |
| commit | `a297affcec19d6f4d2df8bac1b292d8c34486344` |
| `src/` | `packages/kit/src`, whole, including the `.spec.js` files and their fixtures |
| `types/` | `packages/kit/types`, the public declarations |
| `test/mocks/` | `packages/kit/test/mocks`, the stand-ins the specs use for Kit's virtual modules |
| `LICENSE` | the repository's, MIT |
| `*.upstream.*` | `package.json`, `tsconfig.json` and `kit.vitest.config.js` as upstream ships them, for reading |

Taken by cloning the tag into a temporary directory, dropping its `.git`, and copying the files
in. The version control here is jj, which has no submodules, and a submodule would in any case
put the code one indirection away from the checks that read it. The directory layout under `src/`
is upstream's, unchanged, so that `git diff <old tag>..<new tag> -- packages/kit/src` applies to
it as a patch.

## Why the JavaScript is kept as JavaScript

Upstream writes its source in JavaScript with JSDoc and type-checks it with `tsc`, and is not going
to change that: see Rich Harris's answer at
<https://github.com/sveltejs/svelte/issues/16647#issuecomment-3206543402> -- a build-less workflow
matters more to them than authoring in TypeScript, for as long as the two are exclusive. Porting to
TypeScript here would make every upgrade a hand merge against a moving JavaScript source, for
types the repository already reads: with `allowJs` on, TypeScript reads the JSDoc on a `.js` file
and types an import of it exactly as it would a `.ts` file. So the repository's program stays
TypeScript, imports these files as they are, and gets their types for free.

Two things make that work. The package is named `@sveltejs/kit`, as upstream names it, because
the source imports itself by that name (`@sveltejs/kit/internal`, `@sveltejs/kit/node/polyfills`)
and Node resolves a package's own name through its `exports` map; the map is upstream's, with
`./src/*` and `./types/*` added so the repository can reach the files directly. And the JSDoc says
`import('types')` for upstream's internal declarations, which the repository's `tsconfig.json`
maps to `src/types/internal.d.ts` under `paths`.

## What reads it

Only `pkgs/routes` imports from this package, and every other package imports from `routes`. That
is the workspace's rule about vendor names -- they stay at the edge -- applied here: if the
implementation were replaced, one package changes.

## What is checked

- `vitest run --config vitest.config.ts`, run from this directory, is upstream's own Node-side
  suite over the vendored files: 38 files, 559 checks at the pinned tag. The config is upstream's
  with the client project left out, and three files excluded: `src/version.spec.js`, which reads a
  script upstream keeps beside the package; `src/core/sync/write_types/index.spec.js`, which
  drives the TypeScript compiler API and was written against a major behind the one installed
  here; and `src/core/adapt/builder.spec.js`, which reads a built `.svelte-kit` upstream commits as
  a fixture. Build output is not kept in this repository whatever directory it sits in, so that
  fixture is not here, and the `.svelte-kit` directories the other specs write into theirs are
  ignored by name.
- `tsc -p vendor/kit` checks the source under upstream's own compiler options, kept in
  `tsconfig.json` here. At the pinned tag it reports 44 errors, all of them the installed
  TypeScript being a major ahead of upstream's -- `write_types` calling a compiler API that moved,
  `import()` of a module used as a type, and declarations for `rollup` and `connect` upstream has
  as dev dependencies. It is run to read, not to gate: the repository's own `tsc` does not include
  these files and is not held to them.

## What is not used

`core/adapt`, `core/postbuild` (prerendering), form actions, remote functions, the service worker
and `write_types` are here because the directory is whole, and nothing imports them. Which parts
the framework layer takes, adjusts and leaves is decided in `spec/framework.md`, not here.

## Upgrading

1. Clone the new tag into a temporary directory, as above.
2. Replace `src/`, `types/` and `test/mocks/` with the new tag's, and the `*.upstream.*` files.
3. Update the tag and commit in the table above, and the counts under **What is checked** after
   running both checks.
4. Read `git diff <old tag>..<new tag> -- packages/kit/src` for the files `pkgs/routes` and
   `spec/framework.md` name, and take the changes into the framework layer where they matter.
