# What is left, and what each item waits on

**Two different boundaries run through this specification and they are not the same boundary.**
The first decides whether a thing is in scope at all; the second decides which half of the work it
belongs to. Both have been called "the line", which is why they are named here and referred to by
name everywhere else.

## The scope line: what compile-time rendering is for

The line that decides what belongs here is one sentence. **Before hydration the page is an MPA
and has to be what SvelteKit's SSR would have served; after hydration it is a standard Svelte SPA
and there is nothing to decide.** CTR differs from SSR in one thing only: the UI is rendered at
compile time rather than per request. What is given up is SSR's ability to run the UI per request
-- a component whose bytes can only be known by executing its script against the request. Every
other way of writing Svelte is in scope, and a construct is refused only for as long as nobody has
written it, never because it is the wrong way to write Svelte. [refusals.md](refusals.md) says what
a refusal means; this file says what is still refused and why each is where it is.

## The layer line: protocol, and the framework around it

Nothing here is the framework layer. Routing, the layout chain, the load stage and where request
context sits are the meta-framework's, and this protocol is not yet the equivalent of SvelteKit;
[framework.md](framework.md) is where that layer is taken from Kit. What is listed under
**blocked** is blocked on that, and nothing else.

The two are independent, which is the reason for naming them apart. A construct can be in scope by
the scope line and still not be this protocol's by the layer line: the load stage is exactly that,
kept whole and Kit's. So "not here" and "not at all" are different answers, and an item's section
below says which one it got.

Every item below was read out of Svelte 5.57's source before it was written down, and the file
that decides it is named. That is the order of work for each: read the transform and the runtime,
form the rule, measure it with Node against Svelte's own output, then write ours, then the check
that holds the two together. See the workspace's `spec/agent-protocol.md`.

## Where this file sits

This is the list of what is left, ranked. The order the work is *proved* in is
[conformance.md](conformance.md): Svelte's own samples, then SvelteKit's own test apps, then an
application written for Kit and moved. Everything below belongs to the first of those.

## Wrong bytes, which is not a refusal and outranks everything below

A refusal stops a build and names a file. What follows here compiled and wrote bytes that are not
Svelte's, which nothing said. [suite.md](suite.md) has the measurement and
[conformance.md](conformance.md) why this ordering is not the obvious one. There were 115; the
first entry below took it to 42 and the anchor row to 39, and all of them are read out here rather
than counted -- the suite
prints the first byte the two renders disagree on, which is what made reading them a morning
instead of a project.

**A default on the entry's own props was dropped: done.** It was 78 of the 115. The default now
stands over the payload's key as one derivation computed before anything reads it, which is what
`$props()` destructuring does and what keeps a read of the prop the path it was. Rewriting each
read instead was written first and is what `Skeleton.defaults` records against: it is equally
correct and turned every read of every defaulted prop into a derivation of its own, which on Kit's
generated root -- `data_0 = null` per level -- is every read on every page.

Three samples moved from writing the wrong bytes to being refused, all of them a default that
reads a store: that is the store gap under **ready**, met one step earlier than usual, and the
message it gives is the derivation evaluator's rather than a refusal naming a file. One moved the
other way, `component-binding-parent-supercedes-child-c`, and it is counted below.

### The 42 that remain, by cause

