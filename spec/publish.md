# Publishing

What goes to npm, under which names, and in what shape. [naming.md](naming.md) keeps the product
name out of the code and leaves a published name to distribution; this is that distribution.

## One name a user types

**`seamjs` is the package a user installs, and the only one.** `import { seam } from 'seamjs'`,
beside `sveltekit()` in the project's Vite config, is the whole of what a project writes. Every
other package is published under the `@seam-js` scope and arrives as a dependency of it; nobody
types a scope.

`@seamjs` belongs to somebody else, and that is the reason the scope is never what a user types
rather than only the reason it is spelled with a hyphen. `svelte` has `@sveltejs/*` and `astro` has
`@astrojs/*`, so a reader who knows the pattern and sees `seamjs` writes `@seamjs/...`, and lands
on whatever its owner published. A scope that is only ever a dependency is never written by hand.

### Until `seamjs` is ours, it is `@canmi/seamjs`

**npm refuses `seamjs`**: "Package name too similar to existing package seam.js". Its similarity
check ignores punctuation, so `seam-js` and `seam_js` are refused for the same reason. `seam.js` is
the JavaScript half of `notduncansmith/seam`, archived on GitHub and untouched on npm since 2022;
its maintainer is being asked to unpublish or transfer it.

**Meanwhile the entry is published under the author's own scope**, and a project writes
`import { seam } from '@canmi/seamjs'`. This is provisional, and the reasoning above is why: a
scope a user types is the thing this arrangement avoids, and a personal scope is the one npm
offered rather than one chosen. When `seamjs` can be published, the entry moves there and
`@canmi/seamjs` is deprecated in its favor.

**The entry is `pkgs/plugin` under another name, not a package that re-exports it.** SvelteKit keeps
its Vite plugin inside its main package, as `@sveltejs/kit/vite`, and a package that only forwards
another would be a layer that does nothing. The directory keeps its neutral name; the published
name is the one place the product is named.

| directory       | published as        |
| --------------- | ------------------- |
| `pkgs/plugin`   | `@canmi/seamjs`, until `seamjs` |
| `pkgs/compiler` | `@seam-js/compiler` |
| `pkgs/skeleton` | `@seam-js/skeleton` |
| `pkgs/ast`      | `@seam-js/ast`      |
| `pkgs/carry`    | `@seam-js/carry`    |
| `pkgs/derive`   | `@seam-js/derive`   |
| `pkgs/injector` | `@seam-js/injector` |
| `pkgs/lowering` | `@seam-js/lowering` |
| `pkgs/routes`   | `@seam-js/routes`   |

`pkgs/apps` and `pkgs/suite` are this repository's checks and stay private. So does
`pkgs/normalize`, which nothing imports.

**The order is the dependency order, and every release runs.** The scope first, then the entry, then
`create-seamjs`. npm's terms forbid publishing a name "simply for the purposes of reserving it",
judged by whether the package has a genuine function, so nothing goes up as a placeholder: a
release is code that does what it says. `create-seamjs` waits for the entry because a project it
generated could not install otherwise.

## The layout is Kit's, compiled

SvelteKit publishes its source as it is written: JavaScript, `src/` whole minus its specs, an
`exports` map naming each entry, one generated declaration file. That arrangement is taken, with
one step added, because **Node does not strip types from a file under `node_modules`**. It refuses
with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, so the `.ts` this repository runs directly
cannot be what a project runs.

**tsdown compiles each package's `src/` into `dist/`, one output file per source file.** Not a
bundle: the code hands its own files to other programs by path -- `apart` is spawned as a process,
the `$app/*` stand-ins and `caught` are given to Vite as modules, `app-state` to the render -- and
each of those has to exist as a file of its own. Tests and the `cases` fixtures are left out.

**`exports` points at `src/`, and `publishConfig.exports` at `dist/`.** The workspace keeps running
the source as it does today, and pnpm swaps the field when it packs. `workspace:*` is rewritten to
the version at the same moment.

**`lowering.wasm` sits at the package root**, which is where `../lowering.wasm` lands from `src/`
and from `dist/` alike. It is built, not committed, so packing runs `wasm` first.

### A file names its siblings by its own extension

A path to a file beside this one is written with the extension this module has, read off
`import.meta.url`: `./apart.ts` in the workspace and `./apart.js` once compiled. A literal `.ts`
would name a file the package does not contain, and a bundler does not rewrite a string it only
sees as a string.

### Packing is a task; publishing is by hand

`mise run pack` builds `wasm`, compiles every package with tsdown and writes one tarball per
package into `.build-pack/`, with `workspace:*` already rewritten. Nothing publishes: the tarballs
go up with `npm publish <file>`, run by hand, dependencies before what depends on them -- `ast`,
`injector`, `derive`, `lowering`, `routes`, `skeleton`, `carry`, `compiler`, then the entry.

**A tarball is checked where a user would meet it**: installed into a fresh Kit 3 project outside
this workspace, once with npm's hoisted layout and once with pnpm's isolated one, and built with
`seam()` beside `sveltekit()`. The workspace cannot answer that question, because `vendor/kit`
exports what npm's Kit does not and Node runs this repository's `.ts` where it would refuse the
same file under `node_modules`.

## Kit's internals are read from the project's Kit

**npm's `@sveltejs/kit` exports no `./src/*`.** `vendor/kit` adds it so the repository can reach
the files, which makes an import of `@sveltejs/kit/src/...` work here and nowhere else. So nothing
reaches Kit's source by that specifier at runtime. The file is found from the `package.json` Kit
does export, and loaded by path:

- where Node loads it, `routes` resolves Kit's `package.json` and imports the file by URL;
- where Vite bundles it into a carried bundle, the build aliases `@sveltejs/kit/src/` to the same
  directory.

That is the project's own Kit rather than a copy, which `$app/state` requires outright: its server
module reads `page` out of the context Kit's renderer set, and a second instance of it reads
nothing.

## What a project brings

**Provisional, and to be argued again.** The two framework pins below are the first answer, taken
to publish at all; neither is settled.

| peer            | range   | why                                                                 |
| --------------- | ------- | ------------------------------------------------------------------- |
| `svelte`        | `*`     | the project's Svelte is the one compiled against; provisional      |
| `@sveltejs/kit` | `3.0.0` | the internals above have no semver promise; provisional            |
| `vite`          | `^8.0.0` | the plugin is Vite's, and Kit 3 is on 8                           |

Svelte is a peer rather than a dependency for a reason that is not provisional: the bytes the
compiler writes have to be the bytes the project's Svelte hydrates against, and two copies of Svelte
is two answers to what those are.

`rolldown`, which `carry` bundles with, is a dependency at `~1.2.7`: the minor held, the patch free.

`engines.node` is Kit's, `>=22.17`.

## Where a compile writes

A compile under the plugin stages its rendered copies under `<outDir>/seam/staged`, beside the
artifacts and inside what Kit already owns, and never into `node_modules`. The default host's
staging directory inside `pkgs/skeleton` is the repository's checks', which run without Kit.
