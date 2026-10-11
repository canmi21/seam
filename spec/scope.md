# Scope: the two lines, and where the work stands

**Two different boundaries run through this specification and they are not the same boundary.**
The first decides whether a thing is in scope at all; the second decides which half of the work it
belongs to. Both have been called "the line", which is why they are named here and referred to by
name everywhere else.

**What is left is RFCs, filed under the `rendering` area**: the milestones and every gap owed, each
with what it waits on -- the workspace's `spec/planning.md`. What each closed item was, read out of
Svelte's source before it was written down, is [readings.md](readings.md), by section name; a
comment in the code that says "see spec/readings.md" points there.

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

**The order is A, B, C, D.** B comes before C because B is where SSR enters a route, and both
backends after it read what the artifact says of each route: C serves a route with no SSR part, D
starts Node for a route with one -- declared or degraded, `mixed` or `ssr` in the artifact's
`coverage` ([together.md](together.md)). Each is started once the one before it is accepted; a
failure in a milestone then has one explanation fewer, which is [conformance.md](conformance.md)'s
argument for its own order. **B is the exception**: taken forward while A is still being worked,
the user's decision, which is what [together.md](together.md) records.

The milestones are RFCs: A is RFC adio2, the dev server RFC 5k5pj, B RFC c3j48, C RFC aodmv and D
RFC c59q8.

## Where it stands

- **Stage one is met.** The suite is in `verify`, both renders are measured, nothing fails in
  either, and there is no harness skip left in the list; `mise run vendor-baseline` prints where
  it stands. Every construct still refused is refused by name, and no sample in Svelte's corpus
  writes one.
- **The request-time half is one program per route** ([ir.md](ir.md), "A route is one program"),
  rewritten in the four steps it was planned in, against `status` measuring a request at three
  times Kit's: the walk evaluated about 91,000 derivations a request, each a `new Function` reading
  its names through nested `with` over a proxied scope stack, 25 times a lexical read. What came of
  each step:
  1. **The program.** Written from the IR and derivations the lowering already wrote, each name
     resolved when it is written ([derivation.md](derivation.md), "A name is resolved when the
     program is written"); `derive` and the walk are gone, and what Svelte's bytes need of a runtime
     is `@seam-js/runtime`.
  2. **A boundary is a `try`** ([ir.md](ir.md), "A boundary is a `try`"), and its run is not
     evaluated. Two parts of the plan were not taken as written. The lowering still writes the run
     and the guards, which the program falls back on where it finds no body half, so they are kept
     in the IR rather than removed; and a `{@const}` is a function of its item kept per item
     ([derivation.md](derivation.md), "An instance is made once") rather than a `const` where it is
     declared, since a value of the IR names no place in the walk to be declared at.
  3. **The artifact is the script**, the carried bundle and the program ([build.md](build.md), "A
     route is one script, and every backend runs it"), and every corpus case runs in QuickJS byte
     for byte. `hydratable`'s script still reads Node's host, and is C's.
  4. **Accepted**: the suite, Kit's eleven apps byte for byte, their specs under the check, and
     `status` ([conformance.md](conformance.md), "Stage 3").
- **The dev server answers with Kit's render and holds CTR to it behind each response**
  ([build.md](build.md), "The dev server answers with Kit's render, and CTR is checked behind it").
- **CTR and SSR together, taken forward from B** ([together.md](together.md)): a refusal degrades to
  SSR, a component can be declared SSR, the artifact says what renders each route, and the build holds
  each route to Svelte's render over the props kept in development.
- **A is what is being worked**, and stage two with it: SvelteKit 3's own test apps, built through
  the fork and driven by Kit's own specs unedited. [framework.md](framework.md), "SvelteKit 3 is
  the target, and what it moves", is the order it was taken in.

## Refused by name

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