| | | |
| --- | --- | --- |
| 8 | **a component `bind:` the server writes back** | Read out, half built. See below. |
| 5 | **a later attribute has to beat a spread's, and `value` has to reach a child's `<option>`** | `{...{ defaultValue: 'b' }} defaultValue="a"` marks both options; `bind:value {...props}` takes the binding rather than the spread; `<select value>` does not reach an `<option>` a component renders. One rule about order, one about where the select pass looks. |
| 6 | **a name that holds client state is read as though the server had it** | `$state` mutated by an effect or a callback, a reactive block that runs again, an each key compared by identity. The server writes the value before any of that, and these say we write a different one. Each needs reading on its own; they are one group only in that none is markup. |
| 3 | **entry props the walk cannot name** | a key that is a string literal -- `const { 'kebab-case': x } = $props()` -- and a rest, `...others`, which for the entry is the payload's other keys. `propsOf` returns null for the first and leaves the second unfilled. |
| 2 | **a quoted attribute holding one expression is passed as text** | `<Widget baz='{40 + x}' />` passes `"42"` where Svelte passes `42`. Quotes around a single tag do not make it text. |
| 2 | **`{#each}` over a string** | Svelte iterates the characters; this renders nothing. A `Map` and a `Set` were taken and a string was not. |
| 2 | **`style:` in its shorthand form** | `<p style:color>` reads the local `color`; the attribute is not written at all. |
| 2 | **a doubled space after a block** | `<!--]-->  1` where Svelte writes `<!--]--> 1`. The stamp's whitespace rule, one case short. |
| 2 | **a default with a side effect is evaluated a different number of times** | a snippet parameter default that increments a counter, a child's defaults evaluated lazily. The value is right and the count of evaluations is not, which the bytes show because the counter is rendered. |
| 2 | **Svelte writes a snippet that was never rendered** | `snippet-children-without-render-tag`: children given with no `{@render}` reach the output as the function's own source. Whether that is worth reproducing is a question rather than a gap. |
| ~~3~~ | ~~**the wrong branch, or a missing anchor**~~ | Done, and it was two faults rather than one. See below. |
| 1 | **a namespaced component** | `<Components.Foo />` gets a block anchor pair Svelte does not write. |
| 1 | **attribute order beside a directive** | `style` before `class` where Svelte writes `class` before `style`. |
| 1 | **a prop default a global shadows** | `export let Math = { min: ... }`. The guard is `typeof Math === 'undefined'`, and a global of that name makes it false, so the default never fires. `typeof` is what lets the guard read a key the payload lacks; it cannot tell that from a global. |
| 2 | **two of their own** | an `<option disabled>` on the wrong item, and a `--css-var` custom property that is not written. |

**The three anchor cases were read first** even though they were not the largest group. Every
other row is a construct the compiler does not handle; those three were the compiler handling one
and getting it wrong, which is the failure this whole arrangement exists to catch. They were two
faults:

**Two were a marker standing where a value decides.** `{#if visible}` inside a component the walk
could not enter -- `<slot>` stopped it -- with `visible` handed in as a marker. Every marker is a
non-empty string, so the branch was taken and the whole component came back as static bytes with
no block and no hole. What let that through was `dead()`, whose probe put a second marker in the
value's place and asked whether the bytes changed: that asks whether the component *writes* the
value and cannot ask whether it *decides* on it, two non-empty strings being the same truth. The
probe now also puts the empty string there, which differs in truthiness, in length and as a
number. Both are refused now, and a third sample that had been passing --
`component-yield-nested-if` -- was a false pass the same probe had been relaxing.

**One was `<svelte:self>`, which Svelte anchors unlike a component.** `is_standalone` in
`3-transform/utils.js` wants the fragment's one trimmed node to be a `Component`, and
`<svelte:self>` is a `SvelteSelf`, so it never qualifies and always gets the `<!---->` that
`shared/component.js` pushes after a component. The stand-in the walk writes is a component tag,
so it qualified and the anchor went missing, once per level of a recursion. The stand-in writes it
itself now, where the fragment is one Svelte reads the flag for -- which is every block's, and not
an element's or a `<title>`'s, because `RegularElement.js` and `TitleElement.js` take `trimmed` off
`clean_nodes` and call `process_children` without going through `Fragment.js` at all.

### A component `bind:`, which is a fixed point the server iterates

The largest of the rows above, and the mechanism is Svelte's, read rather than inferred:

1. Any `bind:x` on a component, `x` not `this`, sets `analysis.uses_component_bindings` on the
   **parent** (`2-analyze/visitors/shared/component.js`).
2. That wraps the parent's whole template in `do { $$settled = true; ... } while (!$$settled)`,
   with `$$renderer.subsume` taking the last pass (`transform-server.js`).
3. The binding becomes `get x() { ... }` and `set x($$value) { expr = $$value; $$settled = false }`
   in the child's props, both pushed last so a spread cannot overwrite them
   (`3-transform/server/visitors/shared/component.js`).
4. The child ends its render with `$.bind_props($$props, { ...its bindable props })`, and
   `bind_props` in `internal/server` assigns each back **where the parent passed `undefined` and
   the parent's props object has a setter for that key**. So a child's default flows up into the
   parent, and the parent renders again with it.
5. Which props are in that object is `binding.kind === 'bindable_prop'`: in legacy mode every
   `export let`, in runes mode only a `$bindable()` one.

