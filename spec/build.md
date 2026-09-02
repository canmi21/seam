# The build

[pipeline.md](pipeline.md) says how one component becomes an IR. This says what invokes that for a
whole project, what comes out of it, and who is allowed to read what comes out.

## The compiler had no output

Every pass existed and nothing joined them. Four places each wired a different subset, and each
wired it differently:

| | joined | left out |
| --- | --- | --- |
| `conformance/generate.ts` | bundle, skeleton, lower | carrying; and it wrote its results beside the source |
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
    _app/*.js      the hydration bundle
    _app/*.css
    <assets>
  server/          read by the backend, never served
    <route>.json   the IR and its derivations
    <route>.js     the carried bundle, where the component carries anything
    manifest.json  which route is which, and what the client half is called
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
