# The build

[pipeline.md](pipeline.md) says how one component becomes an IR. This says what invokes that for a
whole project, what comes out of it, and who is allowed to read what comes out.

## The compiler had no output

Every pass existed and nothing joined them. Four places each wired a different subset, and each
wired it differently:

|                                       | joined                                                            | left out                                                 |
| ------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `corpus/generate.ts`                  | bundle, skeleton, lower                                           | carrying; and it wrote its results beside the source     |
| `pkgs/injector/conformance/run.ts`    | reads the IR, then **runs binding resolution and carrying again** | nothing, which is the problem                            |
| `pkgs/server/scripts/build-client.ts` | Svelte's client codegen, esbuild                                  | marked manual, with one component's path written into it |
| `pkgs/server/src/main.ts`             | reads a fixture                                                   | **the carried bundle**, which it has no way to obtain    |

The last row is a hole rather than an omission. Wired the way the server wires it, a component
that calls an imported function does this:

```
deriving `cn('card', data.tone, [data.size, ['fixed']])` failed
    | ReferenceError: cn is not defined
```

The entry component of the development route happens to carry nothing, so it never showed. **The
carried bundle was never written to a file by anything**, and the only consumer that ran it was
the conformance check, which produced one for itself at check time.

So a test was doing a step the product did not do, and therefore proving that an artifact which
does not exist is correct. **The entry is not a tidying-up of parts that already work. It is the
first thing to state what the artifact is.**

## The entry is a Vite plugin

Three frameworks were built and measured rather than read about.

|               | what drives the build                                              | where the user's configuration lives                            |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Astro**     | its own CLI, calling Vite programmatically                         | `astro.config.mjs`, with Vite's own config as a field inside it |
| **SvelteKit** | a Vite plugin; `vite build`                                        | the plugin's argument, inside `vite.config.ts`                  |
| **Qwik**      | a Vite plugin, plus a thin CLI that only sequences two Vite builds | the plugin's argument                                           |

Two of the three are plugins, and the third's CLI buys something we do not need. The bundler is
not a thing worth maintaining a copy of, and the client half of what is produced here is an
ordinary bundle of ordinary JavaScript.

**The configuration is the plugin's argument. There is no second configuration file.** SvelteKit
carried one for years and no longer does: a project generated today has no `svelte.config.js`, and
what used to be in it is passed to `sveltekit({ ... })` and split apart inside the plugin. A second
file is a second answer to which setting wins, and that is a question with no good answer and no
need to exist.

**The fields the compiler takes control of are declared as data, and it says out loud when it has
overridden one.** This is SvelteKit's arrangement and it is worth copying exactly. It keeps a table
of the Vite settings it enforces -- `build.outDir`, `build.rollupOptions.output.entryFileNames`,
`root`, `publicDir`, and about a dozen more -- walks the user's config against the resolved one
after merging, and prints what it took:

```
The following Vite config options will be overridden by SvelteKit:
  - build.outDir
```

A compiler that quietly wins an argument with a configuration file has made the file a lie. A
table can be printed, and a table can be written down here as a contract; a rule buried in merge
code can be neither.

**A plugin is not limited to one build.** SvelteKit calls `vite.build()` a second time from inside
its own hook for the server pass. Whatever number of stages this needs, the plugin form does not
constrain it.

### The compile starts when the build does

**A config resolved for `build` is not a build.** Kit resolves the project's Vite config with
`command: 'build'` to read its own options -- `load_vite_config`, which `svelte-kit sync` calls, and
which a project's `prepare` runs at install -- and builds nothing. So the compile runs in the
plugin's `buildApp` hook, ordered before Kit's, which Vite's builder calls only when it builds, and
never in `configResolved`, which every resolution reaches.

It ran in `configResolved` until the first project `create-seamjs` generated: `sync` started a
compile under the `development` NODE_ENV Vite defaults to when nothing sets one, the compile loaded
Svelte's development runtime and refused, and what it had optimized on the way stayed in the cache
for the real build to reuse.

The exported name of the plugin is the one place the product name appears in an identifier. That is
a distribution question rather than a naming one, which [naming.md](naming.md) leaves outside its
rule.

## The dev server compiles a route when it is asked for

**`vite dev` renders by CTR too**, through the same root the build replaces: `render.js`'s import
of Kit's `root.svelte` resolves to a dispatcher in the dev server's `ssr` environment as it does in
the server build. What differs is where the program comes from. A build compiles every route once
and writes the artifacts; the dev server compiles a route when a request first asks for it, holds
the program in memory, and compiles it again once a file it was compiled from changes. It is
milestone A's gate on an application moving ([roadmap.md](roadmap.md), "Vite's dev server: CTR
under HMR"), and `pkgs/plugin/src/dev.ts` is the whole of it.

**A request is compiled for before Kit sees it.** The plugin's `configureServer` adds a middleware
ahead of every other -- Vite's and Kit's alike -- because Kit's root is a synchronous component and
nothing can wait inside it. The middleware matches the path against every page route's pattern,
parsed by Kit's own `parse_route_id`, and against what the project's universal `reroute` hook
returns for it, asked the way Kit asks it; compiles each route that matched, or the tree an
unmatched path renders; and only then hands the request on. A route a pattern matches but a matcher
would turn away is compiled for nothing, which costs a compile and changes no byte. What Vite
answers before Kit is asked -- its own modules, a file of the project's, a dependency, a static
asset -- is passed straight through, so that a route matching every path does not hold each module
the page loads until it compiled.

**An error tree is compiled behind the request.** The trees a failure under the matched route
renders are compiled once the request has been handed on, since most requests render none and each
tree is a compile of its own -- on `status`, two of a second each, which ahead of the first request
were two seconds of five. A failure before its tree is ready is rendered by Kit's root, once, as
below. Under `SEAM_KIT_ROOT=throw`, which refuses Kit's root, they are compiled ahead instead, so the
check still holds every render to a program.