**Step 5 is where this compiler lost it, and it was our own rewrite.** `runed()` turns
`export let x = 1` into `let { x = 1 } = $props()`, which is a plain prop, so the child compiled to
no `$.bind_props` call at all and the propagation disappeared. It now writes
`let { x = $bindable(1) } = $props()`, which produces the same call Svelte's own output has --
with a default, without one, and for several props at once. There is a check that asks Svelte for
both and compares.

**On its own that changes nothing**, and the suite says so: 1125 identical before and after. The
setter it needs never exists, because `unbind.ts` rewrites the parent's `bind:x={e}` to `x={e}` on
the strength of a claim that reads "only the getter runs while the bytes are written" -- which
`transform-server.js` shows is false. That claim is the other half, and taking it out is the work
that remains.

**What that work has to decide, which the samples split cleanly.** Propagation fires only where
the parent passed `undefined`, so:

- The child's bound prop has **no default** and is not assigned at the top level (which is refused
  already): nothing can propagate, and the binding compiles as it does today.
- The parent binds a **local** -- `component-binding-aliased` is `let bar;`, `blowback-d` is a
  `const` object -- so whether it is `undefined` is known at compile time, and the fixed point is
  a compile-time render. These are compilable and are the reason not to refuse the row wholesale.
- The parent binds a **prop** -- `component-binding` is `export let x` then `<Foo bind:x/>` -- and
  whether the child's default flows up depends on whether the request sent `x`. That is a decision
  a marker cannot stand in, so it is a structure to enumerate or a refusal, and not something to
  bake.

## Newly refused, found by the same run

Constructs the walk had never met, each a gap. `DeclarationTag` -- `{const x = 0}` and
`{let x = $derived(...)}` -- is in Svelte's public AST union and was in neither the switch nor
`REFUSED`, so it reached the default arm. `css: 'injected'` puts the stylesheet in the head, which
the head assembly does not recognise as either a block or a stamp. `$state.eager` is a rune
nothing reads. And a `<svelte:boundary>` whose body throws is caught by Svelte and rendered as
`failed`; here the throw escapes the compile -- which is a decision where the throw depends on the
request and a gap where it does not, and the two have not been told apart yet.

## Ready, and not done

**The walk enters a package's component.** Done; [refusals.md](refusals.md) has what it took --
resolution through `exports` under the `svelte` condition and the package's re-exports, a rest as
the caller's other attributes, a prop-reading declaration neutralised only where the prop varies,
an id as a marker the component computes with, an inert spread as bytes, modules left at their
real paths. On press every route is byte-identical with every component entered, `bits-ui` and
`@tanstack` included, and nothing left to the render. The one shape that would still have been
left to it -- a component spread with an object the request hands it whole -- is bound by what the
child declares, [refusals.md](refusals.md) has how. The residual risk noted in
[pipeline.md](pipeline.md) -- a marker outside a function's domain -- now applies only to a
component the walk could not enter for a reason it names.

**The title rule is done.** It is Svelte's own and it was derivable; [ir.md](ir.md) has it.

**A body block a head sits inside stands in the head stream: done.** A headed component inside an
`{#each}` used to be refused and one inside an `{#if}` used to compile wrong, its head block in
the head whichever branch the request took -- and the surface checks compared the body alone, so
nothing said so. Both streams are compared now, the block is mirrored into the head, and
[refusals.md](refusals.md) has how. An `{#await}` stands in the head too, opened around its
expression since its pending branch is the one place a `{@const}` cannot go. A recursive component
that writes a head stands in it as a fragment of its own, called per level. What stays refused is
a head that reaches a fragment from a component inside its body, found after the calls were
written; [refusals.md](refusals.md) has the shape it waits on.

**The small ones are done.** Thirteen constructs, each a mechanism that already existed used once
more, each read out of the visitor that writes it, measured with Node, written, checked and
committed on its own: an each pattern's default, a getter binding, a select's `defaultValue`, a
content binding with children, a boundary's snippets by attribute, extra render arguments, a
class expression beside a directive, directives and mixed text beside a spread, a spread on
`<svelte:element>`, `{@attach}`, a component chosen through a table, an each over a `Map` or a
`Set`, and `{@const}` shapes inside a parameterised snippet. Each is recorded where its rule is,
in [refusals.md](refusals.md) or [derivation.md](derivation.md).

**Recursion in structure is done.** A snippet or component that renders itself is a fragment the
runtime calls, with `call` nodes where it is entered; [ir.md](ir.md) has the node and how the body
gets its region. The three shapes that waited for a case are in: a pattern as a recursive
snippet's parameter, `<svelte:self>` in the entry, and a cycle through a second component. Taking
them found that a call standing alone in an each changed the bytes around it, and the stand-in
now writes its marker itself. A rest is a parameter bound per call, and a component's own head
has the fragment stand in the head stream; what stays refused is a head a component inside the
body writes.

