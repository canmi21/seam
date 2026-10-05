# What is left, and what each item waits on

**Two different boundaries run through this specification and they are not the same boundary.**
The first decides whether a thing is in scope at all; the second decides which half of the work it
belongs to. Both have been called "the line", which is why they are named here and referred to by
name everywhere else.

**This file is short on purpose.** It holds what is left, what it waits on and the order it is
taken in. What each closed item was, read out of Svelte's source before it was written down, is
[readings.md](readings.md), by section name; a comment in the code that says "see spec/readings.md"
points there.

## The scope line: what compile-time rendering is for

The line that decides what belongs here is one sentence. **Before hydration the page is an MPA
and has to be what SvelteKit's SSR would have served; after hydration it is a standard Svelte SPA
and there is nothing to decide.** CTR differs from SSR in one thing only: when the UI is rendered.
So nothing Svelte's server render produces is outside it. Where the bytes depend on what the
request brings, the part that depends is computed per request and the rest at compile time; what
the per-request stage may run is [derivation.md](derivation.md)'s rule, which this protocol chose.
That split is how the work is done, never a line the work stops at, and a construct is refused
only for as long as nobody has written it. [refusals.md](refusals.md) says what a refusal means.

**It used to say otherwise.** A component whose bytes needed "the UI run per request" was filed as
blocked on request-time rendering and counted out of stage one, 99 sample runs of it. Read against
the samples, not one needed Svelte's renderer run per request, and the reasons they were given
belonged to other layers, which the layer line below now keeps out.

**The client is not this protocol's.** After hydration the page is Svelte's own client against
Svelte's own server bytes, and this compiler changes nothing it ships. So a check on the client is
a check on the bytes it hydrated from, and nothing more: that is what makes Kit's own client specs
usable as a measurement below without being anything this compiler owns.

## The layer line: protocol, and the framework around it

Nothing here is the framework layer. Routing, the layout chain, the load stage and where request
context sits are the meta-framework's, and this protocol is not yet the equivalent of SvelteKit;
[framework.md](framework.md) is where that layer is taken from Kit.

**A constraint of that layer, or of a backend, is not a reason here.** The payload a page hydrates
from carries data, the load stage is where a value is fetched, and a backend that is not Node embeds
an evaluator with no host: each is true of the framework or of one backend, and each is measured
there -- stages two and three in [conformance.md](conformance.md), a backend's own tests -- never by
turning a Svelte sample away. At this layer the question is only whether the same props and render
options give Svelte's bytes, and props are values in the process that renders, stores and functions
included. [suite.md](suite.md) holds the suite to it.

The two are independent, which is the reason for naming them apart. A construct can be in scope by
the scope line and still not be this protocol's by the layer line: the load stage is exactly that,
kept whole and Kit's. So "not here" and "not at all" are different answers, and an item's section
below says which one it got.

## Four milestones, and what accepts each

**The work is four milestones, A to D, each accepted by a measurement and not by a judgement.**
They are not the stages of [conformance.md](conformance.md): a stage is a body of tests -- Svelte's
samples, Kit's apps, an application moved -- and a milestone is something the framework can do,
which names the stages and the checks that accept it. Two words are used exactly here. **CTR** is
this repository's render, at the build where nothing the request decides is read and per request
where something is. **SSR** is Svelte's server render run per request, Kit's.

**The order is A, B, C, D.** B comes before C because B is where the declaration of SSR is made,
and both backends after it read that declaration: C serves what declares none, D starts Node for
what declares some. Each is started once the one before it is accepted; a failure in a milestone
then has one explanation fewer, which is [conformance.md](conformance.md)'s argument for its own
order.

### A: Kit's place, by an alias, with CTR where SSR was