**What the middleware cannot see is rendered by Kit's root once.** A page Kit's own `fetch` renders
inside another request -- Kit's `embed` app fetches two of its own pages from a `load` -- never
passes through the middleware, so it can reach the root with no program. Kit's root renders it,
which writes the same bytes, the dispatcher says so on the terminal once per route, and the route
is compiled for the next request. Milestone A's check, `SEAM_KIT_ROOT=throw`, refuses it there as
it refuses it in a build.

**A refusal is an error page, as a build that refuses fails** -- the user's decision, so that an
application served by CTR is not developed under a render that accepts what CTR refuses. The
middleware hands the compile's error to Vite, which answers with its error overlay; a refusal met
by a compile behind a request -- after an edit, while the page is already open and has taken the
change through the client's HMR -- is sent to that page as the same overlay.

**What a request meets while it runs is Kit's to answer, as in a build.** A module the page imports
that throws as it is evaluated -- Kit's `errors/stack-trace` -- fails the import of the carried
module in the middleware; that is said on the terminal and left alone, and Kit meets the same
failure as it loads the page and answers with its error page.

**Each compile is said**, as `seam: compiled <route> in <ms>`, through Vite's logger and so under
its log level; `SEAM_TIME` adds where the time went, as it does for a build.

### What it compiles through, and with what

**The loader is the build's, made under `serve`.** The compile renders its staged copies through a
Vite server made from the project's config by the same function the build's is (`loaderOf`), kept
for the dev server's life: the project's plugins without their `configureServer`, no watcher, no
HMR of its own, a cache directory of its own, and remote functions answered by stand-ins. It stands
where the dev server stands -- its mode, `__SVELTEKIT_DEV__` as Kit sets it there, `generated/dev`
-- so `$app/environment`'s `dev` is true in the render as it is in Kit's.

**The bytes are the dev server's, which are another set** ([framework.md](framework.md), "The
comparison that counts"). Every compile the skeleton makes is given Svelte's `dev` and the `hmr`
`vite-plugin-svelte` decides for this server, read off that plugin's resolved options, and where
`hmr` and `emitCss` are both on the stylesheet gets the ` *{}` rule `vite-plugin-svelte` appends, so
that every element carries the scoping class as it does there. The render runs on Svelte's
development runtime, which is the one Kit's dev server runs, and the check that a compile loaded
the right one (`shippable`) asks for that runtime under the dev server and the production one
otherwise.

**A `{@html}` block's anchor is written per request.** The development runtime opens the block
with `<!--hash-->`, a hash of the value, where production writes `<!---->`, and a hash of a marker is
a value no request holds. So under the dev server the hole's expression is `$$html(value)` --
`html` in `@seam-js/runtime`, which writes Svelte's hash of the value and the value -- and the
anchor the render wrote before the marker is taken out of it. The skeleton's check measures the
runtime's restatement of the hash against Svelte's own every compile.

**A misplaced element is said on the terminal, and not written.** Under `dev`, Svelte's
`push_element` checks each element against its ancestors, prints `node_invalid_placement_ssr` and
writes a `<script>console.error(...)</script>` into the head, once a message a process. The compile
renders with that check, so the message reaches the terminal when the route is compiled; the
script is taken out of the render's head, so the program never writes it. Kit's dev server writes
it on the first request that meets it and never again, which is the one difference in bytes a page
may carry under the dev server, and it is declared ([conformance.md](conformance.md), "Declared
differences") -- the user's decision. `$inspect` and Svelte's other development diagnostics run
where the script runs, which under CTR is the compile.

**Kit's constants are known to the compile.** `dev` from `$app/environment` (or Kit 3's `$app/env`)
is true under the dev server and false in a build, and `browser` is false on a server; a top-level
`if` on one of them, or on its negation, is the branch it takes, so `if (dev) throw new Error(...)`
in a component's script is a component that throws whatever the request under the dev server
([ir.md](ir.md), "A component that throws whatever the request is a hole that throws"). Kit's
`errors/serverside` is that page.

**What a route carries is not bundled.** A build bundles the carried names into the script because
the script is what every backend evaluates. The dev server runs on Node alone, so the carried
names are one module that imports each where it lives and exports `files` (`carriedSource`), written
under `.svelte-kit/seam/dev/carried/` by a name that is a hash of it, and loaded by the dev server's
own runner -- the runner Kit loads its server and the page with. A script run imports
`svelte/server` by name there rather than by the file it resolves to: by its path it was a second
copy of Svelte, and the captured script's `getContext` read a context the render had set in the
other one (`running({ bare: true })`). The program is the script without a bundle before it,
evaluated over the module's `files`, and evaluated again whenever the runner hands out another
module -- which it does once a file the module imports has changed, as it does for Kit's.

### What a change makes stale

**A route depends on what its compile read.** That is every source the render staged a copy of --
each component and runes module, by its own path -- every component its markup reached, each
component a universal `load` of the route imports, and every module the loader evaluated beneath
the staged copies, followed down their imports, outside `node_modules`. A file changing that is
any of them makes the route stale; a file that is none of them, a `+page.server.ts` or an
endpoint, makes nothing stale, and the next request renders from the program it has. A route whose
compile failed has no such list and is stale after any change.

**What is remembered by path is forgotten on any change.** The compile's memos are keyed by source
text, which a change makes a different entry; a few are keyed by a file's path -- what a module
changes, whether it reaches the server's environment, the names a script declares, a module script
-- and those are cleared. The loader is told too: its module graph is told of the file, and its
runner drops what it evaluated of the file and of everything importing it, since a staged copy
keeps its name when only a module it imports changed.

**A file added or removed under the routes re-reads the routes**, and every route is stale. A route
a request has asked for is compiled again once the edits stop for a tenth of a second, behind the
reload that will ask for it, so a refusal reaches the open page as soon as the edit does.

