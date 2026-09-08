# The build

[pipeline.md](pipeline.md) says how one component becomes an IR. This says what invokes that for a
whole project, what comes out of it, and who is allowed to read what comes out.

## The compiler had no output

Every pass existed and nothing joined them. Four places each wired a different subset, and each
wired it differently:

| | joined | left out |
| --- | --- | --- |
| `corpus/generate.ts` | bundle, skeleton, lower | carrying; and it wrote its results beside the source |
| `pkgs/injector/conformance/run.ts` | reads the IR, then **runs binding resolution and carrying again** | nothing, which is the problem |
| `pkgs/server/scripts/build-client.ts` | Svelte's client codegen, esbuild | marked manual, with one component's path written into it |
| `pkgs/server/src/main.ts` | reads a fixture | **the carried bundle**, which it has no way to obtain |

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

| | what drives the build | where the user's configuration lives |
| --- | --- | --- |
| **Astro** | its own CLI, calling Vite programmatically | `astro.config.mjs`, with Vite's own config as a field inside it |
| **SvelteKit** | a Vite plugin; `vite build` | the plugin's argument, inside `vite.config.ts` |
| **Qwik** | a Vite plugin, plus a thin CLI that only sequences two Vite builds | the plugin's argument |

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

The exported name of the plugin is the one place the product name appears in an identifier. That is
a distribution question rather than a naming one, which [naming.md](naming.md) leaves outside its
rule.

## The artifact is data, and that is not a preference

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
function _page($$renderer) { $$renderer.push(`<h1>Welcome to SvelteKit</h1> ...`); }
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

**The artifact is one format. Two backends read it.**

## What is produced, and where

```
dist/
  client/          served as-is, cacheable, public
    _app/*.js      the hydration entries and the chunks they share
    _app/*.css
    <assets>
  server/          read by the backend, never served
    <id>.json      the IR and its derivations
    <id>.js        the carried bundle, where the component carries anything
    app.html       the document shell, with its two placeholders
    manifest.json  which URL is which artifact, the tags its document needs, and whether
                   anything here has to be evaluated rather than walked
```

The two directories are a boundary rather than a symmetry. **A server artifact must not be
reachable as a static file**: it holds the component's structure and, in time, what the compiler
refused and why. A directory enforces that; an exclusion list is a thing somebody eventually
forgets to update.

### The one artifact that is code

`<route>.js`, the carried bundle, is JavaScript because it is the source of the functions a
derivation calls, and `derive` evaluates it. It is still an **artifact**, not part of the server
program, and it does not get bundled into one.

The reason is the rule above. A Rust backend reads this file too and hands it to its evaluator. If
the TypeScript server bundled it into its own program while Rust read it from disk, the two would
be running code that arrived by different routes, which is the divergence this whole section
exists to prevent.

## A route is a URL and a root component

`compile` takes entries, and an entry is a pair rather than a path:

```ts
entries: [
  { path: '/', component: 'src/pages/product.svelte' },
  { path: '/about', component: 'src/pages/about.svelte' },
]
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
route the field is the root Kit's `write_root` generates -- the page nested in its layouts, taking
`data_0` .. `data_n`, `params` and `form` -- so that the layout chain is one walk and one IR, which
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
added later is a rebuild rather than a migration. The door is the *agreement*: server bytes and
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

## A filename is an input to the bytes

Two things Svelte writes are hashes of the component's filename, and both end up in the response:

| | |
| --- | --- |
| the anchor that opens a `<svelte:head>` block | `hash(filename)`, in the server visitor for `SvelteHead` |
| the class that scopes a `<style>` | `svelte-${hash(filename)}`, the default `cssHash` |

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
head_anchor.nodeType !== COMMENT_NODE || head_anchor.data !== hash
```

So this is not a tidiness question about one side of the build. The server bytes come from this
compiler and the client comes from the client build, and if the two are rooted differently the
client cannot find the head block it is looking for, and a scoped class selects nothing.

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
which is a string splice per file. `rechosen()` in walk.ts does it, and `chose()` is the one place
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
two hosts differ here is not an omission to tidy up: the fresh name per render exists *because*
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
by two gigabytes rather than by six. Both are told now, and a runner that is not there is one
fewer graph rather than an error, since which of them holds a module is Vite's decision. Measured
on one route: **live heap 2563MB to 1435MB, and the compile took the same time.**

**A memo is memory traded for time, and each trade is priced separately.** The two that hold trees
were switched off together and then one at a time, on a machine with nothing else on it:

| | walk | live heap |
| --- | --- | --- |
| neither | 372.6s | 2785MB |
| an expression's tree | 259.5s | 3828MB |
| and a whole component's | ~232s | 5751MB |

So an expression's tree buys 113 seconds for a gigabyte and a whole component's buys 27 more for
nearly two. **The second is refused**: a compile that cannot run in CI is worse than one that takes
ten per cent longer, and the reason it looked worth taking -- that a walk parses a route's hundred
components once per render, fifty thousand times over -- turned out to be true and not to be where
the time was. The measurement is kept beside the function, so that the same intuition does not add
it back.

What that leaves is about 2.8GB of live heap that is the compile itself, under a resident 6.3GB
that barely moves between the three rows: the difference is heap V8 has grown and not returned,
which is churn rather than retention, and which tracks the limit the process was given.

What would bound the rest is a render's heap dying with the thing that made it: a render is a pure
function from a source and a payload to bytes, and a worker that compiles one route and exits
takes every module it loaded with it. That is the fix that works for both hosts, and it has to be
serial to be worth having -- seven workers each with a Vite server of its own would raise the peak
rather than lower it, trading the memory for a parallelism nobody asked for. Not built.

## Packaging is about the program, not the artifacts

The backend is a program, and a program gets bundled. The distinction is exact:

| | | |
| --- | --- | --- |
| **the artifacts** | IR, derivations, carried bundles, manifest, client bundle | never bundled, identical for every backend |
| **the server program** | the framework's own code and the author's server code | bundled, and how depends on the language |

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
