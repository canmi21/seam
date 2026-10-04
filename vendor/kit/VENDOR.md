# SvelteKit, vendored

This directory holds SvelteKit's source as it was written, taken from one tag of its repository
and kept apart from the repository's own code. Nothing in `src/` or `types/` is edited here; what
this repository needs from it is reached through one package, and what it changes about it is
written in that package rather than in these files.

## What is here, and where it came from

| | |
| --- | --- |
| upstream | `https://github.com/sveltejs/kit`, `packages/kit` |
| tag | `@sveltejs/kit@3.0.0` |
| commit | `090496890cedbbff15d998695d48cd31e7d698b7` |
| `src/` | `packages/kit/src`, whole, including the `.spec.js` files and their fixtures |
| `types/` | `packages/kit/types`, the public declarations |
| `test/` | `packages/kit/test`, whole: the thirteen apps under `apps/`, `prerendering/`, `build-errors/`, the Playwright harness (`utils.js`, `records.js`, `setup.js`, `types/`) and `mocks/`, the stand-ins the specs use for Kit's virtual modules |
| `test-utils/` | the repository's own `test-utils`, which `test/utils.js` reaches as `../../../test-utils`; kept beside `test/` here, since that path lands outside this directory, and staged back into upstream's layout when an app is run |
| `../test-redirect-importer/` | `packages/test-redirect-importer`, a workspace package the `basics` app depends on, as a vendored package of its own |
| `LICENSE` | the repository's, MIT |
| `*.upstream.*` | `package.json`, `tsconfig.json` and `vitest.kit.config.js` as upstream ships them, for reading |
| `.gitignore` | `packages/kit/.gitignore`, the one file taken for effect rather than for reading |

Taken by cloning the tag into a temporary directory, dropping its `.git`, and copying the files
in. The version control here is jj, which has no submodules, and a submodule would in any case
put the code one indirection away from the checks that read it. The directory layout under `src/`
is upstream's, unchanged, so that `git diff <old tag>..<new tag> -- packages/kit/src` applies to
it as a patch.

**Upstream's own `.gitignore` comes with it, and here it is in force.** It sits at `packages/kit/`
there and at `vendor/kit/` here, which is the same layer, so its anchored patterns land on the
right paths without being rewritten. One line is the reason it is taken:

    !/src/core/adapt/fixtures/*/.svelte-kit

Upstream ignores `.svelte-kit` everywhere and then re-includes those three, because the adapter
specs read a built one as a fixture. Without that line here the directories are output to anything
that asks version control what they are, and `mise run clean` asks exactly that -- so a fixture
upstream committed on purpose would be swept as rubbish the next time one was copied in. The file
is upstream's and is not edited, like everything else under `src/`; it is only the one whose
purpose is to change behaviour rather than to be read beside it.

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

**The move from 2.70.3 to 3 was taken vendor first.** It removed `core/sync/write_root.js`,
dropped `svelte.config.js` for the Vite plugin's argument, took the `cwd` off `validate_config` and
changed `create_manifest_data`'s signature, and the type errors that followed named the work;
`spec/framework.md`, "SvelteKit 3 is the target, and what it moves", records each and the order the
framework layer moved in. From `3.0.0-next.29` to `3.0.0` nothing the framework layer imports
changed shape: the errors moved into `src/messages/`, `csp.js` hashes asynchronously, and the specs
gained matchers registered through `test/matchers.js`, which `vitest.config.ts` here registers too.

## What is checked

- `mise run apps -- --app=<name>` builds one of the apps under `test/apps` with this repository's
  plugin and runs Kit's own Playwright specs against it, staging the app into `pkgs/apps/.build-apps`
  in upstream's layout with this package's dependencies; `pkgs/apps` declares what upstream's
  workspace catalog gave the apps. `--plain` builds the same app as Kit alone does. This is stage
  two of `spec/conformance.md`, and the apps are how it is measured. `typescript` is pinned at
  upstream's `~6.0.3` in `package.json` here, because Kit's sync reads an app's `tsconfig.json`
  through `ts.sys`, which the repository's own TypeScript no longer has.
- `vitest run --config vitest.config.ts`, run from this directory, is upstream's own Node-side
  suite over the vendored files, and `mise run test-vendor` is how it is reached. The config is
  upstream's `kit-server-dev` project with the client one left out, and five files excluded:
  `src/version.spec.js`, which reads a script upstream keeps beside the package;
  `src/core/sync/write_types/index.spec.js` and `src/core/sync/write_tsconfig/index.spec.js`,
  which drive the TypeScript compiler API and were written against a major behind the one
  installed here, whose `ts.sys` is gone; `src/core/adapt/builder.spec.js`, which reads a built
  `.svelte-kit` upstream commits as a fixture; and `src/core/sync/sync.spec.js`, which reads
  `test/apps/basics`, one of upstream's test applications, which are stage two's to take (see
  `spec/conformance.md`). Build output is not kept in this repository whatever directory it sits
  in, so that fixture is not here, and the `.svelte-kit` directories the other specs write into
  theirs are ignored by name. The test tools are pinned as upstream's `pnpm-workspace.yaml`
  catalog pins them -- vitest 5, valibot for `routing.spec.js` -- since a spec written against
  one vitest's spy semantics fails under another's.
- `tsc -p vendor/kit` checks the source under upstream's own compiler options, kept in
  `tsconfig.json` here. What it reports is its own output; at the pinned tag the errors are the
  installed TypeScript being a major ahead of upstream's -- `write_types` and `write_tsconfig`
  calling a compiler API that moved -- and declarations for dev dependencies upstream has and this
  repository does not take, `rollup`, `connect` and the adapter types among them. It is run to
  read, not to gate: the repository's own `tsc` does not include these files and is not held to
  them.

## What is not used

`core/adapt`, `core/postbuild` (prerendering), form actions, remote functions, the service worker
and `write_types` are here because the directory is whole, and nothing imports them. Which parts
the framework layer takes, adjusts and leaves is decided in `spec/framework.md`, not here.

## Upgrading

1. Clone the new tag into a temporary directory, as above.
2. Replace `src/`, `types/`, `test/mocks/`, `.gitignore` and the `*.upstream.*` files with the new
   tag's.
3. Update the tag and commit in the table above, and the counts under **What is checked** after
   running both checks.
4. Read `git diff <old tag>..<new tag> -- packages/kit/src` for the files `pkgs/routes` and
   `spec/framework.md` name, and take the changes into the framework layer where they matter.