**One compile runs at a time**, since what a compile configures -- the render's host, the project's
options, the development flags -- is module state; two requests for one stale route share its
compile.

**It runs in the dev server's process.** The build compiles in a child process because a compile's
heap was measured not to come back (see "The memory a compile holds", below); the dev server keeps
one loader, its memos and its staged copies for its life on purpose, since that is what makes a
second compile of a route cheap. That retention was measured on press, under Kit 2, and press has
left; the user reports both it and the child that sat on after `close()` fixed upstream for Kit 3.
So the dev server's memory was not measured, and the build's child process is unchanged.

### How it keeps itself right

**Kit's render is the referee, on by default.** In the dev server Kit's own root is at hand, and it
is the answer: the dispatcher hands it the props it handed the program -- after every `load` has
run, so nothing is fetched twice -- and renders it alone, through Svelte's `render` with the
request's context, policy and `transformError`, and compares the two byte for byte: the body, the
head with what Svelte's `dev` writes about a misplaced element taken out of Kit's (the declared
difference above), the script hashes, and whether either threw. In Svelte's async mode the two are
awaited at once: Svelte's render starts its async work when it is awaited, and one after the other
`async`'s `remote/query-loading-state` took long enough for a query it leaves loading to settle
before the page was written, which Kit's own render does not. The user's decisions, all four:

- **On by default, and `SEAM_DEV_CHECK=off` turns it off.** What it costs is a second render of the
  components, which on `status` is a few milliseconds of a request that is mostly its `load`; a
  component's script runs twice, so a script with an effect of its own -- a counter at module scope,
  a `handleError` that logs -- does it twice, which is what the switch is for.
- **Where the two disagree, the request is answered with Kit's bytes**, the route is compiled again
  behind it, and the terminal says which route and where the bytes parted. A disagreement is this
  compiler's fault, never the author's, so the author gets the right page; a refusal is still an
  error page, as above.
- **What does not come right is escalated**, and nothing falls back to Kit's render for good: a
  fault answered by SSR is a fault nobody looks at again.
- **The dev server restarts itself at most once a minute, and otherwise stops.**

**A fault climbs a ladder.** A fault is what can only be this compiler's: a route that disagrees
again once it has been compiled again for a disagreement, or a program it wrote that does not
evaluate. Anything else the middleware meets -- a refusal, a route file Kit's own manifest refuses,
a config a plugin of the project's throws on -- is an error page, as Kit's dev server answers the
same: it may be the project's, and it is on the screen rather than hidden, so it climbs nothing.

1. **The route is compiled again**, for a first disagreement. Not yet a fault.
2. **This compiler starts over, Vite does not**: the loader is closed and made again, every program
   dropped, and what the compile remembers forgotten.
3. **Vite restarts**, as `r` restarts it (`server.restart()`), unless it restarted in the minute
   before; the browser reloads on its own.
4. **The process ends**, saying where the log is: a fault after a restart, or one inside a minute of
   the last, is a fault no restart cures, and a server that keeps restarting is a loop the author has
   to kill by hand. Not a fall back to SSR, the user's decision: that would hide it.

The ladder climbs one rung per fault and comes down to the first after ten minutes with none. What
the process holds across Vite's restart -- the rung, when it last restarted -- is kept on the
framework's global, since a restart makes the plugin again in the same process.

**Everything is logged to `.svelte-kit/seam/dev.log`**: each compile and what it took, each
disagreement with both answers written beside it as files, each fault and the rung it took. The
terminal says the path whenever it says a fault, and when the dev server closes it prints one line
for the session -- requests, the ones refereed, disagreements, compiles, faults by rung -- which is
what an author running it for a week reads to know how it went.

**`SEAM_DEV_FAULT=<route>` makes a route's program write the wrong bytes**, for the check that the
ladder climbs as it says (`pkgs/plugin/src/dev.test.ts`). Nothing else reads it.

### How it is measured: an author's own edits, replayed

Developing is not one number, so it is taken apart into ones that are: **disagreements per request**,
which is zero; **edits between faults**, which is every edit; the time from an edit to a request
that renders it, p50 and p95, against Kit's; and the compile time and the heap after a long run
against the first ones, which is whether it drifts. They are measured by replaying what an
application's author actually wrote rather than edits written for the check: the commits that
touched `status`'s source, one after another, each written into a dev server of Kit's and one of
the fork's with the referee on, every page asked of both after each. `.local/status/replay.ts` is
the harness, since the application is the author's own; what it found is recorded here.

Only the latest of a history runs against the dependencies and the config a project has now --
of `status`'s last thirty commits, the four since its move onto its own manifest; the twenty-six
before it import `$lib`, which Kit 3 removed, and fail under both servers alike. So the harness
replays the thirty, and then goes back over the four that run and forward again, eight times, as an
author who undoes a change and makes it again does. Measured so:

| over 78 edits, 52 of which render                            | Kit's dev server | the fork's                |
| ------------------------------------------------------------ | ---------------- | ------------------------- |
| pages unlike Kit's (234 asked; 78 failing under both)        | --               | 0                         |
| disagreements with Kit's render, faults                      | --               | 0, 0                      |
| `/` after an edit that renders, p50                          | 174 ms           | 175 ms                    |
| `/` after an edit that renders, p95                          | 198 ms           | 1186 ms                   |
| resident, before and after                                   | 573 MB, 1068 MB  | 1005 MB, 1629 MB          |
| a compile of `/` that renders: the first, the rest, the last | --               | 1.55 s, 1.1-1.6 s, 1.21 s |

An edit that leaves the page's sources alone costs nothing, which is the p50; one that changes them
is a compile of about 1.2 s, which is the p95 and does not drift over the session. Both servers grow
by about half a gigabyte over it; the fork starts some 430 MB higher, the loader and what it
evaluates, and grows about 130 MB more, the staged copies each edit makes. Nothing restarts on memory
yet: what the ladder climbs on is a fault, and growth is not one.

