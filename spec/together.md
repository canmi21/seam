# CTR and SSR together

**What cannot be compiled is rendered by Svelte per request, and nothing fails to build because of
it.** A route is compiled; the parts of it the compiler refuses, and the components an author
declares, are rendered by Svelte's server render when the request comes, inside the bytes the
program writes. The user's decisions, taken together because they hold one another up:

- **A refusal degrades rather than fails.** It makes the smallest component that can be rendered on
  its own an SSR component, and at worst the whole route. An application Kit can render, the fork
  can build.
- **A component can be declared SSR**, and the same rule places it.
- **It goes up and never down.** CTR is the lower layer and SSR the upper one: a CTR component's child
  may be SSR, and an SSR component is SSR with everything under it.
- **The dev server answers with Kit's render, and CTR is checked behind it** ([build.md](build.md),
  "The dev server answers with Kit's render, and CTR is checked behind it"), so developing is Kit's
  and what the build would do is said while it happens.
- **The props a page was rendered with in development are kept, and the build holds its programs to
  Svelte's render over them.**
- **How much of each route is CTR is part of the artifact**, and the build says it.
- **Production sampling is later**: below, under "Owed".

This supersedes [refusals.md](refusals.md), "There is no runtime fallback", and the rule of
[roadmap.md](roadmap.md)'s B that SSR is the author's and never the compiler's. What they argued
still holds of the protocol -- a Rust server reaches Svelte's render only through Node -- and it is
answered here by naming what is SSR rather than by refusing it: a route with an SSR part is one
only a backend with Node serves, and the build lists it. **It is milestone B, taken forward before
A is accepted**, the user's decision; [roadmap.md](roadmap.md), "B: CTR and SSR together, in Node",
keeps B as it was planned.

## Declaring a component SSR

```svelte
<script module>
	export const seam = 'ssr';
</script>
```

**In the component's own module script, as a constant**, so the declaration travels with the
component -- a package declares its own -- and the compiler reads it off the source without running
anything. The user's choice, over a list of paths in the plugin's config. Any other value of `seam`,
or a `seam` that is not a literal, is refused by name, so a typo is not a component quietly compiled.

There is no declaration of CTR: CTR is what a component is unless it or something above it is SSR,
which is what "never down" comes to. A declaration inside an SSR subtree is already true and says
nothing.

## Where SSR starts

**At the component, at its call site in a CTR parent.** The compile renders the parent with a
stand-in where the component was, a component of one line that writes a marker, so every anchor the
parent writes around a component call is the parent's own and is in the program's bytes. At request
time the program renders the component through Svelte's `render`, with the props the call site
passes computed per request as any other value is, Kit's request context, and the request's
`transformError`, takes the pair `render()` writes around a root off the body, and writes the body
where the marker was. The component's module is carried as any value a derivation calls is, so the
render and the component are one copy of Svelte, and Kit's `$app/state` reads the request's `page`
out of the context it is handed.

**It moves up to the caller where what the component renders is not the component's alone:**

- **the call site hands it markup** -- children, a snippet, a slot -- which is the caller's, written
  in the caller's file and rendered inside the component;
- **the call site binds to it**, so a value the component sends back is read by the caller;
- **an ancestor between it and the route sets a context** while the subtree reads one, since the
  program runs no CTR component's script and so holds no context it set.

Moving up is the same test asked of the caller, as it is called from its own caller, until one
passes.

**It goes straight to the route where the subtree writes into the head** -- a `<svelte:head>`, a
title -- **counts an id** with `$props.id()`, or calls **`hydratable`**: each is ordered or numbered
across the whole page, which a render of any one component cannot know, however far up it starts. **Past the route's own components it is the route**: Kit's root renders it, as a route left
to the framework is rendered ([framework.md](framework.md), "What is still Kit's render"). The
reason each step was taken is kept and reported.

**A refusal degrades the component it was raised in**, by the same rule. One raised outside any
component the walk entered -- in the route's own generated root, or about the route as a whole -- is
the route.

**The stand-in takes none of the call's attributes**: what they say is the hole's, computed per
request, and in the build's render they would be values no request holds. An event handler is
handed as a function that does nothing, since a server render never calls one. A call that sets a
custom property, which Svelte writes as a wrapper element around the component, and a component
chosen per request, move up to the caller.

**A page holding a component declared SSR is not rendered once at the build**, which a page nothing on
it is a request's to decide otherwise is: declared, the component is per request. One degraded by a
refusal does not stop it, since there the build's render is the right bytes for every request.

**What is not a degradation.** A refusal the author has to fix whatever renders it -- `await` in
markup outside Svelte's async mode, which Svelte's compiler refuses too -- is still the build's error.

## Coverage

**The manifest says, for each route, what renders it**, under `coverage`: `ctr`, CTR whole; `mixed`,
CTR with SSR components -- each named, with why it is SSR, declared or degraded and from what -- or
`ssr`, SSR whole, with why. A route SSR whole for a refusal is also listed under `ssr`, which the
dispatcher reads: it renders by Kit's root, and milestone A's check, which refuses Kit's root, does
not refuse it. The build
prints the same as one line per route that is not CTR whole, and a total: routes, and of the
components the routes reach, how many are CTR. A component counts as SSR once however many routes
render it.

**`SEAM_STRICT=1` makes the build refuse instead of degrade**, for a CI that holds an application to
CTR whole. A declaration is not a degradation and is allowed under it.

## The props a page was rendered with, kept and replayed

**In development, the props Kit hands its root are kept per route**, under
`.svelte-kit/seam/payloads/<route>/`, serialized with devalue as Kit serializes data. **One per
shape**: the shape is the payload's types, its object keys and its arrays' lengths bucketed as none,
one, a few and many, so a page asked a thousand times with the same kind of data keeps one, and a
page whose data took a different form keeps that too. **At most sixteen per route.** A payload
devalue cannot write -- a function, a component a universal `load` returned -- is not kept, and that
is counted. They are the project's own data and stay in its output directory, which no repository
carries.

**The build holds each route's program to Svelte's render over every payload kept for it**: the
generated root rendered by Svelte in the build's loader, and the program, with the same props, byte
for byte. A route that disagrees is rendered by SSR, named in the coverage with the payload it
disagreed over, and is this compiler's defect to close; under `SEAM_STRICT=1` it fails the build.
`SEAM_VERIFY_FAULT=<route>` makes a route's program write the wrong bytes in this check, for the
test that a disagreement does what this says (`pkgs/plugin/src/dev.test.ts`); nothing else reads it.

## Owed

**Production sampling.** A share of production requests, once answered, rendered again by Svelte
behind the response and compared, a disagreement reported. The user's decision is that it comes
after the rest here.

**A context an ancestor sets, handed to an SSR component.** Today the ancestor setting it takes the
component's place as SSR. The walk already follows a `setContext` to the readers it renders; written
as derivations, the values could be handed to the SSR render as its context, and the component would
stay where it is.
