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
| `core/sync/write_root.js` | the root component nesting a page in its layouts, `data_0..n`, `params`, `form` as props | the compiler's entry per route, see [payload.md](payload.md) |
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

1. `pkgs/routes`: route ids, then the manifest from `src/routes`, then the generated root. This
   is what [roadmap.md](roadmap.md) had blocked as the layout chain, and press's real root.
2. `respond` and `render` with the render replaced, one route served end to end from the Node
   server, `__data.json` included.
3. The client runtime, whole, so that navigation after hydration is Kit's.