### What it costs, on `status`

Measured on a copy of `status` (`.local/status/dev.ts`), Kit's dev server and the fork's over the
same made-up data at a fixed instant, after Vite's optimizer had settled what the server imports:
every page byte for byte, none of them reaching Kit's root, and a request once warm the same, 86 ms
each, nearly all of it the application's own `load`. The first compile of `/` took 2.1 s and of its
two error trees a second each, behind it. An edit of `src/routes/+page.svelte` reached the next
request in 0.5 s under Kit's and 1.7 s under the fork's, the recompile 1.35 s of it: the skeleton's
renders, each loading its staged copies through the project's plugins. The client's HMR takes the
edit in the browser as it does under Kit's, before any of this.

## The artifact was data, and is a program

_Superseded._ **A route's artifact is the program that writes its bytes**, and the IR stops at the
build ([ir.md](ir.md), "A route is one program"). What decided it is that every backend carries a
JavaScript engine -- QuickJS in Rust's, Node beside it in D ([roadmap.md](roadmap.md)) -- so a tree
walked in one language calling into the engine once a hole bought nothing a program does not, and
cost three times Kit's render on `status`. What follows is why the artifact was data, kept because
its measurement still holds of data: what it argued against was data copied into JavaScript, and a
program is not that. The rule it served, one artifact that every backend reads the same way, holds
of the program ("A route is one script, and every backend runs it", below).

Every framework surveyed emits its server half as a single JavaScript module, and the reason is
not performance. It is that **their server artifact is code and code has only one spelling**.
SvelteKit's manifest, measured:

```js
export const manifest = (() => {
  function __memo(fn) { let value; return () => value ??= (value = fn()); }
  return {
    assets: new Set(["robots.txt"]),
    nodes: [__memo(() => import('./nodes/0.js')), ...],
  };
})();
```

A `Set`, a closure, and a deferred import. None of the three has a JSON spelling, so JSON was
never a candidate. Beside it, a compiled route is a function:

```js
function _page($$renderer) {
	$$renderer.push(`<h1>Welcome to SvelteKit</h1> ...`);
}
```

Astro is the same conclusion reached differently: one `entry.mjs`, 325KB for an empty project,
with the manifest a literal inside it.

**Ours is a serializable tree, and that was decided long before this file.** The compiler renders
in order to serialise a structure it already knows -- see [pipeline.md](pipeline.md) -- so what
comes out is an IR, not a render function. The constraint that forced their hand is one this
design does not have, and inheriting their answer would mean inheriting a constraint we were
careful not to acquire.

Qwik is the exception that confirms the rule. Its cross-stage carrier is `q-manifest.json`, real
JSON holding `mapping`, `bundles`, `symbols`, `injections` and `assets`, and it is JSON because
Qwik's producer is a Rust optimizer and its consumer is not. That is the same boundary this project
has between a WebAssembly lowering pass and a backend that may not be Node.

### Bundling the artifact into JavaScript is measurably worse

The question is whether the four kinds of output should be an intermediate state, packed into one
large JavaScript module as a final step. Measured over a thousand routes at 8KB of IR each, in a
fresh process, three runs each:

```
A  a thousand .json files, read individually     33ms
B  one .json file                                20ms
C  one .js module, object literal                78ms      <- copying the JSON into JavaScript
D  one .js module, an embedded JSON.parse        51ms
```

**The bundled form is the slowest of the four, by 3.8x.** C and D hold identical content and differ
only in spelling: JSON is a far smaller grammar than JavaScript and gets a dedicated parser, where
an object literal goes through the full one. Copying data into JavaScript moves it off the fast
path and onto the slow one.

The two smaller findings matter as much:

- B beats A by 13ms across a thousand files, which is 13 microseconds per file. **The number of
  files is not a cost.**
- A server does not read a thousand routes to answer one request. Reading the one it needs:
  **0.06ms.** The single-module form cannot do that at all, which is why SvelteKit's manifest is
  wrapped in memoized deferred imports -- one more thing that cannot be JSON.

So there is no bundling step over the artifacts. Should single-file deployment ever be wanted --
an edge runtime that accepts one module -- it is added then, in D's form and never C's, and it is a
packaging option rather than a stage.

## One artifact, two readers

The stronger reason is not the 3.8x.

A backend that is not Node has to serve the same bytes, which is why there is no runtime fallback
for a refused component -- see [refusals.md](refusals.md). If the TypeScript server read a bundled
JavaScript artifact and the Rust server read JSON, the two would no longer be reading the same
thing, and a second axis of divergence would exist for no gain: reading JSON costs TypeScript
nothing and measured faster.

**The artifact is one format. Two backends read it.** It is a script now, and both run the same one
in an engine of their own: Node's, or QuickJS in Rust's.

## What is produced, and where

```
dist/
  client/          served as-is, cacheable, public
    _app/*.js      the hydration entries and the chunks they share
    _app/*.css
    <assets>
  server/          read by the backend, never served
    <id>.js        the route's program, the carried bundle before it
    app.html       the document shell, with its two placeholders
    manifest.json  which URL is which script, and the tags its document needs
```

The two directories are a boundary rather than a symmetry. **A server artifact must not be
reachable as a static file**: it holds the component's structure and, in time, what the compiler
refused and why. A directory enforces that; an exclusion list is a thing somebody eventually
forgets to update.

## A route is one script, and every backend runs it

`<route>.js` is the carried bundle -- the functions the expressions call, assigning `__carried` --
and the route's program after it, assigning `__program`. A backend evaluates it once a process and
calls what it returns once a request: `evaluated()` in `@seam-js/runtime` hands the program
that module, which is everything it calls, so the script imports nothing and has no module loader
to need. It is still an **artifact**, not part of the server program, and it does not get bundled
into one: a Rust backend evaluates this file too, in QuickJS, with a runtime of its own beside it,
and the two must run code that arrived by the same route.

