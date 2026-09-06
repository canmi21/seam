# The framework layer

[roadmap.md](roadmap.md) draws the line: Seam is the protocol -- derive, inject, the IR and what a
component may do -- and everything that makes a page out of a project is the framework around it.
This file is that layer. It is SvelteKit with one step moved: the arrangement is Kit's, the code
is Kit's wherever the code does not render, and the render is the compiler's.

## What SvelteKit is, seen from here

Three layers. A `sync` step at build time reads `src/routes` into a manifest and generates code
from it: the root component that nests a page in its layouts, the client manifest, the types. A
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

## Taken as it is

| Kit | what it does | here |
| --- | --- | --- |
| `utils/routing.js` | route ids to patterns and parameters, `find_route`, `resolve_route` | `pkgs/routes` |
| `core/sync/create_manifest_data/` | `src/routes` to routes, nodes, layouts and errors; `sort_routes`; conflicts | the map from a route to its layouts |
| `core/sync/write_root.js` | the root component nesting a page in its layouts, `data_0..n`, `page`, `form` as props | the compiler's entry per route, see [payload.md](payload.md) |
| `utils/url.js`, `runtime/pathname.js` | path normalising, `__data.json` suffixes | the wire's spelling |
| `runtime/server/page/serialize_data.js`, `data_serializer.js`, `utils/escape.js` | devalue into `<script>` | byte for byte, since the client reads it |
| `runtime/server/data/` | the `__data.json` endpoint | client navigation's data |
| `runtime/client/` | router, navigation, preload, `$app/navigation`, `$app/state`, hydrate | the SPA the page is after hydration |
| `runtime/app/*` | the `$app/*` modules | what components import |
| `runtime/server/{cookie,csp,crypto,validate-headers}.js` | HTTP details of the Node server | the Node server, while there is one |

## Taken around the render

| Kit | keeps | changes |
| --- | --- | --- |
| `runtime/server/page/render.js` | the shell, the `<script>` of data, CSP, asset tags | `root.render(props)` becomes `inject(ir, derive(data))` |
| `runtime/server/page/index.js`, `load_data.js` | the branch of `load` functions, `parent()`, per-node data | the end of the branch picks the route's IR rather than a component |
| `runtime/server/respond.js` | routing a request to a page, an endpoint, `__data.json` | the page arm |
| `core/sync/write_server.js`, `write_client_manifest.js` | the manifests | the server one points at IR and derivation bundles |
| `exports/vite/index.js` | the plugin form, the client build, the dev server, the virtual modules | the server build is the compiler's pipeline |

**The project's configuration is read as Kit reads it.** `svelte.config.js` is imported and put
through Kit's own validator, with every file path resolved against the project rather than the
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
the generated root takes `page` as a prop, so it is a name of the payload beside `data_0` .. `data_n`
and `form`, passes `page.params` on as each level's `params` as Kit's root does, and the walk binds a component's `import { page } from '$app/state'` to that
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
   is written under `.svelte-kit/seam/routes/<id>/+root.svelte` in the shape `write_root`
   generates -- the branch's components as dynamic components, so that the `<!--[-->` and
   `<!--]-->` Kit's `{@const Pyramid_l}` writes around each are written here too, the pyramid
   sized to Kit's `max_depth` with its `filter(Boolean)` arithmetic kept, the announcer's `{#if}`
   after it -- and only the branch that renders holds a component, since the other is walked by
   the pass that asks the render and would refuse a layout met without its children. Held byte
   for byte against Kit's root rendered with Kit's props, and on press every route compiles from
   it and matches. The compiler's command line finds routes when given none.
2. **Done.** The plugin, `seam()` beside `sveltekit()` in the project's Vite config. Kit's `vite
   build` runs its server build first and the plugin takes part in that one only: when it starts,
   the routes are compiled and the artifacts emitted into the server output as assets, reached by
   the URLs the bundler gives them so an adapter carries them with the program; and Kit's
   generated `root.js` is resolved to a module that renders a page from its artifact --
   `inject(ir, derive(props))` where Kit called `root.render(props)`, with the shape
   `asClassComponent(Root).render` returns. The compile-time render itself loads its staged copies
   through a Vite server made from the project's own config, in production mode with HMR off, so
   what a component imports resolves as the project's build resolves it -- `$lib`, `$app/*`, a
   virtual module of the project's plugins, `svelte` by condition, one copy of it shared with the
   renderer -- and nothing is stubbed. Outside a build the render loads through Node as before,
   with `svelte` named by its server entry and every bare name rewritten to its file. Everything
   around the call is Kit's: `respond`, the
   `load` functions, `__data.json`, the data script, the head, the error page. Held by building one
   project twice, with and without the plugin, and asking both built servers for the same pages:
   the responses are the same bytes, document and all, the `__data.json` and the 404 included.
   What is left inside this step, each named rather than implied: the error page is still Kit's
   render, since `+error.svelte` is not a route the compiler is given; the raw-value normalisation
   of [refusals.md](refusals.md) is not on this path yet, because it has to sit where the `load`
   results are before Kit serialises them, and applying it to the bytes alone would make the
   disagreement it exists to prevent; and `vite dev` renders with Kit's own root, since the plugin
   is a no-op outside the server build.
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
