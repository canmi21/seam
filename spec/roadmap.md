# What is left, and what each item waits on

The line that decides what belongs here is one sentence. **Before hydration the page is an MPA
and has to be what SvelteKit's SSR would have served; after hydration it is a standard Svelte SPA
and there is nothing to decide.** CTR differs from SSR in one thing only: the UI is rendered at
compile time rather than per request. What is given up is SSR's ability to run the UI per request
-- a component whose bytes can only be known by executing its script against the request. Every
other way of writing Svelte is in scope, and a construct is refused only for as long as nobody has
written it, never because it is the wrong way to write Svelte. [refusals.md](refusals.md) says what
a refusal means; this file says what is still refused and why each is where it is.

Nothing here is SeamJS. Routing, the layout chain, the load stage and where request context sits
are the meta-framework's, and this protocol is not yet the equivalent of SvelteKit. What is listed
under **blocked** is blocked on that, and nothing else.

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
`@tanstack` included, and nothing left to the render. What would still be left to it: a component
spread with an object the request hands it whole, whose keys nobody can list. The residual risk
noted in [pipeline.md](pipeline.md) -- a marker outside a function's domain -- now applies only to
such a component.

**The title rule is done.** It is Svelte's own and it was derivable; [ir.md](ir.md) has it. What it
found beside it: **a component with a `<svelte:head>` inside an `{#each}`** is refused now, where it
used to compile one head block short. `$.head` runs once per iteration, so the each has to stand
in the head stream as well as in the body, and the walk numbers a block in one stream. Ready, not
done, and small.

**The small ones are done.** Thirteen constructs, each a mechanism that already existed used once
more, each read out of the visitor that writes it, measured with Node, written, checked and
committed on its own: an each pattern's default, a getter binding, a select's `defaultValue`, a
content binding with children, a boundary's snippets by attribute, extra render arguments, a
class expression beside a directive, directives and mixed text beside a spread, a spread on
`<svelte:element>`, `{@attach}`, a component chosen through a table, an each over a `Map` or a
`Set`, and `{@const}` shapes inside a parameterised snippet. Each is recorded where its rule is,
in [refusals.md](refusals.md) or [derivation.md](derivation.md).

**Recursion in structure.** `<svelte:self>` is `build_inline_component(node, analysis.name)` in
`SvelteSelf.js`, a call to the component itself, and a snippet rendering itself is the same call.
The depth is the data's; the structure of each level is fixed. That is recursion in structure,
not in code, and the IR has no node for it: it needs a named fragment and a call to one. **Waits
on a decision about the IR node**, which [ir.md](ir.md)'s linear form can be decided with.

**Close, not build.** [ir.md](ir.md) asks whether hydration needs an empty text node to exist
where a value is empty. The bytes are Svelte's own server bytes, byte for byte, and hydration is
Svelte's client against them. The question is Svelte's and is answered by the oracle.

## Decided, and not built

**A script that substitution cannot reach, reading the request.** A name reassigned or an object
mutated after its declaration, where the statements read request data, is a program per request.
That is the one thing this line gives up, by definition, and it stays refused by decision rather
than by omission: building it would be carrying SSR's per-request rendering back in under another
name. Where the statements read nothing the request decides, the render already evaluates them and
the walk bakes the result (`wants` in `walk.ts`). Zero in press. [derivation.md](derivation.md)
holds the reasons and the three questions that would have to be answered if the line were moved.

## Not yet the time

**Legacy mode.** `<slot>`, `let:`, `<svelte:fragment>`, `export let`, `$:` and `$store`. Svelte 5
still compiles them (`SlotElement.js`, `LabeledStatement.js`) and each is a snippet, a prop or an
expression in a different spelling. Deprecated upstream and absent from runes-mode libraries.
Taken when a real component needs one, with the snippet machinery.

**Async Svelte.** `await` in markup and async SSR await real promises per request, which is
loading data. Non-async SSR writes the pending branch, which is what `{#await}` compiles to here.

**Several hydration roots on one page.** Recorded in [build.md](build.md) as neither refused nor
planned.

## Blocked, and on what

**The root is a layout chain around a page.** `children` at the entry, context an ancestor sets
(press's `QueryClient` from its layout), a snippet that arrived as a prop at the entry: three
spellings of "the root has no caller". The mechanism exists -- the oracle wraps the page in its
layouts and compiles that -- and what is missing is the map from a route to its layouts, which is
SeamJS.

**Where request context sits.** `$.now`, `$.tz`, `$.locale` are named in
[derivation.md](derivation.md) and [payload.md](payload.md) leaves their place in the payload to
the load stage. SeamJS.
