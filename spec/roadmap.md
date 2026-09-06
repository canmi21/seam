# What is left, and what each item waits on

The line that decides what belongs here is one sentence. **Before hydration the page is an MPA
and has to be what SvelteKit's SSR would have served; after hydration it is a standard Svelte SPA
and there is nothing to decide.** CTR differs from SSR in one thing only: the UI is rendered at
compile time rather than per request. What is given up is SSR's ability to run the UI per request
-- a component whose bytes can only be known by executing its script against the request. Every
other way of writing Svelte is in scope, and a construct is refused only for as long as nobody has
written it, never because it is the wrong way to write Svelte. [refusals.md](refusals.md) says what
a refusal means; this file says what is still refused and why each is where it is.

Nothing here is the framework layer. Routing, the layout chain, the load stage and where request
context sits are the meta-framework's, and this protocol is not yet the equivalent of SvelteKit;
[framework.md](framework.md) is where that layer is taken from Kit. What is listed under
**blocked** is blocked on that, and nothing else.

Every item below was read out of Svelte 5.57's source before it was written down, and the file
that decides it is named. That is the order of work for each: read the transform and the runtime,
form the rule, measure it with Node against Svelte's own output, then write ours, then the check
that holds the two together. See the workspace's `spec/agent-protocol.md`.

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
That is the one thing this line gives up, by definition, and it stays refused by decision rather
than by omission: building it would be carrying SSR's per-request rendering back in under another
name. Where the statements read nothing the request decides, the render already evaluates them and
the walk bakes the result (`wants` in `walk.ts`). Zero in press. [derivation.md](derivation.md)
holds the reasons and the three questions that would have to be answered if the line were moved.

**Async Svelte.** `await` in markup or at the top of a script, and the async server render that
goes with it, await a real promise per request while the bytes are written. That is loading data,
the load stage's by definition, and it is refused by decision: the walk turns an `AwaitExpression`
away by name, since Svelte itself compiles one only under `experimental.async`. Non-async SSR
writes the pending branch and awaits nothing, which is what `{#await}` compiles to here and is
kept.

**Several hydration roots on one page.** Out of scope by the line at the top of this file: after
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
that root as the entry, with `data_0` .. `data_n`, `params` and `form` as its payload. On press
every route compiles from its real root, layout and all, and matches Svelte's render of it; the
context press's layout sets reaches the page because the two are one walk. Held against Kit
itself too: the body a production build of press answers a request with, from its own `load`
functions, is byte for byte what the compiled root injected with that request's data gives, on
every route. The line at the top of this file is measured, not claimed.

**Where request context sits: settled in shape.** In the root's props, `params` and `form` today
and `page` with them once the load stage exists; a derivation reads them as props and never
reaches for the request. What remains is the load stage itself, framework.md's second step.
