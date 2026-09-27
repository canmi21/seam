# The framework layer

[roadmap.md](roadmap.md) draws two lines, and this file is one side of the second of them, the
layer line: the protocol is derive, inject, the IR and what a component may do, and everything
that makes a page out of a project is the framework around it. This file is that framework. It is
SvelteKit with one step moved: the arrangement is Kit's, the code is Kit's wherever the code does
not render, and the render is the compiler's.

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
`vendor/` is edited; what this layer changes, it changes in its own packages, and `pkgs/routes` is
the one package that imports the vendor by name. How it is upgraded and what is checked is in
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
   Kit reads it. `svelte.config.js` is still read for `compilerOptions`, since `vite-plugin-svelte`
   still reads it there and it is where a sample sets `runes` and the flag. **The root half**: one
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
   That is stage two, and it is what this version is for. Compiling every route of `basics` --
   over four hundred, written to exercise everything Kit has -- found what the compiler and the
   plugin owed, and each is a rule now:
   - **A level whose node has no component renders as nothing.** A `+page.js` with no
     `+page.svelte` beside it is a page to Kit, whose root writes `<!--[!--><!--]-->` where its
     `Component` is undefined; the generated root writes `this={null}` there.
   - **A page Kit does not render on the server has no root to compile.** Kit's own static analysis
     merges `ssr` down the branch onto the leaf, and a leaf with `ssr: false` is skipped; an option
     Kit could not analyse statically reads as rendered.
   - **A component whose module cannot be evaluated on the server is left to the framework.** A
     module script reaching `document` throws at import, for every request, before any render, and
     Kit answers with its error response; the compile makes no artifact, lists the route under
     `left` in the manifest with why, and warns rather than fails. The dispatcher hands such a
     request to Kit's own root, as it hands an error tree. This is not the runtime fallback
     [refusals.md](refusals.md) refuses: there is no page render to fall back to.
   - **What Kit's build and server decide is handed to the derivations, not bundled.**
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
     listed file, which Kit's server build answers as it answers the component's own import. An
     import that yields the file's content, `?raw` or `?inline`, is the compile's and stays bundled.
   - **A script run reads the request's `page`** through Kit's own `$app/state` server module;
     [derivation.md](derivation.md), "Where substitution cannot follow".
   - **The loader stands where the build stands.** Kit aliases `<sveltekit:generated>` to
     `generated/dev` under `serve`, which only its dev server writes, so the compile's loader
     redirects the aliased path to `generated/build`, which Kit's config hook has written by then;
     and `__SVELTEKIT_DEV__` is defined false there.
   - **A boundary inside a boundary, and a head inside one**, are the compiler's; [ir.md](ir.md),
     "A boundary that may throw is a block of its own".

**press is not in the order.** It was the fourth step, a regression to run before stage two; it is
on Kit 2 and mid-rebuild, so it is not a measurement anybody can take, and
[conformance.md](conformance.md)'s own argument puts it after stage two in any case. It is stage
three, taken when it is on Kit 3; [roadmap.md](roadmap.md), "Where it stands".

The tables below describe the layer as built against 2.70.3 and are corrected as each step above
moves a row.

## Taken as it is

| Kit                                                                              | what it does                                                                           | here                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `utils/routing.js`                                                               | route ids to patterns and parameters, `find_route`, `resolve_route`                    | `pkgs/routes`                                                |
| `core/sync/create_manifest_data/`                                                | `src/routes` to routes, nodes, layouts and errors; `sort_routes`; conflicts            | the map from a route to its layouts                          |
| `core/sync/write_root.js` (2.70.3; `runtime/components/root.svelte` in 3)        | the root component nesting a page in its layouts, `data_0..n`, `page`, `form` as props | the compiler's entry per route, see [payload.md](payload.md) |
| `utils/url.js`, `runtime/pathname.js`                                            | path normalising, `__data.json` suffixes                                               | the wire's spelling                                          |
| `runtime/server/page/serialize_data.js`, `data_serializer.js`, `utils/escape.js` | devalue into `<script>`                                                                | byte for byte, since the client reads it                     |
| `runtime/server/data/`                                                           | the `__data.json` endpoint                                                             | client navigation's data                                     |
| `runtime/client/`                                                                | router, navigation, preload, `$app/navigation`, `$app/state`, hydrate                  | the SPA the page is after hydration                          |
| `runtime/app/*`                                                                  | the `$app/*` modules                                                                   | what components import                                       |
| `runtime/server/{cookie,csp,crypto,validate-headers}.js`                         | HTTP details of the Node server                                                        | the Node server, while there is one                          |