**Nothing in it reads Node's host.** The suite runs every corpus case's script in QuickJS with the
runtime bundled as a backend that is not Node would carry it, and holds its bytes to Node's
(`quickjs.test.ts` in `pkgs/program`). The runtime's one part that does read the host is
`hydratable`'s script, which serialises with Svelte's own devalue and hashes with the host's
sha256; a program makes its table only where a derivation calls `hydratable`, and how a backend that
is not Node writes that script is C's to answer ([roadmap.md](roadmap.md)).

**The manifest says which script answers which URL, and nothing about engines.** It said whether
anything had to be evaluated rather than walked, for a backend choosing whether to embed an engine;
every backend has one, so the field is gone.

## A route is a URL and a root component

`compile` takes entries, and an entry is a pair rather than a path:

```ts
entries: [
	{ path: '/', component: 'src/pages/product.svelte' },
	{ path: '/about', component: 'src/pages/about.svelte' },
];
```

**The URL is the author's, not the compiler's.** It was briefly the component's id, by way of a
development server that served each artifact at `/<id>`, and that is a routing convention invented
by an implementation detail rather than decided. Naming the URL is what stops the compiler from
deciding it by accident.

**What finds the entries is SvelteKit's routing, taken whole.** The pair above stays the compiler's
interface, and the framework layer produces the pairs: `src/routes` read by Kit's own
`create_manifest_data` into routes and their layout chains, a route id spelled as Kit spells it --
`[param]`, `[...rest]`, `[[optional]]`, `(group)` -- and matched by Kit's own `find_route`. The
command line, given a root and no pairs, does exactly that, and its path is the route id. Nothing
about routing is invented here; see [framework.md](framework.md) and `pkgs/routes`.

**The root component is one field both halves read, and it is the generated root.** The compiler
renders it to produce the IR, and the plugin generates a hydration entry that mounts it, and the
two agree because they read the same field rather than because somebody kept them in step. For a
route the field is the root generated in the shape of Kit's own -- the page nested in its
layouts, a boundary per level, taking `data_0` .. `data_n`, `page`, `form` and `error`, see
[framework.md](framework.md) -- so that the layout chain is one walk and one IR, which
is what [payload.md](payload.md) describes the payload against. The shell's two placeholders are
unchanged.

That is the same rule as one artifact and two readers, moved to the two halves of a build. It
matters because the halves are produced by different things -- the IR by a WebAssembly pass, the
entry by a Vite plugin -- and the bytes one writes have to be the shape the other mounts.

## A field whose domain the build declares

[pipeline.md](pipeline.md) sets out the law the compiler works to: enumerate the structures a value
induces, never the values themselves. Most of the time the markup names them, and the build has
nothing to say. The exception is a field the author's own markup does not branch on while something
downstream does -- a locale a translation package reads, a role that picks a layout -- where the
compiler can see neither the branch nor the domain.

**That domain is a build input, for the same reason the URL is.** The compiler cannot know that a
locale has nine values, and working it out by inspecting whatever library happens to read it would
be this project guessing at somebody else's code again. So it is declared beside the entry, the
compiler renders once per value, and every one of those renders is kept. In the plugin's argument
it is `enumerate`, keyed by route id, the paths and the values each takes.

What is not settled here is how the results are stored -- one artifact carrying an `n`-way branch,
or `n` artifacts the server picks between. Both are the same compilation with the branch resolved
at a different moment, so it is a deployment choice and it waits on routing being decided, like the
rest of what a URL means. See [pipeline.md](pipeline.md).

## What a page made of several components needs, and what it costs

Measured, on a page component rendered three ways:

```
the component alone   <!--[--><article>...</article><!--]-->
inside a static wrap  <!--[--><article>...</article><!--]-->            identical
inside a dynamic one  <!--[--><!--[--><article>...</article><!--]--><!--]-->
```

**A component that is statically known costs nothing.** Composition already works this way and the
compiler inlines it: a page built from a dozen components is one IR, and a nested layout is a
generated root that writes `<Layout><Page /></Layout>`, which compiles to the bytes the same
markup would have produced by hand. **Nesting needs no change to the IR, the manifest or the
artifact layout.** What it needs is a way to say which layout wraps which page, which is routing
and is deferred.

**A component chosen at request time costs one anchor pair**, because Svelte wraps a dynamic
component in a block. That is the shape a client router needs: the mounted root cannot be the page
if the page is the thing being swapped.

So the door that could close is not the format. The IR is rebuilt by every build, so a wrapper
added later is a rebuild rather than a migration. The door is the _agreement_: server bytes and
client mount shape are produced by different halves, and a wrapper added to one and not the other
is a hydration failure. The root component being one field is what holds it shut.

## The client half

**The client half is SvelteKit's, untouched.** Kit's `vite build` runs its server build first and
starts its client build from inside it; the plugin here takes part in the first and is a no-op in
the second, so the client bundle, the hydration entry, the router, `__data.json` navigation and
`$app/*` are Kit's own build of Kit's own code, hydrating against bytes that are Kit's byte for
byte. There is no hydration entry of this project's to generate and no router to wait on. The
earlier arrangement -- one generated entry per route mounting the root against a `data-payload`
script, served by a Node server of this project's -- is retired with it; see
[framework.md](framework.md) for what the plugin does instead.

What is not yet held by a check is that the browser hydrates without a repair. The check that held
it ran this project's own server in a real browser and went with that server; the one that replaces
it drives the Kit build the plugin test already makes, and is owed.

**Several hydration roots on one page is out of scope.** Astro's islands are separate roots with a
payload each, and Svelte hydrates one root against one payload. The scope line in
[roadmap.md](roadmap.md) -- after hydration the page is one standard Svelte SPA -- decides it: the
artifact is one root, and this is recorded because it is the only multi-component shape the
artifact does not express, so that nobody reads the absence as an omission.

