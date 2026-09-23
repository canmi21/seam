# The payload

The payload is what the load stage produces and everything after it reads. It is the other half
of [derivation.md](derivation.md), which says a name in an expression may resolve to a prop but
never says what a prop is, where it comes from, or who guarantees it is there.

## The contract that was already there

Two lines, one on each side, and nothing in between them:

```ts
resolve([payload], 'p.name'); // the injector
hydrate(Component, { props: JSON.parse(text) }); // the client
```

They agreed by luck. Nothing wrote the agreement down and nothing checked it, and three things
went wrong because of that.

**A wrong key renders a complete, empty page.** Measured, against a component with no derivations:

```
correct key      <article class="card"><h1>Alice</h1><!--[0--><button>Buy</button>...
misspelled key   <article class="card"><h1></h1><!--[-1--><!--]--><!--[--><!--]--></article>
```

The slot resolves to `undefined`, escapes to nothing; the if takes its else; the each iterates
nothing. HTTP 200, well-formed HTML, no content.

**Whether it fails at all is an accident.** A component that happens to carry a derivation throws,
because `with({})` cannot find the name; a component that happens not to, does not. The same
mistake has two fates depending on something the author never chose.

**The compiler's internals ship to the browser.** `derive(data)` returns the data with `__d0`,
`__d1`, `__d2` beside it, and that is what is embedded and handed to `hydrate` as props. The
client component was compiled from the original source and evaluates `price > 10` itself, so the
derived fields are dead weight there, and a wire format made of the author's data plus the
compiler's scratch space is not one anybody chose.

## One prop, named `data`

**The payload is not the props object. It is one prop.**

```svelte
<script>
	let { data } = $props();
</script>
```

This is SvelteKit's arrangement and the reason for it is structural rather than stylistic: it
separates the shape of the payload from the shape of the component's props, and without that
separation there is nowhere to put anything that is not the author's data. `__d0` sitting beside
`p` at the top level is that missing separation showing.

Derived fields belong to the injector and go no further. **The wire carries `data`; the derived
fields are computed on the way to injection and are not serialized.**

**The shape is Kit's, in two layers.** A page is one component among several: its layouts sit
around it, and each of them has a `load` of its own. Kit's wire is therefore not one `data` but one
per node of the branch, `__data.json` carrying a `nodes` array with a `data` in each, devalue
encoded, and its generated root component takes them as `data_0` .. `data_n` beside `page` and
`form` and hands each layout and the page its own layer as `data`, with `page.params` as its
`params`. That root is what the compiler compiles -- the entry of a route is the root `write_root`
generates for it, see [framework.md](framework.md) -- so the compiler's payload is the root's props,
which are what Kit's `render_response` hands its root: `data_0` .. `data_n`, `page`, `form`.
Inside the page `data.title` is still `data.title` and `params.slug` is `params.slug`; the walk
substitutes the root's prop into each and the IR paths come out as `data_2.title` and
`page.params.slug`, and the injector's top scope is the object the runtime builds from the nodes
and the request, `{ data_0, ..., data_n, page, form }`. The principle above holds at both layers:
each component reads one prop named `data`, and nothing but the author's data crosses the wire.

This also settles where request context sits. The `page` a component reads from `$app/state`, and
the `params` it takes as a prop, are the root's props and the runtime's, filled by the load stage
from the request; a derivation reads them as it reads any prop, and never reaches for the request
itself. The names
`$.now`, `$.tz` and `$.locale` that [derivation.md](derivation.md) reserved are whatever the load
stage puts in those props.

## The render's input and the hydration wire are two things

**The payload used to be both**: what derive and inject read per request, and what is serialised
into the page for the browser to hydrate from. The second role made the first data-only, so a store,
a promise, a component or a render option's function could not reach the server render at all --
where Svelte's own `render()` takes any value as a prop. **They are split.**

- **The render input** is what derive and inject read: the root's props as the load stage built
  them, and the render options the server passes, Kit's CSP and a `transformError` among them. Any
  JavaScript value is one. Both backends hold them: a Rust or Go server embeds QuickJS, which lacks
  a host and not the language, so a function, a store and a promise are values there as they are in
  Node -- see [pipeline.md](pipeline.md).