**Close, not build.** [ir.md](ir.md) asks whether hydration needs an empty text node to exist
where a value is empty. The bytes are Svelte's own server bytes, byte for byte, and hydration is
Svelte's client against them. The question is Svelte's and is answered by the oracle.

**A prop written as `export let` is done.** Svelte 4's spelling, which Svelte 5 still compiles;
measured byte for byte against `$props()` with the same defaults, so the file is rewritten to
that before anything reads it (`runed()` in `legacy.ts`). `export const` and `export function`
are readonly exports and are refused by name.

**A store read in markup.** `{$s}` is refused today as a name the data does not carry, in runes
mode as much as in legacy. It renders the same bytes in both, and `$s` is `get(s)` from
`svelte/store`, a pure read of a value the script made -- a substitution like any other where the
store is built from props. Ready, not done, and small; waits for a component that reads one.

## Decided, and not built

**A script that substitution cannot reach, reading the request.** A name reassigned or an object
mutated after its declaration, where the statements read request data, is a program per request.
That is the one thing the scope line gives up, by definition, and it stays refused by decision
rather than by omission: building it would be carrying SSR's per-request rendering back in under
another name. Where the statements read nothing the request decides, the render already evaluates
them and the walk bakes the result (`wants` in `walk.ts`). Zero in press.
[derivation.md](derivation.md)
holds the reasons and the three questions that would have to be answered if the scope line were
moved.

**Async Svelte.** `await` in markup or at the top of a script, and the async server render that
goes with it, await a real promise per request while the bytes are written. That is loading data,
the load stage's by definition, and it is refused by decision: the walk turns an `AwaitExpression`
away by name, since Svelte itself compiles one only under `experimental.async`. Non-async SSR
writes the pending branch and awaits nothing, which is what `{#await}` compiles to here and is
kept.

**Several hydration roots on one page.** Out of scope by the scope line: after
hydration the page is one Svelte SPA, and Svelte hydrates one root against one payload. Astro's
islands are a different arrangement, and [build.md](build.md) records that this artifact does not
express it and is not going to.

## Not yet the time

**Slots.** `<slot>`, `let:` and `<svelte:fragment>`, the legacy spelling of snippets. The plan
was to rewrite them to snippets the way `export let` is rewritten to `$props()`, and it was
measured before it was written: **the bytes differ**. `$.slot` in `internal/server/index.js`
writes `<!--[-->` and `<!--]-->` around what fills a slot and around its fallback, where a
`{@render}` writes none, and an element with `slot="x"` keeps the attribute in the output. So a
slot is a block of its own in the walk, read out of `SlotElement.js`, with the fallback as an
alternate and `let:` as its parameters -- the snippet machinery's shape with different anchors.
Deprecated upstream and absent from runes-mode libraries; taken when a real component needs it.

`$:` is not a legacy question: on the server it is a plain statement run once, and one that
assigns a declared name from request data is the per-request script decided against above.
`$store` is not one either; see the store item under **ready**.

## Blocked, and on what

Nothing, now. The two that were are the framework layer's first step, done: see
[framework.md](framework.md).

**The root is a layout chain around a page: done.** `pkgs/routes` reads `src/routes` with Kit's
own `create_manifest_data`, generates one root per route in the shape Kit's `write_root` generates
-- the page nested in its layouts as dynamic components, sized to the project's depth, measured
byte for byte against Kit's root rendered with the props Kit gives it -- and the compiler takes
that root as the entry, with `data_0` .. `data_n`, `page` and `form` as its payload. On press
every route compiles from its real root, layout and all, and matches Svelte's render of it; the
context press's layout sets reaches the page because the two are one walk. Held against Kit
itself too: the body a production build of press answers a request with, from its own `load`
functions, is byte for byte what the compiled root injected with that request's data gives, on
every route. The scope line at the top of this file is measured, not claimed.

**Where request context sits: settled, and served.** In the root's props, the `page` Kit builds
per request and `form`, with `params` passed down as `page.params` the way Kit's root passes it; a
derivation reads them as props and never reaches for the request. The load stage is Kit's own,
running inside Kit's own server with only the render replaced: framework.md's second step, done.