## The document shell

The shell is a source file the author owns, with the two placeholders the server fills. It is
copied to `dist/server/app.html` and read from there, because a backend that is not Node has to
read it too.

**SvelteKit compiles its shell into a JavaScript function** taking `{ head, body, assets, nonce,
env }`, which is available to it because its server artifact is code. It is not available here for
the same reason nothing else is: the file has to be readable by a Rust server.

**The tags a document needs are written by the compiler, not assembled by the server.** A build
gives its client files hashed names, and something has to turn those into a `<script type="module"
src="...">`. If the server did it, two backends would have to spell a script tag identically, and
that is a byte-level agreement of exactly the kind this protocol exists to avoid. So the manifest
carries the finished string:

```json
"routes": {
  "/": {
    "id": "src/pages/product",
    "ir": "src/pages/product.json",
    "carried": null,
    "head": "<link rel=\"modulepreload\" href=\"/_app/chunk.js\"><script type=\"module\" src=\"/_app/product.Bq7f.js\"></script>"
  }
}
```

The server concatenates it with the component's own head. It never learns to spell a tag, which
means there is nothing for a second implementation to get subtly different.

Beside `routes` the manifest carries `left`: the routes the compile made no artifact for, by URL,
each with why -- a module that cannot be evaluated on the server and that no component of the route
could stand in for. The plugin hands such a render to Kit's own root, and the build says so as a
warning rather than failing. `routes` also holds the error trees, under ids beginning `#`. See
[framework.md](framework.md), "A module that cannot be evaluated on the server" and "The error
page".

## A filename is an input to the bytes

Two things Svelte writes are hashes of the component's filename, and both end up in the response:

|                                               |                                                          |
| --------------------------------------------- | -------------------------------------------------------- |
| the anchor that opens a `<svelte:head>` block | `hash(filename)`, in the server visitor for `SvelteHead` |
| the class that scopes a `<style>`             | `svelte-${hash(filename)}`, the default `cssHash`        |

Before either is taken, the filename is made relative to **`rootDir`**, which is an ordinary
compiler option whose default is `process.cwd()`:

```js
if (typeof root_dir === 'string' && filename.startsWith(root_dir)) {
	filename = filename.replace(root_dir, '').replace(/^[/\\]/, '');
}
```

Left at the default, **the directory the build ran from is in the response bytes.** Measured on one
component before this was understood: three working directories, three different classes for the
same file. Two people building the same commit from different places would get different
artifacts.

**And the client compares.** Svelte's `head()` on the client checks the anchor it finds against the
hash it was compiled with and gives up when they differ:

```js
head_anchor.nodeType !== COMMENT_NODE || head_anchor.data !== hash;
```

So this is not a tidiness question about one side of the build. The server bytes come from this
compiler and the client comes from the client build, and if the two are rooted differently the
client cannot find the head block it is looking for, and a scoped class selects nothing.

**And the filename is the real path**, which is the id the project's bundler compiles a component
under. A package's component sits behind the link pnpm makes into `node_modules`, outside the
project once followed, so its hash is of the whole path, not of one relative to `rootDir`:
compiled under the link, `@canmi/kit`'s `title.svelte` opened its `<svelte:head>` with another
anchor than Kit's, and `status` differed by that alone.

**So `rootDir` is the project root, on both halves, and `filename` stays absolute.** That is
Svelte's own answer to this, which is why it exists as an option; handing it a pre-relativised
filename would work by accident -- a relative path does not start with the working directory, so
nothing rewrites it -- while throwing away the real path that errors and source maps need.

It is the same rule as the root component: one field that both halves read, so they cannot drift
apart without somebody changing the field. With it, `<style>` stops being refused once there is a
client build to emit a stylesheet.

## What a compile costs, and what it remembers

The cost of a compile is not guessable from the outside, and this is written down because it was
guessed at twice and wrongly both times. A reading of the trace said the alternate renders were
the cost; measured, a route with ninety-three blocks renders eight of them and most passes render
none. A second reading said the nested Vite build for the derivation bundle was minutes each; it
is two seconds for the whole compile. A CPU sample settled neither, because `sample` cannot
symbolise V8's JIT frames and every JavaScript frame came back as `???`.

**So the stages time themselves, and `SEAM_TIME` prints what they took.** The stages nest -- a
walk and a render inside `skeleton`, a codegen and a module load inside a render -- and a stage's
share of its parent is what the report is read for rather than a total. Measured on press's seven
routes, before any of the memory below was addressed:

```
skeleton (walk + renders)   425.1s    17 calls
  walk (rewrite)            376.2s   499 calls
  render (svelte SSR)        40.7s   494 calls
    load (host import)       31.4s   514 calls
    codegen                   1.0s   390 calls
    render call               0.0s   514 calls
carry (derivation bundle)      2.2s    12 calls
lower (wasm)                   0.1s     1 call
```

Two things in that table are worth stating as facts rather than numbers. **The render itself is
free**: `render()` over a whole route is unmeasurable, and what the render stage costs is loading
the modules it just staged. And **the walk is the compile**, at 88%, because it runs once per
render and a route renders hundreds of times.

**A pure function asked hundreds of times for one answer is remembered by its inputs.** Four
were: an expression parsed as the component it would be the whole of, a whole component parsed,
Svelte's server codegen, and the derivation bundle. Each is keyed by everything it was given --
the source rather than the file, so a copy the walk rewrote differently is a different entry and
nothing is served a stale answer -- and each map is bounded by the number of distinct sources a
compile meets rather than by the number of renders, which is the whole of why it works. The walk
went to 221 seconds and the server build to nine and a half minutes, from a build that used to
die in V8's garbage collector after nineteen.