## Taken around the render

| Kit                                                     | keeps                                                                  | changes                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `runtime/server/page/render.js`                         | the shell, the `<script>` of data, CSP, asset tags                     | `root.render(props)` becomes `inject(ir, derive(data))`            |
| `runtime/server/page/index.js`, `load_data.js`          | the branch of `load` functions, `parent()`, per-node data              | the end of the branch picks the route's IR rather than a component |
| `runtime/server/respond.js`                             | routing a request to a page, an endpoint, `__data.json`                | the page arm                                                       |
| `core/sync/write_server.js`, `write_client_manifest.js` | the manifests                                                          | the server one points at IR and derivation bundles                 |
| `exports/vite/index.js`                                 | the plugin form, the client build, the dev server, the virtual modules | the server build is the compiler's pipeline                        |

**The project's configuration is read as Kit reads it.** `svelte.config.js` is imported and put
through Kit's own validator (in 2.70.3; Kit 3 reads it off the Vite plugin, see the section above), with every file path resolved against the project rather than the
process, since a compile is not run from the project it compiles. What the compiler takes from it
is what Kit's plugin gives Vite: `$lib` and each of `kit.alias` as prefix aliases, applied before
a specifier is resolved -- in the walk, where a component imports a component by one; in the
render, where the staged copy imports what it imports; and in the bundle of what expressions call.
The extension is completed the way Vite completes it, in its order, and once it is, the file decides
what the import is and the specifier does not: `$lib/reads.svelte` is how a bundler is asked for
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

## The virtual modules the plugin owes

Kit's source imports what its plugin provides, and this layer's plugin has to provide the same
names: `$app/environment`, `$app/navigation`, `$app/paths`, `$app/state`, `$app/stores`,
`$app/forms`, `$app/server`, `$app/env` and `$env/*`; `__sveltekit/paths`, `__sveltekit/env`,
`__sveltekit/server`; and the package's own `#app/paths` and `#app/env/public` subpath imports,
which its `package.json` carries. The specs' mocks under `vendor/kit/test/mocks` are the list of
what has to exist for the server half to load.

## Left out, for now

Form actions, remote functions, the service worker, prerendering (`core/postbuild`), adapters
(`core/adapt`), `write_types` and the `handleRenderingErrors` boundary root. Actions and remote
functions are request handling a backend does on its own; prerendering is a build-time SSR the
compiler supersedes; adapters wait for a second backend; the types generator drives a compiler API
that moved under the installed TypeScript. None is refused. Each is taken when a route needs it.

## The order of work

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
   is resolved to a component that renders a page from its artifact -- `inject(ir, derive(props))`
   pushed into the renderer Kit's `render(Root, ...)` made (Kit 2's generated `root.js` and its
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
   yet compile-time. What is left inside this step, each named rather than implied: the error page
   is still Kit's render, under the route's own id when its `load` throws, since `+error.svelte` is
   not a route the compiler is given; the raw-value normalisation of [refusals.md](refusals.md) is
   not on this path yet, because it has to sit where the `load` results are before Kit serialises
   them, and applying it to the bytes alone would make the disagreement it exists to prevent; and
   `vite dev` renders with Kit's own root, since the plugin is a no-op outside the server build.
3. The client runtime is Kit's build, untouched, and hydrates against bytes that are Kit's byte
   for byte. What is owed is the check in a real browser; see [build.md](build.md).

The order is the Node server's. A second backend -- the Rust server [build.md](build.md) is
written for -- takes the framework layer after it exists once, and nothing in it starts before
then; that is decided, not deferred by accident.

## The comparison that counts

A comparison against Kit's dev server does not close: it compiles with `hmr`, under which
`is_standalone` in `clean_nodes` is never true and a `<!---->` follows every component a
production build leaves alone. The comparison that has to match is a production Kit build's:
`.svelte-kit/output/server` after `vite build`, its `Server` given the same request and answering
from the same `load` functions, before any adapter has touched it. The sample is built from a copy
of it in a temporary directory, never in place -- the sample is not the subject, and a build writes
into the project it builds.