- **The hydration wire** is what crosses to the browser: devalue's `stringify` of the data a client
  needs, in a script it does not execute. What it carries, and how the browser rebuilds a value
  that is not data, is the framework layer's, as Kit rebuilds one by running a universal `load`
  again in the browser.

This is Kit's own arrangement, and it follows from the scope line in [roadmap.md](roadmap.md):
compile-time rendering differs from Svelte's server render only in when the render runs, and that
render is handed whatever the load stage made.

## The wire is devalue

`JSON.stringify` loses a `Date` to a string, a `Set` to `{}`, and `undefined` entirely. devalue
carries them, and it is already in the tree as Svelte's own dependency, and it is what Svelte uses
for the same purpose in `hydratable`.

```
devalue  [{"p":1},{"name":2,"when":3,"tags":4,"n":-1,"big":6},"a<b>",
          ["Date","1970-01-01T00:00:00.000Z"],["Set",5],"x",["BigInt","1"]]
json     {"p":{"name":"a<b>","when":"1970-01-01T00:00:00.000Z","tags":{}}}
```

The output is still valid JSON, so the payload stays in a `<script type="application/json">` that
the browser does not execute. `stringify` and `parse` are used rather than `uneval`, which
produces executable source and would give that up.

devalue escapes `<` itself, so the hand-written `replaceAll('<', '\\u003C')` that stood in for
that goes away. Its README lists XSS mitigation as a goal and demonstrates the exact hole that
line was covering.

**Svelte's own `uneval` script is a different thing from this choice.** A project in async mode
calling `hydratable` gets a `<script>` at the head of the page that Svelte writes with
`devalue.uneval` -- executable source -- and the bytes are Svelte's, so a server reproducing them
writes that script too. That is reproducing Svelte, not choosing `uneval` for this protocol's own
payload, which stays `stringify` and a `<script type="application/json">`. So `crates/devalue` ports
`uneval` beside `stringify`, held to the npm package the same way.

**Today the script is written by the npm devalue Svelte itself depends on, and the crate is not
involved.** The injector resolves `devalue` from where Svelte sits (`pkgs/injector/src/hydratable.ts`),
so the bytes are Svelte's whatever this repository pins. The two can differ by a major: Svelte
5.57.1 declares `^5.9.2` and resolves 5.9.4 while the pin is 6.x, and 6.0 changed how `uneval`
writes a shared value. Only a Rust backend writing this script would have to match Svelte's major
from the crate, which is when the crate grows a 5.x line on crates.io beside the 6.x one its code
tracks -- the version being devalue's, not seam's -- and that backend depends on the major Svelte
does. Until there is one, there is nothing to port.

**`crates/devalue` is a port of one version of it, and moves when that version does.** The crate's
version is the npm package's, byte for byte, because devalue promises no stable format between
versions. So a bump of the `devalue` the workspace pins is a re-port: read upstream's diff for
`stringify` and `uneval` between the two tags, carry what changes bytes the crate can produce, regenerate the
fixtures with `mise run fixtures`, and set the crate's version to the new one. The crate's
conformance test reads the pin and fails while the two disagree.

**This answers a question [derivation.md](derivation.md) left open.** Request context can carry a
real `Date`, so `$.now` need not be a number the author has to reconstitute -- which matters,
because the same file forbids the bare `new Date()` that reconstituting it would otherwise need.

Next chose plain JSON for `getServerSideProps`, on performance grounds, and the resulting
`cannot be serialized as JSON` error produced `superjson` and a pair of compiler plugins to work
around a decision the framework made for its users. The saving was not worth what it cost them.

**What the wire cannot carry is a function, and that is a decision rather than a limit.** The line
above is where it is made: `stringify` and `parse` over `uneval`, so what crosses is data a browser
does not execute. devalue carries a `Date`, a `Set`, a `BigInt`; it carries no function, and giving
it one would mean giving up the thing that line is protecting.

