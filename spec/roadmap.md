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

**The one that decides several others: the walk does not enter a package's component.**
`walk.ts` walks only a component this project holds and leaves a package's to Svelte's render. That
was the expedient while spreads and passed snippets were refused, and both are handled now. A
package's `.svelte` is a component like any other, and leaving it to the render is where four
refusals come from: a value a child transforms, a supplied snippet reading a parameter, a choice a
package makes on a request value, and the marker-outside-a-domain risk in
[pipeline.md](pipeline.md). What stood in the way is gone: `{...restProps}` is `$.attributes`,
carried; a passed snippet is inlined; context is a `Map` on the server (`internal/server/context.js`)
whose value is an ancestor's expression, which is substitution and not code. Large, and the next
major item after the small ones below.

**The title rule is Svelte's, and it is derivable.** [ir.md](ir.md) said the rule for which of two
titles wins is not derivable and would have to be stated. `internal/server/renderer.js` states it:
`set_title(value, path)` keeps the title whose render path compares later, lexicographically, and
`#close_render` appends it after the head. So a title inside a block and two titles on one page
are both decided per structure, and a page's title beating its layout's in SvelteKit is this rule
rather than the framework's. Needs no routing: the wrapper the oracle already builds gives the
order.

**Small, each a mechanism that exists used once more.** These are the ones being taken now, in
this order, one commit each:

| construct | what Svelte does, and where | what ours does |
| --- | --- | --- |
| `{#each xs as { a = 1 }}` | `EachBlock.js` destructures per item with the default | a per-item derivation `(a === undefined ? 1 : a)`, which [derivation.md](derivation.md) settled |
| `bind:value={get, set}` | `shared/element.js` reads `get()` on the server | the value is that call, an expression |
| `<select defaultValue>` | the same path as `value` in `RegularElement.js` | the same choice hole |
| `bind:innerHTML` with children | `RegularElement.js:179`: the body only when the binding is falsy | two outcomes, an if |
| `<svelte:boundary pending={p}>` | `SvelteBoundary.js`: an attribute and a `{#snippet pending()}` are one thing | the attribute's snippet is the pending body |
| `{@render s(a, b)}` with one parameter | `RenderTag.js` passes the arguments through; JavaScript drops the extra | accepted; the refusal was ours |
| `class={expr}` beside `class:` | `to_class(value, hash, directives)` in `internal/shared/attributes.js` | carry `to_class` as `attributes` is carried, one hole |
| `class:`/`style:` beside `{...}` | the third and fourth arguments of `$.attributes` | read from the compiled call, as the hash already is |
| `a="x{y}"` beside `{...}` | one template literal in the object | the same literal |
| `{...}` on `<svelte:element>` | `$.element(renderer, tag, attributes_fn, children_fn)` | the attribute run is a hole inside the `element` block that already exists |
| `{@attach}` on an element | no server visitor emits it; only `shared/component.js` puts it in a component's props | dropped, as `use:` is |
| `<svelte:component this={T[data.k]}>` | `SvelteComponent.js` calls whatever the expression is | a decision whose domain is the literal's keys; otherwise the declared domain [build.md](build.md) already has |
| `{#each}` over a `Map` or `Set` | `ensure_array_like` takes `Array.from` of an iterable | the injector iterates rather than indexing |
| `{@const}` in a snippet with parameters, more shapes | `ConstTag.js` is one visitor for all of them | unmeasured; measure, then take what fails |

**Recursion in structure.** `<svelte:self>` is `build_inline_component(node, analysis.name)` in
`SvelteSelf.js`, a call to the component itself, and a snippet rendering itself is the same call.
The depth is the data's; the structure of each level is fixed. That is recursion in structure,
not in code, and the IR has no node for it: it needs a named fragment and a call to one. **Waits
on a decision about the IR node**, which [ir.md](ir.md)'s linear form can be decided with.

**Close, not build.** [ir.md](ir.md) asks whether hydration needs an empty text node to exist
where a value is empty. The bytes are Svelte's own server bytes, byte for byte, and hydration is
Svelte's client against them. The question is Svelte's and is answered by the oracle.

## Not yet the time

**A script that substitution cannot reach, reading the request.** A name reassigned or an object
mutated after its declaration, where the statements read request data, is a program per request.
That is the one thing this line gives up, by definition. Where the statements read nothing the
request decides, the render already evaluates them and the walk bakes the result (`wants` in
`walk.ts`). Zero in press. [derivation.md](derivation.md) names the condition for reopening it.

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
