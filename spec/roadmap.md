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

Every item below was read out of Svelte 5.57's source before it was written down, and the file
that decides it is named. That is the order of work for each: read the transform and the runtime,
form the rule, measure it with Node against Svelte's own output, then write ours, then the check
that holds the two together. See the workspace's `spec/agent-protocol.md`.

## Where it stands

The order the work is proved in is [conformance.md](conformance.md): Svelte's own samples, then
SvelteKit's own test apps, then an application written for Kit and moved.

- **Stage one is met.** The suite is in `verify`, both renders are measured, nothing fails in
  either, and there is no harness skip left in the list; `mise run vendor-baseline` prints where
  it stands. Every construct still refused is refused by name, and no sample in Svelte's corpus
  writes one.
- **Stage two is what this version is for.** SvelteKit 3's own test apps, built with this plugin
  and driven by Kit's own specs unedited, are the definition of usable: the framework layer around
  the render, exercised the way Kit's authors exercise it, with nothing of this repository's own
  standing in for an application. [framework.md](framework.md), "SvelteKit 3 is the target, and
  what it moves", is the order it is taken in.
- **What it is for is the author's own projects.** The order of work is the one that gets the
  framework running in them, then in the hands of people around the author; the framework
  direction that serves it is [framework.md](framework.md), "Kit is replaced, until it offers a
  seam to plug into".
- **Stage three is not scheduled.** press is being rebuilt around its CMS and is on Kit 2, so it is
  not a measurement anybody can take, and by [conformance.md](conformance.md)'s own argument it
  would not be one worth taking before stage two is green. It comes back when it is on Kit 3, as
  the application that meets the edge cases Kit's apps were not written to meet.

## The second mode waits on the first

**This version changes when the UI is rendered, and nothing else.** Compile-time rendering beside
request-time rendering on one page -- some components compiled, some rendered by Svelte's server
per request, which is the mode [refusals.md](refusals.md) names under "Not permanently. The
condition is named" -- is not started before stage two is green. The reason is
[conformance.md](conformance.md)'s reason for its order: a failure in a page that mixes the two
has one more explanation than a failure in a page that does not, and the first mode has to be the
one thing it cannot be. No refusal waits on the second mode, so nothing is lost by the order.

## Owed

**Every item here is a gap.** A sample that writes one fails in the suite until it is closed, and
the ones no sample writes were found by probe and are held by a refusal that names the shape.

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