**It is a rule about the wire and not about the render.** It used to be read as both, and two
refusals followed from it that the split above withdraws. **A store** is an object with a
`subscribe` function, and `$x` reads whatever `x` holds while the bytes are written: on the server
that is the store's value, read per request out of the render input. **A component** is a function,
and `<svelte:component this={x}>` over one the request hands in renders it. What stays is the bound
on which component that can be -- one the source names -- since rendering whatever component a
request sends would be running Svelte's renderer per request, the fallback
[refusals.md](refusals.md) refuses. A request that sends anything else there is a page that does
not work: Svelte throws, and there are no bytes to reproduce.

**The two sides must run the same devalue.** Its own non-goals include stability of the
serialization mechanism between versions. This is the same class of coupling as the scoped style
class taking the filename: two places that must agree exactly, with nothing to warn you.

## Structure comes from the component, types come from the backend

Every `slot.path`, every `if.test` and every `each.source` in the IR is a data path. Collected,
they are exactly **what this page requires the payload to have** -- not a schema, a demand list,
and a byproduct of compiling rather than something anybody writes.

That covers structure and requiredness. It does not cover whether `p.price` is a number, and it
is not going to: **scalar types are declared where the payload is produced.**

This is what every framework that actually crosses a language boundary does. Tauri exports
TypeScript from Rust types with specta; Inertia generates TypeScript interfaces from the
backend's own data classes. Neither maintains a neutral schema, because a neutral type language
rich enough for the wire is a language to maintain, and gRPC and GraphQL show what that costs.

The frameworks that appear to have solved this more cleanly have not: SvelteKit, Remix and Next
put the loader and the component **in one TypeScript program**, so `tsc` checks the whole path and
there is no boundary to type across. That is not available here and the reason is the load stage
being deliberately outside the protocol.

## One direction, and the error lands where the name was used

The obligation runs one way. **The backend declares, the component conforms**, and a component
reading something the backend does not produce is an error reported at the component, where the
name was written.

An earlier draft had it running both ways as well: the backend checked against the component's
demand list, so a missing field failed the backend's own build. That is deleted, because both
checks catch the same mistake -- the component reads `p.name`, the backend does not supply it --
and only differ in which side they blame. Two reports of one error is not twice the safety, and
the weaker of the two would have been kept: the demand list knows whether a path exists and
nothing about its type.

One direction also settles the order, which two directions could not:

```
1  the backend declares its types           a serde struct, or the loader's return
2  a declaration is generated for the page  nothing to do when the backend is TypeScript
3  the component compiles to IR             syntax only, needing no types and no order
4  the component is checked against it      the error appears here
```

SvelteKit does not have this order because it does not need one: `svelte-kit sync` writes
`$types.d.ts` as plumbing without checking anything, and then a single `svelte-check` covers the
loader and the component together, since both are TypeScript. A component reading a field the
loader does not return is an ordinary type error at the usage site. That is not available across
a language boundary, so the plumbing step becomes a real generation step and the single check
becomes the last of four. What does not change is where the error surfaces, or that the author is
the one who decides whether the backend was missing a field or the component asked for the wrong
one.

The demand list survives, with a smaller job. Where a backend cannot export its types at all --
something written in Go, or an API somebody else maintains -- there is no declaration to check
against, and the paths the IR already enumerates are the only contract available. As the primary
mechanism it loses to a declaration, which carries types as well as names.

## Names

`data` is what the load stage produces. The **render input** is the root's props and the render
options, any JavaScript value, read by derive and inject. The **wire** is what crosses to the
client, data only. `payload` is the render input plus the derived fields, exists only between
deriving and injecting, and is never serialized. The two were one word for both until this file,
and the render input and the wire were one thing until the section that splits them.

## Open

- **Where request context sits.** `$.now`, `$.tz` and `$.locale` are named in
  [derivation.md](derivation.md) and can now hold real values rather than reconstituted ones, but
  where they live within `data`, and whether the load stage must supply them, is undecided.
- **Typing a derivation.** `p.price > 10` is extracted as source, so nothing checks it against the
  payload even where the payload is typed. A TypeScript loader could in principle have its
  derivations checked by `tsc`; a Rust one could not, and an asymmetry there is worse than
  neither.
- **More than one root.** The demand list assumes one entry component per response. What a page
  composed of several roots requires of `data` is not stated.