**Counting the parses said the memos had covered one call in eleven.** A counter around Svelte's
parser, over one route of press: **107,424 calls over 1,461 distinct sources, 561MB of text**. The
walk is 88% of a compile and parsing is half of the walk, and `descend()` parses each component it
enters eleven times per call site -- `runed`, `unbound` and `inlined` rewrite it, `importsOf` and
`reduce` read its imports, `locals` reads its declarations, `statements` reads a module it reaches,
and the walk parses it once more for itself. Remembering the whole component's tree, which is the
memo refused below, removed one of the eleven, which is why it measured at five per cent.

**So every pure pass over a source is remembered by that source, and most of them hand back no
tree at all.** `bySource` in `ast/memo.ts` holds what `runed`, `unbound`, `inlined`, `importsOf`,
`reduce` and a module's statements answered: a string, a record of names, a list. Bounded by the
distinct sources a compile meets, and each entry the size of its answer rather than of a tree,
which is the whole difference between these and the one below. Measured on the same route: the
parses went to **23,657 over 115MB**, the walk from 78.2 to 22.7 seconds, and the route from 96.8
to 40.3. The IR is byte for byte what it was, which is the check that matters.

**And the walk itself runs once per structure rather than once per render.** `taken` is consulted
in four places and each writes one of two constants -- `true` or `false` for an if's test, a
resolved promise or a placeholder for an `{#await}`, one element or none for an each, and the same
pair inside the `{#if}` a content binding opens. Everything else a walk produces is the same for
every branch, because `collect()` goes into every branch whatever it is told; the assembler
already relies on that, since it reads an alternate by the block index the baseline gave it. So an
alternate is the baseline's edits with a handful of texts written the other way and applied again,
which is a string splice per file. `rechosen()` in branches.ts does it, and `chose()` is the one place
that asks `taken`, which is what makes the list of choices the complete difference between two
renders. Measured over press's seven routes: **208 walks in 24.8s became 36 walks in 3.2s and 172
re-applications in 4.8s**, and the artifacts are byte identical on every route.

**The trees are handed out shared, and that is sound rather than lucky.** Nothing writes into an
AST here: what the walk produces is a list of `[start, end, text]` edits against the source, and
every other reader only reads. A pass that ever needs to rewrite a node has to copy it first, and
the day one does, this is the rule it breaks.

## The memory a compile holds, which is not yet bounded

**Recorded rather than solved.** A compile of press holds eight to nine gigabytes, and none of
the remembering above is where it goes -- the caches were measured against it and moved it by
nothing.

Where it goes is the one mechanism a render cannot do without. `import()` caches by URL, so two
renders of one component would be the same module and the second render's configuration would
silently return the first's; the copies are therefore staged under a fresh name per render. Both
hosts then keep every one of them: Node's ESM registry has no eviction at all, and Vite's SSR
module cache is never invalidated here. So the modules of every render ever made are retained for
the life of the process, and the staging directory being deleted afterwards frees the files and
not the memory.

Two consequences are already measured. A declared domain multiplies it, because a route is
compiled once per combination: four values crashed Node in V8's collector at nineteen minutes,
where one value completed. And [pipeline.md](pipeline.md) describes enumerating a locale over nine
values, which on this curve does not finish -- so the model that file sets out is not currently
reachable at the size it is written for.

**Half of it is a host forgetting, and that half is built.** A host says whether it can drop a
module, and Vite's can: the SSR module graph is told about exactly the copies a render staged --
never about what the project itself imports, or the project would be transformed again per render
-- and Node's host leaves it undefined, because its ESM registry has no eviction at all. That the
two hosts differ here is not an omission to tidy up: the fresh name per render exists _because_
Node cannot forget, so the capability is optional by construction.

Measured, against the same compile with the same caches: the peak went from about 9.2GB to 7.3GB,
the curve stopped climbing monotonically and fell back to 6.4GB, and the compile took the same
time, so the invalidation is free. **It is not the whole of the retention**, and the rest was
measured by turning the memos off rather than reasoned about.

**Because a Vite holds two graphs and only one of them was told.** The server's `moduleGraph`
holds what a module was transformed into; the runner's `evaluatedModules` holds what it evaluated
to -- the module's code and its exports, which is the component's whole closure graph -- and
`ssrLoadModule` evaluates through a runner the server keeps for itself. Invalidating the first
frees a transform and leaves the evaluation, which is the larger half and the reason the peak fell
by two gigabytes rather than by six. Telling both took the live heap of one route from 2563MB to
1435MB at the same wall time.

**Forgetting is the wrong half of the question, though, and a staged copy is now named for what is
in it.** The fresh name per render existed because `import()` caches by URL and two renders of one
component under one name would have been the same module, the second's configuration silently
answered by the first's. Under a name that is a hash of the finished file there is no second
configuration: two renders share a module exactly when they would have written the same program,
and they nearly always would -- an alternate render differs from the baseline in one block, and a
route stages a hundred copies per render. Measured on press, 207 renders staged **824 distinct
files** rather than fourteen thousand, so the module a render asks for is nearly always one the
host has already transformed and evaluated. Nothing is invalidated any more; the files go when
the compile does, in `forgetStaging()`.

**A file is named after its children, which is what makes the name honest.** The hash is of the
finished bytes, taken once the imports have been rewritten to the names of the files they point
at, so it covers everything the file reaches. Named from the bytes Svelte produced instead --
which was tried, and which the checks caught -- a parent whose own code is unchanged while a child
inside it flipped a branch keeps the name it had, is skipped as already written, and goes on
pointing at the child from the render before: the alternate then rendered the baseline's bytes. A
cycle has no such order, since re-entering a file still being written means its name is about to
appear inside itself; that file is given a name of its own, shared with no render, and so is
everything that imports it.

Measured over press, against the same compile: **`load (host import)` 15.1s to 5.6s, the compile
29.4s to 17.7s, and the child's peak 3.27GB to 2.19GB.**

**A memo is memory traded for time, and each trade is priced separately.** The two that hold trees
were switched off together and then one at a time, on a machine with nothing else on it:

|                         | walk   | live heap |
| ----------------------- | ------ | --------- |
| neither                 | 372.6s | 2785MB    |
| an expression's tree    | 259.5s | 3828MB    |
| and a whole component's | ~232s  | 5751MB    |

So an expression's tree buys 113 seconds for a gigabyte and a whole component's buys 27 more for
nearly two. **The second is refused**: a compile that cannot run in CI is worse than one that takes
ten per cent longer, and the reason it looked worth taking -- that a walk parses a route's hundred
components once per render, fifty thousand times over -- turned out to be true and not to be where
the time was. The measurement is kept beside the function, so that the same intuition does not add
it back.

What that leaves is about 2.8GB of live heap that is the compile itself, under a resident 6.3GB
that barely moves between the three rows: the difference is heap V8 has grown and not returned,
which is churn rather than retention, and which tracks the limit the process was given.

What bounds the rest is the compile's heap dying with the thing that made it, and **it is the whole
compile rather than one route**. Measured after a full collection at the end of a compile of press:
**945MB still referenced, and 2.4GB that V8 had grown and would not return** -- RSS went from
3400MB to 3389MB while the live heap halved, so nothing was handed back to the operating system.
Clearing what is held only makes it collectable; it does not give it back.

**Measured on press under Kit 2; press has left, and the user reports this retention and the
child that would not exit fixed upstream for Kit 3.** What follows stands as it was measured; the
dev server, which compiles in its own process, relies on the fix rather than on a measurement.
See "The dev server compiles a route when it is asked for".

**So the compile runs in a process of its own that exits.** It could, because it already was one in
every way but the last: what it produces are files under `<outDir>/seam`, which `buildStart` reads
off the disk, and nothing of it crosses into the build in memory -- `compile()`'s return value was
discarded where it was called. What crosses the boundary now is one JSON argument and an exit code,
its streams are the build's own so a refusal still appears where it did, and the child says
`process.exit` rather than waiting: a Vite server keeps handles its `close()` does not release.
See `apart.ts`.

**And it runs once, which it did not.** `vite build` resolves the config more than once with
`build.ssr` set -- twice for Kit alone, three times with an adapter that builds again -- and each
resolution is a plugin of its own, asking for the same artifacts from the same sources. They came
out identical every time, so two of the three compiles were the whole thing run for nothing: on
press that was ninety seconds and three heaps of three gigabytes each.

**What says it already happened is a file, because nothing in memory is shared between the
resolutions that ask.** Vite loads a config file by bundling it and evaluating it **in a realm of
its own**: measured, the same pid reports a different `globalThis` each time, and a value hung off
`process` -- which carries that pid into the realm -- is not seen from the other either. So the
stamp goes beside the artifacts, holding what the compile was told and which run wrote it, the run
being the pid and the process's start to the second. The filesystem is how the compile already
talks to the build around it.

**What that fixed was not only the compile.** The bundling that follows used to start from the
compile's floor and stayed there, and rolldown at 9.7GB is rolldown collecting rather than
bundling. Measured over a whole press build, `vite-plugin-sveltekit-compile writeBundle` went from
**372.4 seconds to 5.7**, and the build from minutes to **42.1 seconds** of which 32 are the
compile. The parent now peaks at 525MB while the compile runs and the child at 3.2GB, and the
child's 3.2GB is gone before a single module is bundled.

A worker per route, which an earlier draft of this section wanted, is a different trade and is
still not built: the compile shares its memos and its Vite across routes, so seven of them would
raise the peak rather than lower it.

## A loop that awaits is sequential on purpose

oxlint's `no-await-in-loop` is off for this repository, in its own `.oxlintrc.json`, which extends
the workspace's and says only that. The rule's premise is that the iterations are independent and
should be one `Promise.all`; counted the day it was turned off, twenty-two reports, of which one
was right -- a hydratable entry awaiting its promises one by one, since folded -- and twenty-one
were loops that are sequential because of what they do:

- the structure queue in `compile.ts` grows while it is walked, an `Undecided` adding the runs
  its test splits into, so the loop has no end to fan out to;
- the runtime's `drive` feeds a generator one step at a time, each step's input the last one's
  answer;
- a structure, a route and an alternate branch are rendered one at a time, for the memory a render
  holds and for a deadline that is per render -- see "The memory a compile holds", and "One
  render" in spec/suite.md;
- `resolve.ts` tries holes against a shared `seen`, which two renders at once would race;
- the tests assert per case, with the case in the message, which a `Promise.all` would take away.

A rule wrong twenty-one times in twenty-two is noise, and the one right case is the reviewer's
to see. The rule stays on in the workspace, since nothing has been counted elsewhere. See
spec/lint-format.md in the workspace, "A rule one project turns off is turned off in that project".

## Packaging is about the program, not the artifacts

The backend is a program, and a program gets bundled. The distinction is exact:

|                        |                                                           |                                            |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------ |
| **the artifacts**      | IR, derivations, carried bundles, manifest, client bundle | never bundled, identical for every backend |
| **the server program** | the framework's own code and the author's server code     | bundled, and how depends on the language   |

**Rust.** The server framework and the author's server code compile to one binary. Whether the
artifacts are embedded into it is an option: embedded gives one file that serves by itself, and
not embedded gives one binary plus `dist/`.

**TypeScript.** The server framework and the author's server code bundle to one JavaScript
program. The artifacts stay beside it. This is the same choice as Rust's, made in the language that
is available: a single JavaScript program is what a binary is here.

**A JavaScript single binary is possible and is not built.** A runtime can be embedded alongside
the program and the artifacts, which is what the Rust option already offers. The capability is
recorded so the shape stays open; nothing depends on it.

The rule underneath all three is one line. **Code is bundled. Data is not.** It is the same
sentence as the measurement above, and it is why the artifacts do not change when the backend
does.
