# The framework layer

[roadmap.md](roadmap.md) draws two lines, and this file is one side of the second of them, the
layer line: the protocol is derive, inject, the IR and what a component may do, and everything
that makes a page out of a project is the framework around it. This file is that framework. It is
SvelteKit with one step moved: the arrangement is Kit's, the code is Kit's wherever the code does
not render, and the render is the compiler's.

## Kit is replaced, until it offers a seam to plug into

**The direction is decided: this framework takes Kit's place in a project rather than running
beside it.** A project swaps its `@sveltejs/kit` dependency for this one, and the framework layer --
routing, `load`, the server, the client router, the Vite plugin -- is Kit's own code, forked from
`vendor/kit` into `pkgs/framework` and maintained here. The plugin is the same either way: the fork's `sveltekit()`
calls it, and a project without the fork can still put `seam()` beside Kit's own. Stage two is
measured through the fork.

Why not stay a plugin: **Kit has no public point at which the render can be replaced.** Its hooks,
its adapter API and `resolve`'s `transformPageChunk` all act after the render. So the plugin
depends on Kit's internals throughout -- the path `render.js` imports `root.svelte` by, the root's
props and `$$renderer.global`, `utils/routing.js` and `core/config` loaded by path, the generated
`env/config.js`, the `generated/dev` and `generated/build` directories, `__SVELTEKIT_DEV__`, the
names of Kit's own plugins, and `load_vite_config` resolving for `build` -- which is why
[publish.md](publish.md) pins Kit to one release. And two things are out of a plugin's reach
whatever it depends on, being Kit's runtime model: the error page Kit renders again per request when
a `load` throws, and a backend that is not Kit's Node server. A component a `load` returns was
counted a third and is not one: see **A component a `load` returns** below, which a plugin beside
Kit does as well as the fork.

**Upstream is not asked yet.** A request for a render hook is made with something to show for it:
the framework running in the author's own projects, used by others, a couple of hundred stars. It
is not made on a design alone.

**The end state is the plugin again, if Kit offers the point.** Once Kit exposes where the render
can be replaced, this becomes a plugin over the project's own Kit, the fork is dropped, and a
project uses both. If Kit declines, the fork is kept and maintained for as long as this exists;
that is the outcome planned for, not the exception.