**An application written for Kit swaps one line of its `package.json` and is served by CTR.**
`"@sveltejs/kit": "npm:seamjs@<version>"` ([framework.md](framework.md), "The fork is the entry,
under the entry's name"), nothing else edited, and every page it serves is compiled -- wherever it
writes nothing CTR refuses. What CTR refuses is a compile-time error naming the shape, never a
request handed to SSR instead ([refusals.md](refusals.md), "Every refusal is a compile-time
error").

Accepted when all four hold:

1. **Every response is Kit's, byte for byte, but where a difference is declared.** Each of Kit's
   test apps that builds, compared with `mise run compare` ([conformance.md](conformance.md),
   "Stage 2"). **Met**: all eleven, `async`'s three streamed pages being the one declared
   difference.
2. **Kit's own specs pass through the fork, unedited**, every app's, in the build Kit's config
   runs them against, but for a failure a declared difference lists. **Met**: every spec of the
   eleven apps passes under the check build, but the declared one
   ([conformance.md](conformance.md), "Stage 2").
3. **No request to a production build runs SSR.** Held by a check build in which Kit's
   `root.svelte` throws whenever it is rendered, under which 1 and 2 still pass (`--kit-root=throw`,
   [conformance.md](conformance.md), "Stage 2"). **Met**: every app compares the same and every
   spec passes with no request reaching Kit's root, error pages included
   ([framework.md](framework.md), "The error page").
4. **An application of the author's, moved.** `status`, held the way stage 2 holds Kit's apps, and
   no slower per request than through Kit ([conformance.md](conformance.md), "Stage 3"). **The
   bytes are met; the cost is not**: about three and a half times Kit's, for how a derivation is
   evaluated per item.

`vite dev` is not in A: it renders with Kit's root, and its own target is below.

**A is the first release.** Once it is accepted the fork is published ([publish.md](publish.md)).
**An application of the author's moves onto it once A is accepted and the dev server is CTR's too**
(below): an application served by CTR and developed under Kit's SSR is one whose author meets a
shape CTR refuses only at the build, which makes every day after the move worse than the day
before it. Until both hold, no application of the author's is changed -- `status` included, which
A measures from a copy. Then they move, a few small ones in the monorepo first and the rest as each
holds, so that what a migration meets is met in the author's projects before anyone else's. What it is then offered to others on is those migrations. `create-seamjs` changes with that release
and not before: it still writes the plugin's arrangement, `seam()` beside `sveltekit()`, and moves to
the alias when the entry is first published as the fork ([publish.md](publish.md), "`create-seamjs`").

### Vite's dev server: CTR under HMR, after A

**`vite dev` is taken by CTR too, as a compile target of its own.** It is after A, and gates the
author's applications moving, though neither A nor the release; until it is done, the dev server renders by SSR as Kit's does, and a
shape CTR refuses is met at the build. A target of its own because the bytes are another set:
under the dev server Svelte compiles with `dev` and `hmr`, its server output differs from a
production build's -- a `<!---->` after every component that `clean_nodes` would leave alone
([framework.md](framework.md), "The comparison that counts") -- and the dev client hydrates those.
So it has its own measurement, Svelte's samples rendered under those options and Kit's apps under
`vite dev` against Kit's dev server, `dev-only` among them and the dev half of each app's
Playwright config. And the compile becomes incremental: a route compiled when it is first asked
for and compiled again when a file its components reach changes, read off Vite's module graph.

### B: CTR and SSR together, in Node

**A component may be declared rendered by SSR, and everything else is CTR.**

- **The declaration is per component.** The compiler reads every component's source and tree, so
  the component is the unit it can be asked at. How it is written is not decided.
- **It goes up and never down.** CTR is the lower layer and SSR the upper one. A CTR component's
  child may be declared SSR; a component declared SSR is SSR with everything under it, and nothing
  under it can be declared back to CTR -- Svelte's server render renders a component's children
  itself, so nothing is left there for CTR to take. A declaration that would step down is a
  compile-time error.
- **It is the author's, never the compiler's.** A component is rendered per request because its
  author declared it, refused or not, and never because the compiler refused it: undeclared, a
  refusal stays an error ([refusals.md](refusals.md), "There is no runtime fallback").

Accepted when:

1. **An application declaring nothing passes A's checks unchanged.**
2. **A page with declared components is Kit's byte for byte**, held the way A holds a page: the
   same applications, with declarations placed, against Kit's build.
3. **Declaring nothing ships nothing of SSR.** The server build of an application with no
   declaration contains no component compiled for Svelte's server, Kit's `root.svelte` among
   them, and of `svelte/server` only what CTR itself calls, which the check lists by name. Checked
   on the build's output, by a test, not by reading it.
4. **Declaring some ships SSR for those alone**: the declared components and what is under them.

### C: a Rust backend, CTR only, with QuickJS

**A server written in Rust serves the same artifacts, and runs what a derivation computes in
QuickJS.** [build.md](build.md) has why the artifacts do not change with the backend.

**There is no Rust backend without an engine.** QuickJS is in every Rust server, enabled by
default, and the two shapes Rust takes are this one and D's, with Node beside it. Nothing is built
for a Rust server that serves by walking the IR with no JavaScript, and nothing is decided for its
sake.

Accepted when:

1. **The same artifacts answer the same request with the same bytes** as the Node backend does.
   Node is held to Kit by A, so Rust is held to Kit through it.
2. **Rust starts no Node.** QuickJS is the only JavaScript engine in the process, and the check
   reads the process, not the configuration.
3. **A route Rust cannot serve is named at the build.** A derivation that reads what QuickJS has
   no host for -- `process`, [derivation.md](derivation.md) -- makes its route one only a
   JavaScript backend serves, said when the route compiles and never as a failure per request.

**Decided when C starts, not before: what runs the load stage.** Kit's `load`, `+server.js` and
remote functions are JavaScript run by Node, and on a backend that is neither TypeScript nor Node
something else has to answer for them. That is a question about the framework layer on another
backend, and C is where it is asked.

### D: Rust as the server, with Node for what is declared SSR

**Rust is the server, the meta-framework's server replaced, and the client is Kit's as it is.** SSR
runs in a Node process the Rust server starts and talks to, for the components B's declarations
name and nothing else.

Accepted when:

1. **The same application with the same declarations answers B's bytes.**
2. **Rust starts Node only where something is declared SSR.** An application declaring nothing is
   C, and C's second check holds of it.
3. **The client is Kit's**: the same client build A ships, unchanged by the server behind it.

## Where it stands

- **Stage one is met.** The suite is in `verify`, both renders are measured, nothing fails in
  either, and there is no harness skip left in the list; `mise run vendor-baseline` prints where
  it stands. Every construct still refused is refused by name, and no sample in Svelte's corpus
  writes one.
- **A is what is being worked**, and stage two with it: SvelteKit 3's own test apps, built through
  the fork and driven by Kit's own specs unedited. [framework.md](framework.md), "SvelteKit 3 is
  the target, and what it moves", is the order it was taken in.

## Owed

**How the request-time half runs.** _Decided: one program per route, rewritten now._ Measured on
`status` through `.local/status`, one request of the page: about 259 ms injecting against about
37 ms for Kit's render, out of 302 ms and 80 ms. The walk evaluated about 91,000 derivations, each
a `new Function` reading its names through nested `with` over a proxied scope stack -- 540,000
`has` traps a request -- and that read alone is about 25 times a lexical closure's on the page's
own bar expression. The walk itself was a generator stepping 163,000 nodes, and a per-item value
was held by scope identity, which a nested each missed: `dailyOf` ran 771 times where Kit's runs it 192. A boundary's run was not it, at under 5 ms. Making each step cheaper would still have called
into the engine once per hole, and with every backend carrying an engine nothing held that in
place ([ir.md](ir.md), "Expressions are not evaluated"). So the build lowers each route's IR and
derivations into one program that writes the bytes -- constants as literals, an each as a loop,
every name resolved to what it means when the program is written -- and the engine runs it once
a request. In four steps, each held to the whole suite, Kit's apps byte for byte and `status`:

1. **The program, over the IR as it is.** Generated from the IR and the derivations the lowering
   already writes, so the new backend is held to the bytes the old one was held to. It replaces
   `derive` and the injector's walk; what Svelte's bytes need of a runtime -- escaping, the title
   channel, `hydratable`'s script -- stays a library the program calls.
2. **What only the walk needed goes.** A boundary is a `try` around what its children write, as
   `renderer.boundary` is, so its run, the guards and the per-request tables go; a `{@const}` is a
   `const` where it is declared.
3. **The artifact is the program.** One script a route, the carried bundle and the program
   together, evaluated once a process: no `new Function` per expression, no `with`, nothing of
   Node's host in what it calls, so QuickJS runs it as Node does.
4. **Accepted.** What the old backend left behind removed, the spec rewritten to the program, and
   `status` no slower than Kit's own render.

**A child's write into an object the caller reads, under the async render.** Not yet measured by
the suite, and owed. `runtime-legacy/binding-backflow`'s `reactive_mutate` and `init_mutate` cases
have the child do `value.foo = 'kid'` on the object its caller passed as `value`; `bind_props`
sends nothing up, since the caller's value is not `undefined`, so Svelte writes the caller's
`{value?.foo}` before the child runs and it reads `mon`, in both renders. The synchronous pass
agrees. Under `experimental.async` this compiler writes `kid`: the caller's read is an async
derivation and the child is a held run, and the run is evaluated before the derivation reads, so
the write lands first. It stays out of the suite's colour only because upstream never renders the
legacy suite async and the runes corpus has no sample of this shape; a runes project with the flag
on and a child that mutates a prop object would meet it. It is "Shared mutable state a function
reaches" in [readings.md](readings.md), met through evaluation order rather than through a name.
Two answers, and the choice is not made: evaluate the async derivations of a structure in source
order, which is Svelte's order and costs the concurrency the async build has; or hand a held run a
copy of what it is passed, which is not Svelte's semantics -- the object is one object there, the
read is just earlier. The first is the one to try; what `stacked()` in `pkgs/derive` orders today
is where it starts. Kit's `async` and `options-2` apps turn the flag on, so stage two is where a
test for it arrives; it is taken there rather than ahead of it.

**A package's module whose state something changes.** The render imports each module afresh and
the carried bundle imports it once, so a binding a module changes is two values. It is refused for
a relative module, whose source is read; a package's is the hole, and reading the package's source
the way `carry` already resolves the file is what closes it. [readings.md](readings.md), "The
render's module instances are not the artifact's".

**A context set from a value the request decides.** Refused at the reader. Following the setter's
expression to the reader, the way a prop is followed, is the work, and it is the one channel
between components the walk does not follow. [readings.md](readings.md), "Context carries a value
the walk does not follow"; [refusals.md](refusals.md) has the refusal.

**A child the walk could not enter, branching on a prop it also writes out.** The rule that catches
a child doing something other than writing a marker out is the marker not coming back, and a child
that branches on the prop and writes it elsewhere defeats it. No sample writes the shape. Reading
which of the child's expressions the marker reached is what closes it. [readings.md](readings.md),
"Wrong bytes, which is not a refusal and outranks everything below".

**What is refused by name.** Each is a gap and [refusals.md](refusals.md) holds it with the shape
it waits on: a spread on a `<select>`, a `let:` taking a pattern apart and a spread on a `<slot>`,
a head that reaches a fragment from a component inside the body, a child binding `$props()` to a
name, a store write inside an exported function, a store deciding a `<svelte:element>` tag. The
reading of each is in [readings.md](readings.md) under the section that found it.

## Out of scope

**Several hydration roots on one page.** After hydration the page is one Svelte SPA, and Svelte
hydrates one root against one payload. Astro's islands are a different arrangement, and
[build.md](build.md) records that this artifact does not express it and is not going to. This is
about the client, and request-time rendering does not change it: a page with some components
rendered at request time still hydrates as one root.