**The error tree is what the fork has to take that a plugin could not.** Kit renders the branch
again when a `load` throws, the error page as its leaf, and that render is Kit's root's; CTR takes
it in milestone A ([roadmap.md](roadmap.md), "A: Kit's place, by an alias, with CTR where SSR
was"). A component a `load` returns was taken for another -- `load` is Kit's code running per
request -- and turned out to need only what the build can read of the `load` module and what the
dispatcher holds; see **A component a `load` returns** below.

**The fork is the entry, under the entry's name.** A project swaps by one line of its
`package.json`, `"@sveltejs/kit": "npm:@canmi/seamjs@<version>"` -- `npm:seamjs@...` once that name
is ours ([publish.md](publish.md)) -- and nothing else: every import, `$app/*`, `svelte-kit` and the
project's `vite.config` stay as written. The alias has to point at the fork itself rather than at a
package forwarding to it, since Kit's Vite plugin reaches its runtime by paths inside its own
package. So there is no `seam()` beside `sveltekit()` any more: what the plugin does goes into the
fork's own `sveltekit()`, and `@seam-js/*` are the fork's ordinary dependencies, which a project
never names. No `@seam-js/kit` is published.

**It is not published yet.** The fork tracks Kit's latest release and is used from this repository,
linked into the author's own projects, until milestone A is accepted, which is its first release
([roadmap.md](roadmap.md)). How its version relates to
Kit's is decided at its first release: under an alias npm checks every peer range against the fork's
version as if it were Kit's -- `@sveltejs/adapter-node` asks `^3.0.0-next.0` -- so a `0.0.x`
version would fail them.

**The fork is `pkgs/framework`, and `vendor/kit` stays read-only.** The vendored copy keeps the
workspace's rule ([vendor.md](../../../spec/vendor.md)): upstream's files as upstream wrote them,
at one tag, replaced whole on an upgrade. It has three jobs the fork cannot do: it is the base an
upgrade of the fork merges against, it is the Kit every response is compared with
([conformance.md](conformance.md), "Byte for byte with Kit, except where a difference is
declared"), and it holds Kit's test apps. The fork is this repository's own code, taken from it and
kept in upstream's layout, language and formatting -- JavaScript with JSDoc, left alone by the
linter and the formatter -- so that upstream's diff between two tags merges into it. Named for what
it is, the framework layer: `pkgs/kit` would have been a second `pkgs/kit` in the workspace beside
the design package's, and "Kit" is already a word read two ways.

**The fork changes Kit only by call points.** Where this framework does something Kit does not, the
fork gains a call into a package of the `@seam-js` scope, and the logic lives there: a fork whose
diff against `vendor/kit` is a list of calls is one whose upgrade conflicts only at those calls, and
whose diff is the interface Kit would have to offer for the fork to become a plugin again. Every
change is listed in `pkgs/framework/FORK.md` -- the file, the call point, the package it calls and
why -- and a change not listed there is a defect. Upgrading is: take the new tag into `vendor/kit`
as `VENDOR.md` says, merge `vendor/kit`'s diff from the old tag to the new into the fork, and run
the checks.

## What a render left unsettled is streamed after the page

The fork's first change to what Kit does, and a declared difference
([conformance.md](conformance.md), "Declared differences").

**Kit writes into a page only the queries that have settled when its render ends**, racing each
against one microtask (`collect_remote_data`, "the implicit 'still loading' heuristic"), and leaves
the rest for the client to fetch once it hydrates. So a query the page reads for `.loading` or
`.current` and never awaits costs a second request whenever it is slower than the render, and the
bytes depend on how many turns the render took: a page this framework injects in one synchronous
pass ends earlier than Svelte's render does, and lost a live query's first value Kit's kept.

**Here the rest follow the page in the same response.** Each query (`q`) and live query's first
value (`l`) the render started and Kit did not write is streamed as it settles, in a script of its
own after the page, and the client's query waits for it instead of fetching. The page is sent
first, unchanged but for one declaration in its boot script; the response stays open until the
last of them settles. The logic is `@seam-js/stream`; the fork calls it at the points
`pkgs/framework/FORK.md` lists.

- **What the page declares.** A script ahead of the boot script's own import, so that a value
  arriving before Kit's client has loaded is held rather than lost: `${global}.streamed`, a promise
  per entry by type and key, and `${global}.settle(id, fn)`, which resolves one.
- **What follows.** `<script>${global}.settle(id, (app) => node)</script>` per entry, with the
  page's nonce, `node` written by Kit's own serializer and as Kit writes a settled one: `{ v }`,
  or `{ e }` made by `handle_error_and_jsonify`. `null` hands the entry to the client to fetch, as
  Kit hands it at once: a redirect, which Kit does not write either, a value the serializer
  refuses, and one not settled within ten seconds of the page -- a live query that never yields
  would otherwise hold the response open for as long as it lasted.
- **What the client does.** `_start` puts each declared entry where Kit puts the written ones, as
  `{ streamed }` beside `{ v }` and `{ e }`. A query's first run waits for it instead of fetching, and
  comes out as a written one would: the value, or the error as a `HandledHttpError`. A live query
  connects whether or not it has a value, as Kit's does after a written one, and takes the streamed
  value only where the connection has not delivered one first.
- **Where it is off.** A page being prerendered, which is a file and not a response; and a page
  whose content security policy allows scripts by hash, since a script after the headers cannot be
  hashed into them. A form's output (`f`) and a prerendered function (`p`) are left as Kit leaves
  them.

**What it costs.** The client runtime is Kit's with these call points in it, so every chunk that
carries it is a different file under a different name from Kit's own, on every page of every app;
`mise run compare` holds those apart and every other file to Kit's ([conformance.md](conformance.md)).
And a slow query holds the response open where Kit's would have closed, which is the trade: the
client does not ask again for what the server was already computing.

## A component a `load` returns

**A universal `load` may return a component, and a page render it with `<svelte:component
this={data.X}>`** -- Kit's `basics` `load/dynamic-import-styles` returns
`(await import('./_/Thing.svelte')).default` from its `+page.js`. No name in the page's source
reaches it, so the unnamed rule ([payload.md](payload.md)) threw for it per request. What `load`
returns is decided per request, and which components it _can_ return is written in the module: the
build reads each universal `load` down the route's branch -- `+page.js`, `+layout.js` -- for the
`.svelte` files it imports by a relative specifier, statically or with `import()`, and those are
the route's loaded components (`Page.loaded`). A server `load` is not read: what it returns crosses
the wire, which no component does.

**The page holds bytes for each of them, and names the one it was handed by identity.** A `this`
the request decides that the source names no component for is written as a chain over the route's
loaded components, `(($$loaded(x) === "src/.../Thing.svelte") ? __seam_loaded_0 : x)`, each
imported into the file under a name of its own, relative to the file as an author would write it
(`loadedChosen` in the skeleton). Each test is the request's, so the build renders once per
component and joins the structures, as it does for any `?:` between components; the last link is
the value itself, and the unnamed rule's as before. `$$loaded`, one of the runtime's helpers, looks
the value up in a map from component to path that the dispatcher hands under `seam:loaded`: the
dispatcher is bundled by Kit's server build and imports each loaded component itself, so its import
is the module the `load` returned and the identity holds. The compile writes the paths to
`loaded.json` beside the artifacts for the dispatcher's generation to read.

**Joining structures renames a derivation that names another.** This was the first route to join
structures under Kit's root, whose boundaries hold values by name -- `$$caught(() => { (__d3); })`
-- and a name read inside a derivation was left as the run wrote it: it named nothing once the run's
derivations were renamed, and two runs' readers written alike were shared as one though they read
different values. A name a derivation reads is resolved to the joined name of what it names before
the derivation is shared (`joined()` in the compiler).

## What SvelteKit is, seen from here

Three layers. A `sync` step at build time reads `src/routes` into a manifest and generates code
from it: the root component that nests a page in its layouts (in Kit 2; Kit 3 renders one fixed
root over a tree, see **SvelteKit 3 is the target** below), the client manifest, the types. A
server runtime takes a request, finds the route, runs the `load` functions down the branch, and
renders the page. A client runtime hydrates and, from then on, routes, loads and renders on its
own. CTR changes one call in the second layer -- the render -- and nothing in the other two. So the
other two are taken as they are, and the second is taken around that call.

## The source is vendored, not depended on

Kit's source sits in [`vendor/kit`](../vendor/kit/VENDOR.md) at a pinned tag, as the JavaScript it
is written in, and the repository's TypeScript reads its types off the JSDoc. Nothing under
`vendor/` is edited: what this layer changes is the fork's call points and its own packages, above.
`pkgs/routes` is the one package that reads Kit's source, and it reads it by path from the
project's own Kit, which under the alias is the fork ([publish.md](publish.md), "Kit's internals
are read from the project's Kit"). How it is upgraded and what is checked is in
`VENDOR.md`; which parts are used is here.

## SvelteKit 3 is the target, and what it moves

The framework layer was built against `@sveltejs/kit@2.70.3`, and stage two of
[conformance.md](conformance.md) is measured against SvelteKit 3. Read at `3.0.0-next.29`, what
the move costs this layer, each a fact of the diff rather than a guess:

- **`core/sync/write_root.js` is gone, and the root is one runtime component.** Kit 3 renders
  `runtime/components/root.svelte` for every page: its props are `page`, `components`, `onerror`,
  `tree`, `form` and `error`, and `tree` is a `RenderNode` list -- `component`, `error`, `data`,
  `child` -- walked by a recursive snippet with a `<svelte:boundary>` at every level, whose
  `failed` snippet is the level's `+error.svelte`. The `data_0..n` props and the pyramid of
  `{@const}` are gone with the generator. `pkgs/routes` generates the per-route root in the old
  shape; it generates the new one instead, with the branch's components in place of `tree`'s
  values, since which components a route has is known at the build. The error page, which this
  layer left to Kit's render, arrives as a boundary in the same root.
- **`svelte.config.js` is not supported.** Configuration is the Vite plugin's argument, and
  `validate_config(config)` takes no `cwd`; `load_vite_config` and `extract_svelte_config` are how
  the plugin reads it. `pkgs/routes` reads the project's config the new way.
- **`create_manifest_data(config, root, fallback)`** takes positional arguments where it took an
  object. `utils/routing.js` still exports `exec`, `find_route`, `parse_route_id` and
  `resolve_route`.
- **`experimental.async` stays opt-in**: `__SVELTEKIT_SUPPORTS_ASYNC__` is `compilerOptions
.experimental.async ?? false`, and the runtime reads it only to allow an async `handleError`.
  Nothing here assumes the flag.

**The order the move is taken in**, each step measured before the next:

1. **Done.** `vendor/kit` is at the tag, and `VENDOR.md` with it. The repository's own type check
   is red at `pkgs/routes` and `pkgs/plugin` until the next step, which is the point: the twelve
   errors name what moved -- `kit` no longer a property of the validated config, `write_root`
   gone, the two signatures.
2. **Done.** `pkgs/routes` generates the root in Kit 3's shape and reads the project's config
   off the Vite plugin's argument. **The config half**: `configured()` resolves the project's
   `vite.config` with the project as root and takes `extract_svelte_config` of it, once per
   project, and a project with no Vite config gets the validator's defaults under the same root,
   which is what a sample the suite stages is; `$lib` went with Kit's, `#lib` resolves through the
   project's `package.json` `imports` as Node resolves a subpath import, and `alias` is read as
   Kit reads it. `compilerOptions` is read off the plugin's argument first, as Kit 3 hands it to
   `vite-plugin-svelte` as inline config, and off `svelte.config.js` beneath it, since
   `vite-plugin-svelte` still reads the file and it is where a sample sets `runes` and the flag;
   read off the file alone, Kit's `async` app was compiled without the flag it turns on. **The root half**: one
   root per route, Kit's recursive snippet unrolled a level per component of the branch, each
   level a `<svelte:boundary>` around `<svelte:component this={Node_l}>`, `{#if true}` and
   `{#if false}` where Kit tests `n.child`, and the level's `+error.svelte` -- Kit's
   `build_error_chain`, walked over the same indexes in `routes()` -- as the boundary's `failed`
   snippet, so a component that throws while it renders writes what Kit writes: `<!--[?`, the
   request's `transformError` of the error as JSON, the error page. Props are `page`, `form`,
   `error` and `data_0..n`, each level's `data` being the tree's cumulative merge as `render.js`
   builds it. Measured byte for byte against Kit's own `root.svelte` rendered over Kit's own
   `Props` and `RenderNode`, two and three levels, with and without an error page, with the leaf
   throwing; and compiled, since every page is now a boundary's child, which found three things
   the boundary's guard had to leave alone ([ir.md](ir.md), "Three things the guard leaves as
   written"). What stays with Kit's root is the error **tree**: a load that throws has Kit render
   the branch again with the error page as its leaf, under the route's id, and that render is
   Kit's own root's; the next step says how it gets there.
3. **Done.** `pkgs/plugin` resolves its render at the point Kit 3 renders `root.svelte`:
   `runtime/server/page/render.js` imports `../../components/root.svelte` and hands it to
   Svelte's `render(Root, { ...render_opts, props })`, and that one import -- by importer, so the
   dispatcher's own import of the same file stays Svelte's -- resolves to a Svelte server
   component of the plugin's, `($$renderer, props) => void`. The tree's levels become the
   generated root's `data_0..n`; the artifact's body goes into the renderer without the pair
   `render()` writes around a root itself, its head through a head renderer, a hydratable
   script's hash onto the policy's list, and a derivation that awaits through an async child. The
   render options reach the component through `$$renderer.global`: `csp` and `transformError`.
   An error tree -- `props.error` set, a `load` that threw -- calls Kit's own root, which is the
   decision the previous step left open: Kit renders the branch again with the error page as its
   leaf, and that render stays Kit's. Two things around the hook moved with Kit 3: it builds
   through Vite's builder, one config shared by its `ssr` and `client` environments, so the plugin
   acts in the `ssr` environment and no other; and `configured()`'s own resolution of the project's
   Vite config runs this plugin's `configResolved` again, which asked `configured()` back and
   waited on the promise it was awaited from -- the resolution now carries a plugin named
   `READING`, and the hook returns on seeing it. The compile-time render's loader defines
   `__SVELTEKIT_DEV__` false, since Kit 3's plugin reads `dev` off the Vite command and the
   loader's is `serve`. Measured: the plugin's sample project, built with and without the plugin,
   answers seven URLs byte for byte, the error page and `__data.json` included.
4. **Begun.** Kit 3's own test apps, `server.test.js` of `basics` first, then the synchronous
   ones, then the three that turn the flag on, each held to a list the way the sample suite is; see
   [conformance.md](conformance.md), "Stage 2", which has how they are run and where it stands.
   That is stage two, and the first two of milestone A's checks. Compiling every route of `basics` --
   over four hundred, written to exercise everything Kit has -- found what the compiler and the
   plugin owed, and each is a rule now:
   - **A level whose node has no component renders as nothing.** A `+page.js` with no
     `+page.svelte` beside it is a page to Kit, whose root writes `<!--[!--><!--]-->` where its
     `Component` is undefined; the generated root writes `this={null}` there.
   - **A page Kit does not render on the server has no root to compile.** Kit's own static analysis
     merges `ssr` down the branch onto the leaf, and a leaf with `ssr: false` is skipped; an option
     Kit could not analyse statically reads as rendered.
   - **The routes are read through the Vite config the build was given.** Kit's `options` app is
     built with `vite build -c vite.custom.config.js`, its routes under `source/pages`; read off a
     `vite.config.*` that is not there, the project had the default routes directory, which is
     empty, and not one of its pages was compiled -- every answer was Kit's root's, and matched
     Kit's by being it. The plugin hands the config file it resolved to `@seam-js/routes`
     (`builtWith`). Milestone A's check build is what found it.
   - **A component whose module cannot be evaluated on the server stands in as one that throws.**
     It was left to the framework, on the reading that its module throws at import for every
     request; Kit's bundle reads otherwise, and **A module that cannot be evaluated on the
     server** below has what the compile does instead.
   - **What Kit's build and server decide is handed to the derivations, not bundled.**
     `$app/paths` is Kit's own server module, whose `resolve` reads the request Kit is answering;
     `@sveltejs/kit`'s root export is Kit's own too, since Kit reads what a page throws by class --
     `isRedirect`, `instanceof HttpError` -- and a copy bundled into the carried bundle is another
     class, which turned `error(404)` and every `redirect()` into a 500. And what a derivation
     throws leaves the dispatcher as the author threw it, the runtime's `DerivationFailed` taken off,
     so that Kit's redirect and status handling see the error itself;
     `$app/manifest` is written after the compile, some of it after prerendering; the dynamic
     environment is filled into two objects, `rendered_env` and `dynamic_private_env` of Kit's
     generated `env/config.js`, when the server starts. The dispatcher, bundled by Kit's server
     build where every generated module resolves, sets these on `globalThis[Symbol.for('seam.kit')]`
     as it loads, and the carried bundle's own `$app/manifest`, `$app/env/*` and `$env/*` read
     them there at a route's first request. The env modules are generated per project from the
     module the loader's server generated, static names as the literals Kit wrote and dynamic ones
     as reads. The objects rather than Kit's env modules, since those read the objects as they are
     evaluated and the dispatcher is evaluated before the server starts: Kit's own analysis of the
     nodes imports the server first, and found `PUBLIC_DYNAMIC` undefined that way.
   - **An imported asset's URL is handed the same way, one value per import.** The hashed name
     under `_app/immutable/assets`, the `assets` base and whether the file is inlined at all are
     Kit's build's to decide, and the carried bundle is a library build, which inlines every asset
     as a `data:` URL whatever the project's limit. So its bundling turns an import that yields a
     URL -- a file Vite counts as an asset, or `?url` -- into a read under `asset:<path from the
root>` and lists the path in `<outDir>/seam/assets.json`, and the dispatcher imports each
     listed file, which Kit's server build answers as it answers the component's own import. A
     worker's `?worker&url` is one of these, written under `_app/immutable/workers/`; a bare
     `?worker` yields a constructor and stays bundled, and so does an import that yields the
     file's content, `?raw` or `?inline`.
   - **A script run reads the request's `page`** through Kit's own `$app/state` server module;
     [derivation.md](derivation.md), "Where substitution cannot follow".
   - **The loader stands where the build stands.** Kit aliases `<sveltekit:generated>` to
     `generated/dev` under `serve`, which only its dev server writes, so the compile's loader
     redirects the aliased path to `generated/build`, which Kit's config hook has written by then;
     and `__SVELTEKIT_DEV__` is defined false there.
   - **A boundary inside a boundary, and a head inside one**, are the compiler's; [ir.md](ir.md),
     "A boundary that may throw is a block of its own".

**An application moved is not in this order.** It is milestone A's fourth check, `status`;
[roadmap.md](roadmap.md), and [conformance.md](conformance.md), "Stage 3".

## What is Kit's code, and what is not

**All of it is Kit's but the render.** The fork is Kit's source, so routing, the layout chain,
`load`, form actions, `+server.js`, remote functions, the data script, prerendering, the adapters,
the service worker and the client run as Kit runs them. The render is replaced at one point, and
not by an edit of the fork: `runtime/server/page/render.js` imports `../../components/root.svelte`,
and the plugin resolves that one import to a component of its own (step 3 of **SvelteKit 3 is the
target** above). What the fork changes besides is the list in `pkgs/framework/FORK.md`. The tables
this section held before the fork -- which of Kit's files would be taken as they were, which taken
around the render, which virtual modules the plugin owed and what was left out -- described a
framework assembled out of Kit's parts, and the fork made every row of them Kit's own.

### The error page

**Every error page is compiled, from the tree Kit renders it with.** Kit renders one of two kinds
of tree when a request fails, and both are known at the build:

- **A `load` that throws** at some level renders the layouts above the nearest error page declared
  above that level, then that error page as the leaf (`page/index.js`, `nearest_error_pages`), each
  level guarded as `build_error_chain` guards it. A route has one such tree per level whose
  failure an error page catches; the root layout's failure is `error.html` and no tree.
- **An error response** -- a route nothing matched, or one whose render failed outside any
  boundary -- renders the root layout and the root error page with nothing guarding either
  (`respond_with_error`).

`@seam-js/routes` walks Kit's manifest for both, as Kit's server would, and writes a generated root
for each distinct tree -- `Routes.trees`, under `.svelte-kit/seam/errors` -- which compiles as a
route does; two routes whose failures render the same components share one. The dispatcher tells
which tree it was handed by what `render.js` hands it: the route and the number of levels, which
picks one of a route's trees, and two levels whose second guards nothing, which is only the error
response's (`Routes.failing`). A component that throws while it renders was CTR's already: the
boundary of its level in the generated root writes `+error.svelte`.

### A module that cannot be evaluated on the server

**A component whose module the compile cannot evaluate stands in as one that throws what it threw,
as it renders.** The compile evaluates a module as the project's Vite loads it; Kit's build bundles
it, and a module script that only reads what a server has not got -- `document;`, which `basics`'
`no-ssr/ssr-page-config/layout/overwrite` writes -- is dropped by the bundler. So Kit imports the
module, renders it, and throws only where the markup reads the name, which the boundary Kit's root
puts at that level catches: the level's error page, status 500, inside the layouts above. Taken
before as a module that throws at import for every request, the route was left to Kit's root; it
did not answer as Kit does.

So where a route's compile meets such a module, the plugin evaluates each component of the branch
alone, and writes the route's root again with each that fails replaced by a component whose script
throws the same error -- a hole that throws ([ir.md](ir.md), "A component that throws whatever the
request is a hole that throws"). Where Kit's bundle keeps the statement instead, its import throws
before any render, Kit answers with its error response, and this artifact is never asked for.

**What it does not cover is named.** A module whose failing statement Kit's bundle drops while its
markup never reaches the name renders whole in Kit, and here as its error page. No app of Kit's
writes it; reading what Kit's bundle keeps is what would close it.

### What is still Kit's render

- **Every page under `vite dev`**, by the user's decision: the dev server answers with Kit's render
  and checks CTR behind it. [build.md](build.md), "The dev server answers with Kit's render, and CTR
  is checked behind it".
- **What the build degraded or the author declared SSR**: a component rendered by Svelte per request
  inside the program's bytes, or a route rendered by Kit's root whole. [together.md](together.md).
- **A route left to the framework**: one whose module cannot be evaluated and whose components all
  evaluate alone, so that no level could stand in. It is listed under `left` in the manifest with
  why, the build warns rather than fails, and the dispatcher hands its request to Kit's root, as it
  hands an error tree that could not be compiled. Milestone A's check build refuses both.

**The project's configuration is read as Kit reads it**: off the Vite plugin's argument, through
Kit's own validator (step 2 of **SvelteKit 3 is the target** above), with every file path resolved
against the project rather than the process, since a compile is not run from the project it
compiles. What the compiler takes from it is what Kit's plugin gives Vite: each of `alias` as a
prefix alias, and `#lib` as the project's `imports` resolve it, applied before
a specifier is resolved -- in the walk, where a component imports a component by one; in the
render, where the staged copy imports what it imports; and in the bundle of what expressions call.
The extension is completed the way Vite completes it, in its order, and once it is, the file decides
what the import is and the specifier does not: `./reads.svelte` is how a bundler is asked for
the runes module `reads.svelte.ts`, so whether an import is a component, a runes module or a
module to carry is read off the resolved path everywhere the question is asked. A module Node loads
for a render is not rewritten, because Node knows no aliases; that is the one place the render still
needs a bundler's help, and it is where the plugin form of the compiler comes in.

**`page` is a prop of the root, and `$app/state` is how a component reads it.** Kit's
`render_response` builds one `page` object per request -- `url`, `params`, `route`, `status`,
`error`, `data`, `form`, `state` -- hands it to the root as a prop and puts the same object in the
component context, where `$app/state`'s server module reads it. The compiler keeps both halves:
the generated root takes `page` as a prop, so it is a name of the payload beside `data_0` .. `data_n`,
`form` and `error`, passes `page.params` on as each level's `params` as Kit's root does, and the walk binds a component's `import { page } from '$app/state'` to that
prop whichever level imports it, so `page.url.pathname` in a component is the path `page.url.pathname`
in the IR and a `$derived` over it is a derivation over the payload. Nothing is carried from the
module: `navigating` and `updated` are written out as what a server holds, and the compiler's own
stand-in for the module is what a render is pointed at where an import survives. The one shape
refused is the entry importing `page` under another name, since a rename is bound at a call and the
entry has none. A backend fills `page` the way Kit does, from the request and the route it matched.

**The load stage is Kit's `load`, and outside the protocol.** [derivation.md](derivation.md) puts
where data comes from outside the protocol; here that is `+page.server.js` and `+layout.server.js`
running per request in the Node server, per node down the branch, exactly as Kit runs them. A
universal `load` runs in the browser as well, which is the client's business. Neither is rendered
and neither is compiled.

## How the plugin was first built

Against Kit 2.70.3 and before the fork; **SvelteKit 3 is the target** above carried each step
across, and what is left is [roadmap.md](roadmap.md)'s milestones.

1. **Done.** `pkgs/routes`: route ids, the manifest from `src/routes` through Kit's own
   `create_manifest_data` under Kit's own validator, and one generated root per route. The root
   is written under `.svelte-kit/seam/routes/<id>/+root.svelte` in the shape of Kit's own root --
   `write_root`'s pyramid under 2.70.3, `runtime/components/root.svelte` unrolled under 3, see
   "SvelteKit 3 is the target" above -- the branch's components as dynamic components, so that
   the `<!--[-->` and `<!--]-->` Kit writes around each are written here too, and only the branch
   that renders holds a component, since the other is walked by the pass that asks the render and
   would refuse a layout met without its children. Held byte for byte against Kit's root rendered
   with Kit's props. The compiler's command line finds routes when given none.
2. **Done.** The plugin, `seam()` beside `sveltekit()` in the project's Vite config. Kit's `vite
build` runs its server build first and the plugin takes part in that one only: when it starts,
   the routes are compiled and the artifacts emitted into the server output as assets, reached by
   the URLs the bundler gives them so an adapter carries them with the program; and Kit's root
   is resolved to a component that renders a page from its artifact -- the route's program called
   with the props, its body pushed into the renderer Kit's `render(Root, ...)` made (Kit 2's generated `root.js` and its
   `root.render(props)` before that; see "SvelteKit 3 is the target" above). The compile-time
   render itself loads its staged copies
   through a Vite server made from the project's own config, in production mode with HMR off, so
   what a component imports resolves as the project's build resolves it -- `$lib`, `$app/*`, a
   virtual module of the project's plugins, `svelte` by condition, one copy of it shared with the
   renderer -- and nothing is stubbed. Outside a build the render loads through Node as before,
   with `svelte` named by its server entry and every bare name rewritten to its file. Everything
   around the call is Kit's: `respond`, the
   `load` functions, `__data.json`, the data script, the head, the error page. What a derivation
   calls is bundled by the project's Vite too, one build per route with everything inlined and
   Kit's plugins kept out of it, since they would make it Kit's server build; what they provide
   under `$app/*` is given as what a derivation reads of it at request time, in `pkgs/plugin/src/app`.
   Outside a build the bundler is rolldown, which is Vite's own. Held by building one project
   twice, with and without the plugin, and asking both built servers for the same pages: the
   responses are the same bytes, document and all, the `__data.json`, the 404 and a load that
   throws included. Held on press the same way, from a copy in a temporary directory: nine
   responses, the seven routes with an article among them, a `__data.json` and a 404, identical
   but for the version name Kit hashes into its client entries at each build. A field whose domain
   the build declares, [build.md](build.md), is the plugin's `enumerate` option, by route id; press
   declares its locale that way, and what makes the declaration necessary rather than an
   optimisation is a derivation that both varies with the request and reaches into a component
   library's context, which no evaluator outside a render can run -- declared, it is a structure
   and is baked, and undeclared it fails at request time, which is the one place a refusal is not
   yet compile-time. What is left inside this step, each named rather than implied: what **What is
   still Kit's render** above lists; and the raw-value normalisation of [refusals.md](refusals.md) is
   not on this path yet, because it has to sit where the `load` results are before Kit serialises
   them, and applying it to the bytes alone would make the disagreement it exists to prevent.
3. **Done.** The client runtime is Kit's build -- the fork's, with its call points -- and hydrates
   against bytes that are Kit's. The check in a real browser is Kit's own client specs, milestone
   A's second check.

The order is the Node server's. The Rust server [build.md](build.md) is written for is milestones C
and D of [roadmap.md](roadmap.md), after B, and nothing of it starts before then.

## The comparison that counts

A comparison of a production build against Kit's dev server does not close: it compiles with `hmr`, under which
`is_standalone` in `clean_nodes` is never true and a `<!---->` follows every component a
production build leaves alone. The comparison that has to match is a production Kit build's:
`.svelte-kit/output/server` after `vite build`, its `Server` given the same request and answering
from the same `load` functions, before any adapter has touched it. The sample is built from a copy
of it in a temporary directory, never in place -- the sample is not the subject, and a build writes
into the project it builds.
