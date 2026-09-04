# What a refusal means

The compiler refuses things. An author who meets one needs to know which of three situations they
are in, because the three ask for different actions, and until this file existed the compiler said
the same kind of thing for all of them.

## The target is zero refusals, and that is a statement about scope

**In principle every way of writing Svelte has to compile.** There is no question of whether a
construct *deserves* to be refused, and a refusal is never a judgement that somebody wrote
something the wrong way. Every entry in this file is a gap in the work, and the work is finished
when the file has nothing left in it.

**The reason is structural rather than aspirational.** This compiler is arranged the way SvelteKit
is; what changed is *when* the render happens. So anything SvelteKit serves should be portable to
compile-time rendering, with one exception that is a definition rather than a limit: an application
that genuinely needs arbitrary code executed per request, against something only that request
knows. Everything else -- an article, a form, an admin screen, a dashboard -- is in scope.
Interaction is not the line. A dashboard that filters, sorts and opens dialogs is a page whose
bytes are fixed and whose behaviour is the client's, which is exactly what the client half is for.

**So a refusal is a research task with a known method.** Read Svelte's source, and SvelteKit's,
find what they do with the construct at request time, and move that to compile time. Nearly every
item settled so far turned out to be less work than the refusal implied once the source was read,
and several turned out to be defects rather than gaps. Where the source does not yield an answer --
where the construct genuinely needs something this arrangement has no place for -- **that is worth
stopping for and asking**, and the answer gets written down here with what it depends on. That case
is rarer than it looks. The default expectation is that this handles it as cleanly as SvelteKit
does, because it is doing less than SvelteKit does.

## Every refusal is a compile-time error

**There is no runtime fallback.** A component the compiler cannot compile does not quietly get
rendered by Svelte at request time instead.

Three reasons, and the first is the only one that would still hold if the others changed.

**It would break the one promise the whole design rests on.** Rendering a component at request
time is running UI on the server, which is the thing compile-time rendering exists not to do. A
fallback that does it for some components does it, and the guarantee stops being one.

**A backend that is not Node could not do it at all.** A Rust server has no Svelte renderer and is
not going to acquire one, so a fallback would make two backends differ in which pages they can
serve. That is a divergence, and divergence is what this protocol governs.

**The cost of not having one is smaller than it looks.** Measured across what is refused today,
there is no category of *this will never work* -- see below.

## Not permanently. The condition is named

This is a decision for now, not for ever, and the thing that would reopen it is written down so
that reopening it is not a matter of mood.

**When compile-time and request-time rendering can both appear on one page** -- different
components on the same response, some compiled and some rendered -- the question becomes whether
to offer the choice to authors rather than whether the machinery could exist. That is when it gets
asked again. Until that machinery is ready the answer is no, and a refusal is an error.

## The three kinds, and what each has to say

One rule, three ways of saying it. This is the same shape as the decision in
[derivation.md](derivation.md) not to grade strictness by where a value lands: the distinction
lives in the diagnostic, never in a second set of rules.

| | what it means | what the message owes the reader |
| --- | --- | --- |
| **not implemented** | the shape is understood and measured, and nobody has written it | what it is, and that it is coming |
| **not decided** | the protocol has no answer and guessing would be worse than waiting | where the question is recorded |
| **not expressible as written** | there is a legal way to write this | **the other way of writing it** |

The third is the only one where the author can act now, so a message that leaves them without the
alternative has failed. `Date.now()` is refused because it does not read the same twice, and the
message that does not mention `$.now` has told them their code is wrong and nothing else.

## The list lives in a check, not in this file

**What is refused today is `pkgs/skeleton/conformance/run.ts`**, which compiles each construct and
records whether it was turned away. This file used to carry the list instead, and the list was
maintained by recollection. Measured against the compiler, it was wrong in both directions at
once: it called an each block with a key and `{:else}` on an each unwritten when both compiled,
and it did not mention `{@const}`, which compiled and rendered the wrong bytes.

A list nobody runs is a claim. The check is the list, and this file keeps only the reasoning:

| | |
| --- | --- |
| `{#await}`, `{#key}`, an `{:else}` on an each | measured, trivial, unwritten |
| a snippet rendered twice, or a parameter with a default | the body would have to stand in two places, or a name has no way in from the argument |
| `{@render}` of a snippet from a prop | composition in the other direction; see below |
| an expression over what an each binds | computed once against the payload; per-item is not decided |
| `style:`, `<select value>`, `translate={true}` | decidable by enumeration; `class:` was the first of these and is done, see below |
| a `bind:` the server writes | there is nowhere to plant the marker: `bind:` takes a name, not an expression |
| `{...spread}` on an element | an unenumerable decision; see below |
| per-item derivation, which of two titles wins | not decided |

**So "a subset of Svelte" is a statement about how far the work has got, not about where a line
was drawn.** The subset grows, and the README should say that rather than implying a boundary
nobody has found.

## How far the subset is from the ecosystem, measured

The refusal surface says what is turned away. It does not say what that costs, and guessing at
that is how a compiler comes to spend its effort on the wrong refusal. So the same rules were run
statically over every `.svelte` file on this machine -- 4323 of them, a real application and the
dependency tree it installs.

**44 of the 4323 would be refused for nothing: 1.0%.** What stops the rest, most common first:

```
4157  {...spread}                             96%
 600  a render of a snippet from a prop
  81  a bind: the server writes  63  {@const}
  15  a name assigned after it is declared    12  {#key}
  11  class:                      7  style:
```

**The ranking is different for the application's own components**, and the difference is not noise.
Of the 4323, only 42 are written by the author rather than installed, and 16 of those compile:

```
   9  class:                     7  {@const}
   7  a render of a snippet from a prop        4  a snippet rendered more than once
   3  a bind: the server writes  3  {...spread}
   2  style:                     1  <svelte:element>
```

Five things have been taken off these lists by consulting them, and all of them moved the second
far more than the first. Runes led the application's own at 33 of 42 and sat third in the whole set at
584; an each with a key or an index led what was left, at 18 and 8; `bind:` led what was left after
that, at 12, and three quarters of its uses turned out to be bindings the server writes nothing
for; a local snippet was the tractable half of what came next, first without parameters and then with
them. The application's own components went from 2 that compile to 8, 12, 15, and 16, where the
whole set went from 28 to 44. The last of those moved neither count, because every component it
unblocked is held by something else as well -- which is what a ranking cannot tell you until the
thing above it is gone. That is what a ranking is for: `{...spread}` at 96% is what the first list is really about, and
it is a different kind of work.

## The same question asked of the compiler, over a real application

The numbers above come from a script that re-implements the rules and reads an AST. That is a
proxy, and a proxy answers for the rules rather than for the compiler. Asked of `skeleton()`
instead, over one application's own 41 components -- the site in `repos/press`, copied out and
rendered in full, children and installed packages included -- **10 compile and 31 do not**, and
three of the things that stopped the other 31 were not refusals at all.

**Two were defects, and both were in the compiler's own diagnostics.** A shorthand attribute ended
the compile inside Svelte's parser: `{n}` is `n={n}`, and the braces of the short form hold a bare
name and nothing else, so the marker this pass writes there produced `attribute_empty_shorthand` --
an error naming the author's file and saying something untrue about it. It blocked four of the nine
routes. And `{@render children()}` was refused by a branch nothing could reach: the check covered
`{@render data.children()}`, whose callee is a member and so has no name, while a bare `children`
looked declared because its own render tag had put the name in the snippet table. It passed the
walk and failed inside Svelte with `children is not a function`. A third defect was in the render
harness, which rewrote a child's relative imports only when they were single-quoted -- which is not
how a package writes them.

**Neither was in the ranking, because a re-implementation cannot report what it does not
reproduce.** The proxy is still worth having for the 4323: staging and rendering that many is a
different kind of run. But the ranking that decides what to work on next is the compiler's own.

### What stops the 31, first thing per component

```
   6  class:                                   5  a block inside an else
   5  {@render} of a snippet from a prop       3  {...spread}
   2  a bind: the server writes                2  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  {#each} over a destructuring             1  a snippet rendered twice
   1  <svelte:element>                         1  style:
   1  a marker where the child computes with the value
   1  a marker where the child calls the value
   1  context the entry has no ancestor to provide
```

**`class:` was the first of these to be taken, and 10 became 13.** What is left after it, first
per component, is below. Six of the counts moved without anything being unblocked, which is what a
first-refusal ranking does: a component held by two things reports the second once the first is
gone.

```
   6  a block inside an else                   5  {@render} of a snippet from a prop
   3  {...spread}                              2  a bind: the server writes
   2  style:                                   2  a snippet rendered twice
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  {#each} over a destructuring             1  <svelte:element>
   1  a marker where the child computes with the value
   1  a marker where the child calls the value
   1  context the entry has no ancestor to provide
```

**Then the else, and 13 became 15.** What is left:

```
   5  {@render} of a snippet from a prop       3  {...spread}
   3  a name assigned after it is declared     3  a snippet rendered twice
   2  a bind: the server writes                2  style:
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  {#each} over a destructuring             1  <svelte:element>
   1  a marker where the child computes with the value
   1  a marker where the child calls the value
   1  context the entry has no ancestor to provide
```

**Then the repeated snippet, and 15 became 17.** What is left, with the five that only a scan
counts marked as such:

```
   5  {@render} of a snippet from a prop  -- none of them blocks the page it is used on
   3  {...spread}                              3  a bind: the server writes
   3  a name assigned after it is declared     2  style:
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  {#each} over a destructuring             1  <svelte:element>
   1  a marker where the child computes with the value
   1  a marker where the child calls the value
   1  context the entry has no ancestor to provide
```

**Then the each pattern, and 17 became 18.** What is left:

```
   5  {@render} of a snippet from a prop  -- none of them blocks the page it is used on
   3  {...spread}  -- none of them blocks the page it is used on either
   3  a bind: the server writes                3  a name assigned after it is declared
   2  style:                                   1  <svelte:element>
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  a marker where the child computes with the value
   1  a marker where the child calls the value
   1  context the entry has no ancestor to provide
```

**Then the declaration with no value, and 18 became 20.** What is left:

```
   5  {@render} of a snippet from a prop  -- none of them blocks the page it is used on
   3  {...spread}  -- none of them blocks the page it is used on either
   3  a bind: the server writes                2  style:
   2  a marker where the child computes with the value
   1  <svelte:element>
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  a marker where the child calls the value
   1  context the entry has no ancestor to provide
```

**Then `bind:`, and the count stayed at 20.** Every component it unblocked met something else, and
one of those is a shape that had not been seen before:

```
   5  {@render} of a snippet from a prop  -- none of them blocks the page it is used on
   3  {...spread}  -- none of them blocks the page it is used on either
   2  context the entry has no ancestor to provide       2  style:
   2  a marker where the child computes with the value
   1  a component that rendered none of the markup it was given
   1  a marker where the child calls the value           1  <svelte:element>
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  a name the markup reads that nothing binds
```

**Then `style:`, and 20 became 22.** What is left:

```
   5  {@render} of a snippet from a prop  -- none of them blocks the page it is used on
   3  {...spread}  -- none of them blocks the page it is used on either
   2  context the entry has no ancestor to provide
   2  a marker where the child computes with the value
   1  a component that rendered none of the markup it was given
   1  a marker where the child calls the value           1  <svelte:element>
   1  a snippet a component is passed, with parameters
   1  {@const} inside a snippet that takes parameters
   1  a name the markup reads that nothing binds
```

**Eight of the eighteen still measure the scan.** Of the ten that are real, five are one question
asked five ways: what a child may do with what it is given. See the table above.

**A component that rendered none of the markup it was given** is press's search dialog:
`<Dialog.Root {open}>` with `open` a piece of client state that has no value yet, so bits-ui writes
nothing and every marker planted inside it has nowhere to come back from. **That is what Svelte's
own server does** -- a closed dialog is not in the response, and the client opens it -- so the right
output is nothing, and the markers are lost on purpose rather than swallowed.

Telling the two apart is the item. A child that mangles one value loses one marker while its
neighbours survive; a child that renders nothing loses every marker in that subtree together and
writes no marker of its own. What makes it safe is that the decision was taken from values that do
not vary per request: one taken from a marker would have rendered, and shown up as a block count
that does not match. It depends on nothing else being built first.

**Eight of the eighteen are the scan rather than the compiler.** Both marked rows are components
that only ever appear inside somebody else's markup, and they compile there. What is actually left
in the way of a page is ten.

Three of those were reported for the first time rather than newly caused: a name assigned after it
is declared was always there, behind a block refusal that ran first.

**`{...spread}` is third here, where the whole-ecosystem list has it at 96%.** That is the
difference the entry-only walk makes, and it is the reason this measurement had to be redone: a
library wraps and forwards, an application does not.

### Four of them are not gaps in the markup, and three had no name before

The bottom of that list is a different kind of thing from the top of it. Each of these compiled
past every rule and then failed inside Svelte, which means the author gets Svelte's words for a
decision this compiler made.

**`{#each xs as [k, v]}` crashes.** The render replaces the each's source with `[0]` so the body
runs once, and a destructuring context has nothing to be taken apart from -- `number 0 is not
iterable`. It is the same problem a snippet parameter already solved, where the record says what a
pattern has to be handed; the each block never got the same treatment.

**A marker is a string, and a child may do more with a prop than write it.** `new Date(marker)`
gives `Invalid time value`; a prop that is a function, called by the child, gives
`callableMessage is not a function`. Substitution assumes what it substitutes into is inert, and a
component boundary is exactly where that stops being true. The hole invariant would catch the
quiet version of this -- a value transformed rather than written comes back changed and is not
consumed -- so what is missing is the compile-time refusal, not the detection.

**A component that reads context has no ancestor to provide it.** The entry is compiled alone, and
`getContext` in press's article route finds no `QueryClient` because the provider is in the layout.
This is the same question as `{@render children()}` seen from the other side, and both say that
**a route is a page inside its layout rather than a page**. What composes the two is not decided.
See spec/build.md.

### A layout around a page already works, and the word for what does not is composition

`{@render children()}` and the missing `QueryClient` were written above as one question, and the
guess at what they waited on -- routing -- was wrong. Measured: an entry that composes the two,

```svelte
<Layout><Page /></Layout>
```

compiles today. The layout is a child, so its `{@render children()}` is never walked; Svelte
renders it, and the page inside it is the implicit `children` snippet, which is a snippet with no
parameters written inside a component's tag and already works. The provider and the consumer are
both inside one render, so the context is there. Both refusals came from compiling `+layout.svelte`
as an entry, which is not what a route is. **Nothing here waits on a routing decision.** What is
missing is only that some step has to write that wrapper, which is the plugin's, next to the
hydration entry it already generates. See spec/build.md.

### What a child may do with a prop, measured

The entry-only walk holds because request-varying data reaches a child only as props, and a prop is
a marker. That is sound exactly as far as the child only writes the marker out. Everything else:

| the child | what happens |
| --- | --- |
| writes it | compiles |
| computes with it | lowering: the value never comes back, so it would be dropped |
| branches on it | lowering: the render holds more blocks than the source declared |
| iterates it | lowering: the render holds more blocks than the source declared |
| calls it | Svelte, mid-render: `f is not a function` |

**Nothing is silent, and that is the invariant doing its job.** But none of the four messages says
what happened, and three of them point somewhere else entirely: the first blames `<svelte:head>`,
and the middle two describe block bookkeeping to an author who wrote one component tag. A marker
crossing a component boundary into anything but a write is one situation and owes one message,
which names the component and the prop.

**Half of the application is on the wrong side of that table.** Of press's 41 components, 21 decide
their own markup shape from a prop -- an `{#if}` or an `{#each}` over something `$props()` bound --
so they cannot be somebody else's child while the walk stops at the entry. `<ArticleBody
blocks={data.blocks}>` is the article route, and it is the shape of the thing.

**This is what composition means, and it is the largest item on the list.** The walk has to descend
into a child and carry the props it was given, rather than handing the child a marker and rendering
it once. Until it does, the ranking above measures which markup an entry may contain, and this
measures how much of an application may be reached from one.

### What the render cannot stage, which the plugin has to

Rendering those 41 needed a module loader supplying three things Node does not: one copy of Svelte
for the whole graph, a `.svelte` file loaded from anywhere, and a `.svelte.js` compiled as a module
rather than run as JavaScript. Without the first, a component calling `getContext` through the
wrong copy fails with `lifecycle_outside_component`; without the second, every component a package
ships is unreachable, because they arrive as `x.js` re-exporting `x.svelte`; without the third,
`$state` is undefined in a package's own utilities.

**All three are things a bundler does, and the compiler runs inside one.** So this is not a gap to
close here -- it is a list of what `pkgs/plugin` owes the render pass, written down while it was
measured. See spec/build.md.

**A library component is a wrapper**, and forwarding its caller's attributes with `{...restProps}`
is what a wrapper does, so `{...spread}` is nearly universal there and nearly absent in an
application. **An application component holds its own state**, so a rune reaches its markup.

Both numbers matter and they answer different questions. Compiling the pages an author writes is
the first; compiling the components they install is strictly harder, because composition pulls a
library's components into the same compilation.

## Half of `bind:` writes nothing, and that half is handled

Svelte's server does not treat a binding as one thing. Its table marks forty of them `omit_in_ssr`,
and every one is a measurement only a browser can take -- how wide the viewport is, where the page
is scrolled, how far a video has played, which element has focus, what an element measured to. A
server has none of those, so the bytes are the same with the binding and without it, and the walk
steps over them exactly as it steps over a transition.

**Three quarters of the uses in the application measured here are that half**: 9 of its 12
components that use `bind:` use nothing else. Seven names are left that the server does write --
`value`, `checked`, `open`, `group`, `innerText`, `innerHTML`, `textContent` -- and where each one
lands is Svelte's business rather than a rule reproduced here: an attribute, the element's escaped
content, or its unescaped content.

Those seven are refused, for a reason that is about this compiler rather than about them.
**`bind:` takes a name, not an expression** -- Svelte rejects `bind:value={"x"}` outright -- so a
marker cannot stand where the value goes, and the pass that reads a render to find its holes has
nothing to find.

**The list is copied, and it is checked.** `omitted.test.ts` renders every name on it against
Svelte and fails if one starts writing something, and spot-checks the other direction so the list
cannot quietly grow. The alternative was to plant a marker in every binding and let the holes that
never came back name the omitted ones, which needs no list at all. It was turned down because it
would make an unconsumed hole mean *the server omits this* rather than *content was lost*, and that
invariant is what has caught four defects here. **A list that can go stale is cheaper than an
invariant that can no longer fail.**

## A snippet is inlining, and the render does it

Svelte's server compiles `{#snippet name()}` to a function declaration -- `function name($$renderer)
{ ... }` -- and `{@render name()}` to a call. So a component that declares a snippet and renders it
inlines it, and this compiler gets that for free: the skeleton comes from rendering, and Svelte
calls the function while it renders.

What the walk has to do is plant the markers in the snippet's body where it is *written*, and they
come back where it is *called*. That is fine because **a marker carries its own index**, so a
snippet declared below the render tag that names it works exactly as well as one declared above --
measured, along with snippets holding an `{#if}` and an `{#each}` of their own.

Two shapes are refused and the reasons are different:

**A parameter is the argument, substituted.** `{#snippet row(v)}` takes its value from the
`{@render}` that calls it, and there is exactly one of those, so `v` stands for that argument
wherever the body reads it -- in a slot, in a branch's test, as an each block's source. A
destructured parameter is the same substitution a destructured declaration gets, with the way in
written after the argument, which is why the two share one function. A default or a rest is neither
a member nor an index, so it has no way in and is refused by name.

The render is handed something in the argument's place rather than the argument itself, because
the value is unused by then -- every expression in the body is already a marker -- and evaluating
it would reach for data the render is not given. What it is handed has to be destructurable when
the parameter destructures: `{}` or `[]` rather than `null`, which is the same rule a declaration
that reads a prop already has.

**Rendered more than once.** One body cannot stand in two places: every marker in it would come
back twice, which the rule that each is consumed exactly once catches on its own. It is refused
before that, because the invariant reports a value arriving twice and says nothing about the
snippet that put it there. It is also what makes a parameter tractable at all -- one call means one
argument per parameter.

**A snippet written inside a component's tag is a prop that component receives.** Svelte compiles
it to a function passed along, and the child decides when to call it and with what. One with no
parameters has nothing to decide and **works** -- that is what `{@render children()}` is, measured
on a page whose child renders the markup the page wrote inside its tag. One with parameters is
refused, because the arguments are chosen by the child and are not visible from here; it used to be
refused for saying it was never rendered, which was wrong in a way that would have sent an author
looking for the wrong thing.

## A component call has no boundary, and Svelte's answer is that it never needed one

The assembler counts every `<!--[` anchor in the render as one of the blocks the walk numbered. A
component the walk did not enter writes its own, and there is nothing in the bytes to tell them
apart. Reading how Svelte marks a component boundary answered the question by not having one.

**`block_open` is written in five places** -- an each, a `<slot>`, a `<svelte:boundary>`, an async
`{#key}`, and a *dynamic* component. A static component call is `Child($$renderer, props)` and
writes nothing around itself.

**Because the client does not need it.** From `internal/client/dom/hydration.js`:

> The node that is currently being hydrated ... updates each time a component calls `$.child(...)`
> or `$.sibling(...)`.

Hydration walks the DOM in lockstep with the component tree it is *executing*. Each component
consumes exactly the nodes it produced, so the boundary is implicit in running the same code again.
Svelte never asks where a component's output ends, because it is always inside the component when
it matters.

**This compiler does not execute the tree; it reads the bytes afterwards.** So what is implicit for
Svelte is missing for us, and the rule that follows is simple: **whoever reads these bytes has to
have walked the tree that wrote them.** Which is what composition is, arrived at from the other
end.

### Making the boundary explicit was tried and is not clean

Wrapping the call in `{#if true}` would give it Svelte's own anchors. Measured, it does more than
that:

```
bare      <p>a</p> <!--[--><i>1x</i><i>2x</i><!--]--><!----> <p>b</p>
wrapped   <p>a</p> <!--[0--><!--[--><i>1x</i><i>2x</i><!--]--><!--]--> <p>b</p>
```

The wrapper also **removes the trailing `<!---->`**, because a component's empty comment is written
only when it is not standalone and a block makes it one. Stripping the difference would mean
reproducing Svelte's own positional rule, which is the thing this compiler exists not to do.

### So it is the walk, and what the walk needs is already priced

For a component from a package that means two things. Resolving `<Dialog.Root>` -- a member of a
namespace import -- to a file, which is module analysis rather than a lookup. And the walk
surviving library source: over sixty of `bits-ui`'s components, the markup constructs that stop it
are `{...spread}` on an element and a parameterised snippet handed to a component.

**Which closes a loop.** The spread section says the unenumerable half becomes *required rather
than possible* on the day the walk descends into a child. This is that day, reached from the other
side: the boundary problem is solved by walking in, and walking in is blocked by the spread. Its
cost was measured there -- `attributes` and what it reaches bundle to 2.3 kB of Svelte's own code,
in the derivation bundle both backends already run, with nothing reproduced anywhere.

## A component that renders none of what it was given, which is a portal

This gates all eight of press's routes, and reading what actually happens changed what it is.

**It is not the dialog being closed.** `bits-ui`'s `Dialog.Root` ends in `{@render children?.()}`
and renders them. What writes nothing is `Portal`:

```svelte
{#if disabled}
	{@render children?.()}
{/if}
```

Everything else it does is `mount(PortalConsumer, { target })` inside a `watch`, against a target
found by `document.querySelector` and guarded by `isBrowser`. **A portal has no server rendering by
construction.** `Dialog.Content` closes a second gate over the same content --
`{#if contentState.shouldRender || forceMount}`, and `shouldRender` starts at `open.current`.

**Svelte's own answer is nothing, and Kit's is the same.** Measured rather than reasoned about:
press's `dialog.svelte` rendered by `svelte/server`, with a real locale, no compiler involved and
no marker anywhere near it, is

```
73 bytes: <!--[--><!--[--><!--[--><!--[-1--><!--]--><!--]--><!----><!--]-->
```

Anchors, and no content. That is what SvelteKit sends; the dialog is created on the client after
hydration. So **the right output here is nothing, and the markers planted inside are meant to
disappear** -- the only thing objecting is the invariant that every hole comes back exactly once.

### Why they may disappear, and the one condition that makes it safe

The compile-time render *is* the server render, so whatever Svelte writes is what a request would
get. The only way the two could differ is if this render's markers changed a decision the real
values would have made differently -- a child branching on a prop, where a marker is a truthy
string and the real value might be falsy.

So the condition is exactly: **a component whose props reach nothing the request decides renders
the same thing every request.** `inert()` already computes that per attribute for a different
reason -- deciding whether to hand a package a marker at all -- and a component is inert when all
of its attributes are. `<Dialog.Portal>` takes none, and `<Dialog.Root {open}>` takes a piece of
client state with no value yet, so both qualify.

**All-or-nothing per call site.** The markup handed to a component is rendered inline and whole, so
either every marker in it comes back or none does. Partial is not a portal; it is a value the child
did something with, and stays a loss. That is the rule, and it keeps the invariant strong
everywhere it was strong before.

**The residual risk, named:** a request-varying value can reach a subtree through *context* rather
than through props, and a decision taken on that would not be visible in the attributes. Nothing in
press does it, and a compiler cannot see it without walking the provider; it is written down here
rather than guarded against.

### Absence is never the evidence, because absence is also what a broken compiler looks like

A first design read the render and said: none of this group's markers came back, so the component
did not write it. That is post-hoc, and it fails the only question worth asking of a check like
this -- **would it still catch the day Svelte changes how children are passed?** It would not. The
markers would be missing then too, and the compiler would quietly accept a page with its content
gone. A drift check that cannot fail is decoration.

So the evidence is positive and comes from an experiment. **The same render is made a second time,
with each handed fragment replaced by a literal nobody could produce.** The literal coming back is
what says the component writes what it is given:

| the probe | what it means | what the invariant does |
| --- | --- | --- |
| comes back | the component writes what it is handed | unchanged: every marker must come back once |
| does not | it writes none of it, which is what a portal is | the holes there may go unconsumed, and the blocks leave the order |
| does not, but a marker came back | two things that cannot both be true | refused, and the message says it is the compiler rather than the component |

**What the probe cannot see is the mechanism itself failing**, and that is not its job: it is
pinned by the surface checks for a wrapper around markup and a layout around a page, which walk a
component's children end to end and compare bytes with Svelte. If children stop being passed, those
fail loudly and this is never reached.

Holes are not the whole of it either. Markup handed to `<Dialog.Content>` carries `{#if}` and
`{#each}` blocks, and a block that never appears shifts every ordinal after it, so the group covers
both.

### And it uncovered a second thing, which has to come first

**A component the walk does not enter writes Svelte's own block anchors, and the assembler counts
every anchor as one of its own.** Measured with no markup of ours involved at all:

```svelte
<p>{data.head}</p>
<Dialog.Root><Dialog.Portal /></Dialog.Root>
```

```
render    <!--[--><p>%%s0%%</p> <!--[--><!--[--><!--[-1--><!--]--><!--]--><!----><!--]--><!--]-->
declared  1 hole, 0 blocks
lowering  the render holds more blocks than the source declared
```

Those anchors are `bits-ui`'s, from its own `{#if}`s. Nothing in the walk numbered them and nothing
can, because the file was never opened. This is **not caused by the probe** -- it predates it, and
it is why the portal case cannot compile even once the accounting is right.

It does not arise for a component the walk enters, whose blocks are numbered where the assembler
meets them. It arises for a package's, and for any local one a walk was rolled back on. So it is
the next thing, and the shape of it is: the assembler needs to know which anchors are not its to
count, which means knowing where a component's output begins and ends -- and a component call has
no anchor around it, which is the same fact this whole family keeps returning to.

## The measurement is a route now, and it says four things are left

Every count above was files: each `.svelte` compiled as though it were the entry. That question has
no answer for a library component, which is never one, and the lists kept carrying rows that
measured the scan rather than the compiler. Now that a page inside its layout is one walk, the unit
is what it should have been:

```svelte
<script>
	import L0 from '../+layout.svelte';
	import Page from './+page.svelte';
	let { data } = $props();
</script>

<L0><Page {data} /></L0>
```

which is what SvelteKit composes. Over press's eight routes, **none compiles yet**, and what stops
them is four things rather than the eighteen the file count last showed.

| what | where | routes |
| --- | --- | --- |
| a component that renders none of the markup it was given | the layout's search dialog: `<Dialog.Root {open}>` with `open` a piece of client state that has no value yet | **all eight** |
| a parameterised snippet inside a component's tag | `{#snippet child({ props })}`, which is how `bits-ui` hands an element back to its caller | two |
| `{...spread}` on an element | the home page, and the article body | one |
| `{@const}` inside a snippet that takes parameters | the support block | one |

**The first one gates everything**, because it is in the layout: the other three routes stop for
their own reason first, and would meet it next.

### Two errors that were not gaps, and one measurement habit that was hiding them

`No locale found` and `Cannot read properties of undefined` were on that list until the diagnostic
was fixed. Neither is a gap: both are **Svelte rendering a component the walk could not enter,
without the values a request would bring**. The walk is rolled back when it stops, which is what
keeps this from refusing what already worked -- and the refusal was being thrown away with it, so
what the author saw was a crash from inside a library. Every abandoned walk now records why, and a
failed render says both. Three of press's four remaining gaps were found only after that.

**Both of these -- the unit and the discarded reason -- were the same mistake in different
clothes.** A measurement that answers a question nobody asks, and an error that reports the last
thing that happened rather than the first.

## `<svelte:element>`, where the tag decides four shapes and nothing else

Refused as *an unenumerable decision, so a small closed runtime node*, which had the cost right and
the shape wrong. `internal/server`'s `element()` is nine lines:

```js
renderer.push('<!---->');
if (tag) {
  if (!REGEX_VALID_TAG_NAME.test(tag)) e.dynamic_element_invalid_tag(tag);
  renderer.push(`<${tag}`); attributes_fn(); renderer.push(`>`);
  if (!is_void(tag)) {
    children_fn();
    if (!is_raw_text_element(tag)) renderer.push(EMPTY_COMMENT);
    renderer.push(`</${tag}>`);
  }
}
renderer.push('<!---->');
```

**The attributes and the children do not depend on the tag.** `build_element_attributes` is the
same function a written element uses, and the namespace and the case rules it reads come off the
node rather than off the value -- so those bytes can be rendered once and kept. What the tag
decides is four things and no more: whether anything is written, what the name is, whether there
are children and a closing tag, and whether an empty comment precedes that closing tag.

### A stand-in tag makes the render produce the shape, and the anchor

The render cannot be given a marker as the tag: `%%s0%%` fails the name regex and Svelte throws,
which is what the refusal used to look like from the outside. It is given `seam-elN` instead --
a valid name, never void, never raw text -- so the render always writes the full shape, and the
name is also **the anchor**, appearing at both ends of exactly the region that belongs to it.

The IR is then nested decisions with the children in one branch only, which is what keeps them from
being walked twice:

```
<!---->  if valid(tag) { "<" tag ATTRS ">"
                          if !void(tag) { CHILDREN  if !raw(tag) { <!----> }  "</" tag ">" } }
<!---->
```

`is_void`, `is_raw_text_element` and the name regex are **written into those expressions** rather
than into a runtime, so the lists travel in the derivation bundle both backends already run and
neither keeps one of its own. They are copied from Svelte's `src/utils.js`, so `tags.test.ts`
renders every name in both lists and holds it to what it does, the way `omitted.ts` is held.

### One divergence, and it is written down

**Svelte throws for a tag name its regex rejects; this writes nothing.** A compiled artifact has
nowhere to raise the author's error at request time, so the validity test is part of the decision
and an invalid name takes the same branch a falsy one takes. An empty string already behaved that
way in Svelte, since `if (tag)` is reached first -- which the drift check found while it was being
written, and which is the shape the divergence takes for every other rejected name.

Of press's 41 components, 23 compiled and now 24 do.

## Composition: the walk goes into the child

The table below measures what a child may do with a value it is handed, and the answer was that
telling any two of those apart needs to be inside the child. So the walk goes in.

**It is the same walk.** On a `Component` whose tag resolves to a `.svelte` file this project holds,
the child's source is read, its props are bound to the expressions at the call site, and `collect`
runs over its markup. From inside, none of the rows in that table is a special case: **the child's
own expressions become the markers**, and each expands through the props to the caller's expression.
A prop written twice is two markers; a prop never read is none; a prop computed with is the
computation. Nothing in the walk knows which of those it is doing.

Six things had to be true, and each was measured before it was written:

- **A copy per call site, not per file.** A component is a plain call, so the same module rendered
  twice writes the same markers twice and each comes back twice. The same shape a snippet rendered
  twice had, and the same answer.
- **Svelte is told the real filename.** The scoped class and the head anchor are hashes of the
  filename relative to `rootDir`; a copy staged under another name moves both.
- **A prop the call site leaves out is the child's default.** `$props()` destructures, so a missing
  prop is `undefined` and the default fires. Getting this wrong **wrote the wrong bytes rather than
  refusing**, and only the comparison against Svelte said so.
- **The call site's values are handed to the render as nothing.** The child's markers already carry
  the expressions, so what the tag passes is dead -- and live, it would be evaluated against data
  the render is not given.
- **A shorthand prop is written out first.** `{data}` is `data={data}`, and the short form's braces
  hold a bare name, so `{null}` is `'null' is a reserved word`. The same cost a marker planted in
  one had, met a second time in a different pass.
- **A cycle is refused rather than followed**, which `compose()` in
  `crates/lowering/src/lower.rs` has always done for the other lowering path.

**A component this cannot follow is left to Svelte, exactly as before.** The walk is attempted and
everything it touched is rolled back if it stops, so nothing that compiled before this stops
compiling now: a package's component, one given markup as children, one behind a spread, and
anything inside a child that the walk has not been taught. What is gained is gained; nothing is
traded for it.

Of press's 41 components, 22 compiled and now 23 do, and the shapes that leave are the ones this
was for: a child formatting a date it was handed, a child using a prop twice, a child not using one
at all.

### And into the markup the caller wrote inside the tag

Markup written inside a component's tag becomes an arrow function passed as `children` --
`visitors/shared/component.js` builds it -- and the child renders it with `{@render children()}`.
So it is walked **where the child renders it**, not where it was written. The markers still go into
the caller's source, which is where Svelte compiled the body, and the blocks are numbered in the
order the assembler will meet them, which is the order the render puts them in.

That is what a route is:

```svelte
<Layout><Page {data} /></Layout>
```

Both halves are now one walk. The layout's `<svelte:head>` and the page's markup come out of one
render, and the context the layout provides is there for the page because neither ever left.

**A wrapper that renders none of what it was given writes none of it**, which is what Svelte does,
and needs no rule of its own: the markup is walked at the `{@render}`, and if there is no
`{@render}` it is not walked.

### The rule this needed, which is about who evaluates a prop

Walking into a layout means walking its own markup, and one line of it was

```svelte
<PersistQueryClientProvider client={queryClient}>
```

`queryClient` is `new QueryClient(...)`, a local constant. Planting a marker there made the render
hand a package a string where it expected an object with methods, and made the artifact construct
a client per request. Before the walk went in, Svelte evaluated it and the value was real.

So: **a prop handed to a component the walk did not enter, whose expression reaches nothing the
request decides, is left as written.** Svelte evaluates it during the render, as it always did.
Inside a component the walk did enter there is no such rule and none is needed, because the value
is never handed to anyone -- it is walked.

The first attempt applied that test to every markup expression, not only to a prop crossing into
somebody else's code, and it cost three components: expressions that had been markers became
evaluations, and some of them throw without the context a request would have brought. Measured, and
narrowed to where the problem was.

### What it does not do yet

**A named or parameterised snippet inside the tag.** It arrives under its own name and may be
called with arguments the caller does not choose, which is the shape already refused.

**A spread at the call site**, for the reason the spread section gives: the props are keys the walk
cannot enumerate.

**A component from a package.** Its file is not one this compiler is arranged to rewrite, and
Svelte renders it as before -- which, measured across the 4157 components press installs, is what
already works.

## What a child may do with what it is given, measured across every shape

Five of what was left were one question asked five ways, so it was asked once, of a matrix: one
child per thing a child can do with a prop, one entry handing it a marker, and the answer read off
the compiler rather than reasoned about.

**A component compiles to a plain call.** `visitors/shared/component.js` ends at
`Child($$renderer, { ...props })`, and unless the component is dynamic there is **no anchor around
what it writes**. So the assembler cannot tell which bytes came from the child, and a marker that
does not come back is an absence with nothing attached to it. That is the whole of why this family
is hard, and it is one line of Svelte's output rather than anything about props.

| the child | what happens |
| --- | --- |
| writes it | compiles, and agrees with Svelte byte for byte |
| writes it in an attribute | compiles |
| writes it in `<svelte:head>` | compiles |
| concatenates it with text | compiles |
| renames it while destructuring, or gives it a default | compiles |
| hands it to a child of its own | compiles |
| computes with it, measures it, reads a member of it | the value never comes back |
| **does not use it at all** | the value never comes back |
| **writes it twice** | the value comes back twice |
| calls it | Svelte, mid-render: `p is not a function` |
| branches on it, iterates it, or renders none of what it was given | the render holds more blocks than the source declared |
| makes it a tag name | Svelte, mid-render: `dynamic_element_invalid_tag` |

**Nothing in that table is silent**, which is the result that matters most and the invariant doing
its job.

### The rule that is actually being enforced, which is narrower than it looked

Not *content must not be lost*. It is: **the entry's model of a component is that every prop it
hands over is written out verbatim, exactly once.** Two rows above are not losses at all -- a child
that ignores a prop loses nothing, and a child that writes one twice has written everything -- and
both are ordinary Svelte. They are refused because an unconsumed hole and a mangled value look
identical from outside a call with no anchor.

**They can only be told apart by looking at the child.** That is not a preference between designs;
the information is not present anywhere else. So this whole family is one item and it is
composition: the walk descending into the component a `Component` node names, with the child's props
bound to the expressions at the call site. `Derivation.scope` in `crates/lowering/src/ir.rs`
already exists for it and says so in its own comment, and `bundle()` in `pkgs/ast` already resolves
the tree. Once the walk is inside, every refused row becomes something already compiled: no uses is
no slot, two uses is two slots, computing is a derivation in the child's scope, branching and
iterating are blocks, calling is a snippet, and rendering nothing is a block that is not taken.
**Only the tag name stays**, and that is `<svelte:element>`, which is its own item and unenumerable
for its own reason.

### What was worth doing before that, which is the diagnostic

A hole now carries the component and prop it was handed to, and the two messages say so:

```
`data.created` was given to `<Card>` as `created` and did not come back. A value handed to a
component has to be written out by it, and this one was used for something else -- computed
with, called, branched on, or not used at all.
```

The old message blamed `<svelte:head>`, which the table above measures as working. It was true once
and had outlived the thing it described, which is what a message costs when nothing holds it to
what it claims.

## `style:` is the same decision, with the value written inside the outcome

Reading `build_attr_style` and `to_style` first was what made this small, because almost none of it
is what the name suggests. **A `style` attribute beside a directive is not passed through.** The
whole attribute is reassembled: the base is re-parsed as CSS, with comments stripped and quotes and
parentheses tracked; **every declaration in it whose name a directive also names is dropped**; each
survivor is re-emitted as ` x;`; the directives are appended, the normal ones and then the
`!important` ones; and the result is trimmed.

```
style="width:9px;color:red"  style:width={w}    ->   style="color:red; width: 1px;"
```

Measured against Svelte before a line was written, and none of the four rules in that one example
would have been guessed.

**A declaration is present when its value is neither null nor the empty string.** Not truthy:
`style:width={0}` writes `width: 0;`. That is what makes it a substitution inside a decision -- a
marker stands where the value goes, and nothing could stand where the presence is decided.

### Why the declarations are not independent, and why that stopped mattering

The obvious encoding is one decision per declaration, which needs no enumeration at all. It is
wrong for one reason: the result is **trimmed**, and every declaration is written with a leading
space, so whichever is present *first* loses its space. With a base there is always something in
front and they are independent; with no base they are not. press writes exactly that shape --
`<span style:width={...} style:margin-top={...}>` with no `style` attribute -- so the easy half
would not have covered the one file there is.

So it is enumerated, which is what `class:` already does: `2^n` outcomes, each built by calling
`attr_style`, so the parsing, the dropping, the ordering, the `!important` bag, the trim and the
empty result that writes no attribute are all Svelte's answers. **The one thing that is new is that
an outcome carries markers**, and lowering splits an outcome at them the way it splits an
attribute's region. Each outcome gets markers of its own, so a value appearing in half of them is
still a hole planted once and consumed once, and the invariant that has caught most of the defects
here did not have to be weakened to let this through.

Refused: a `style` attribute whose value is an expression, because which of its declarations
survive is decided by a string that only exists per request; and a directive mixing text with an
expression, because Svelte joins them into one value and this reads a single expression.

Of press's 41 components, 20 compiled and now 22 do.

## `bind:`, where the syntax takes a name and the output does not

Half of `bind:` was already handled: forty of the forty-seven bindings are measurements a browser
takes, and Svelte's table marks them `omit_in_ssr`. The other seven were refused, and the message
said a marker cannot stand where the value goes because **`bind:` takes a name rather than an
expression**. That is true of the syntax and false of the output, which is the only thing that
matters here.

`visitors/shared/element.js` ends a written binding at

```js
attributes.push({ type: 'transformed', name: get_attribute_name(node, attribute), expression });
```

so `bind:value={v}` writes exactly what `value={v}` writes. On a component,
`visitors/shared/component.js` turns it into a getter and a setter for the same prop, and only the
getter runs while the bytes are written. **So the rewrite is the whole of it**: `bind:NAME={expr}`
becomes `NAME={expr}` in the source, before any other pass reads the file, and nothing downstream
knows there was ever a binding. A boolean one lands on `presence` exactly as a written attribute
does, which was already there.

Everything the visitor drops is dropped, from the same reading: `bind:this`, the forty the table
marks, and `bind:value` on a `<select>` or on a file input, both of which it skips because the
attribute has no effect on either.

Three shapes are not an attribute, and each now says what it is rather than what it is not:
`bind:innerHTML`, `bind:textContent` and `bind:innerText` are written as the element's *content*,
replacing its children; `bind:value` on a `<textarea>` is the same; and `bind:group` is written as
`checked`, computed from the bound value together with the element's own `value` attribute. A
getter/setter pair is refused for the same reason, which is that the server calls the getter.

## A declaration with no value, which is what client state looks like on the server

Three of press's components were refused for reading a name *the data does not carry*, and all
three are the same shape: a piece of client state, set by a handler, read by the markup.

```svelte
let tip = $state();
function show(event, stat) { tip = { ... } }
{#if tip} ... {/if}
```

The refusal blamed the assignment, and the assignment was never the problem -- `assigned()` has
never walked a function body, because a handler does not run while the bytes are written. What was
missing is smaller: **a declaration with nothing written for its value.** `let t = $state()` and
`let t;` both leave a name with no initialiser to substitute, so the markup read a name nothing
bound.

Svelte answers it in one line, in `visitors/VariableDeclaration.js`:

```js
const value = args.length > 0 ? visit(args[0]) : b.void0;
```

`void 0`. The declaration holds `undefined` while the bytes are written, and a plain `let t;` holds
the same. So it is a value like any other, and the branch it decides is decided the way Svelte
decides it: `{#if tip}` renders its else, and the client takes over from there. **Which is the
whole of what a client-only component is on the server**, and there was never a question of
refusing it.

An assignment at the top of the instance script stays refused, and that one is real: it does run
during the render, so the initialiser is not what the name holds. What it needs is a substitution
that maps a name to a sequence rather than to an expression, which
[derivation.md](derivation.md) already records as the boundary of what substitution is.

Of press's 41 components, 18 compiled and now 20 do.

## An each over a destructuring, which was a crash rather than a refusal

`{#each Object.entries(m) as [k, v]}` did not refuse. It stopped inside Svelte's own output with

```
number 0 is not iterable (cannot read property Symbol(Symbol.iterator))
```

which names nothing the author wrote. Two things were missing, and the source said what both were.

**The element the render iterates has to fit the pattern.** `visitors/EachBlock.js` writes
`let <context> = each_array[i]`, and this pass replaces the each's source with a one-element array
so the body renders once. That element was `0`, which an array pattern cannot come apart from. It
is now `[]` or `{}`, chosen by the pattern, which is the same rule a snippet's parameter already
followed and the same table it used.

**And the names have to reach the runtime.** A destructuring binds names rather than the element,
so `item` -- which the IR hands to the runtime as the name to bind -- was the pattern text and
resolved nothing. The block now carries what `destructure` returns, pairs of name and how each is
reached from one element, and the IR's each node carries them through. The same pairs go into the
scope lowering checks a derivation against, so an expression reading a destructured name is caught
by the per-item rule exactly as one reading a plain binding is.

A default, a rest or a nesting in the pattern is refused, and by name: none of them is a member or
an index of the element, so there is nothing to write down. That is the rule
[derivation.md](derivation.md) already states for a declaration and a snippet parameter, met a
third time.

Of press's 41 components, 17 compiled and now 18 do.

## `{...spread}`: one refusal covering two unrelated things, and 88% of it is the free one

`{...spread}` leads the whole-ecosystem list at 4157 files of 4308, which made it look like the
largest thing there is. Split by what Svelte actually compiles it to, most of that is not a
decision position at all.

**On a component it is prop merging.** `build_inline_component` puts the spread into
`$.spread_props([...])` and the props go to the child. Nothing is serialised, no attribute is
decided, and the child is rendered by Svelte. **On an element it is `$.attributes(object, hash,
classes, styles, flags)`**, which walks the object's keys at request time -- and which keys exist
is the thing that cannot be known at compile time.

Counted over the same 4308 components:

```
 3885  on a component   ·  a name            598  on an element  ·  a name
   15  on an element    ·  a call              6  on a component ·  a call
    2  on an element    ·  a choice of two object literals
    2  on an element    ·  a logical expression
```

By file, which is what a ranking counts: **3657 carry a spread only on a component, and 500 carry
at least one on an element.**

### And the wrapper, which is what the 96% is, already compiles

```svelte
<script>let { children, ...rest } = $props();</script>
<div {...rest}>{@render children()}</div>
```

Used as a child -- which is the only way a wrapper is ever used -- this compiles today. The
attributes came from the entry's markup, so Svelte resolved the spread during the compile-time
render and there was nothing left to decide. The refusal fires when such a file is made the entry,
and nothing makes it one. The same artifact as the `{@render children()}` count, and the same
answer: what would make it real is the walk descending into children, which is composition.

### What an entry actually meets, and the line through it

Two shapes, and they are not the same problem:

- **A choice between object literals** -- `{...cond ? { target: '_blank', rel: '...' } : {}}` --
  has a known set of keys per outcome and two outcomes. That is an enumerable decision, the same
  one `class:` turned out to be, and the same mechanism takes it: call `$.attributes` per outcome
  and keep the strings. Two of press's three spreads are this, and one of those two is in a route.
  A literal whose *value* is request-varying is not this: it is a substitution inside a decision,
  which is where `style:` sits.
- **A name** -- `{...restProps}`, `{...data.attrs}` -- has no enumerable outcomes and needs the
  runtime to write attributes from an object.

**press's entries need the first and none of the second.**

### The 500 are one package, and it already compiles

Of the 500 files carrying a spread on an element, **495 are `bits-ui`**, three are press's own and
two are `@lucide/svelte`. So the question is not what the ecosystem does, it is what one widely
used package does, and whether depending on it works.

It works. A request-varying value passed to a component whose element spreads `{...restProps}`
comes out the other side as an ordinary attribute:

```svelte
<DropdownMenu.Trigger id={data.id} class={data.c}>{data.label}</DropdownMenu.Trigger>
```

```
<button class="%%s1%%" id="%%s0%%" aria-haspopup="menu" aria-expanded="false" data-state="closed"
```

**Because the keys are decided by the call site, and the call site is markup this compiler reads.**
`{...restProps}` is opaque only if you look at the wrapper alone. Looked at from the entry, the set
of attribute names is written out in the entry's own markup and the values are markers, so the
spread resolves during the compile-time render and lowering sees three `attr` nodes with three data
paths. The same holds for press's own `{...attributes}` icon.

**So the unenumerable case is narrower than the refusal says.** It needs the spread to be in the
entry *and* its object to come from the payload -- `{...data.attrs}` -- because only then do the
keys arrive per request. press has none, and neither does anything it installs.

### And it would not cost a reproduction, which an earlier draft of this section got wrong

That draft said a second backend "cannot" call `$.attributes` and would need around 150 lines of
Rust reproducing it. Both halves are wrong, and the file it contradicted is
[pipeline.md](pipeline.md): **a Rust backend embeds QuickJS and already runs the derivation
bundle**, which is defined there as the author's expressions *and the pure functions those
expressions call*, compiled to one script with no imports left in it. `attributes` is a pure
function. It belongs in that bundle like any other.

Measured: `attr`, `clsx`, `to_class`, `to_style` and `escape_html` bundle to **2.3 kB with no
reference to `process`, `globalThis`, `Intl` or any DOM name**. Nothing is reproduced anywhere and
there is nothing to drift.

**What this does not change is that it is request-time work on the server, and that it belongs to
SSR rather than to the client.** The attribute bytes have to be in the response: a page whose
`target` or `aria-label` only appears after hydration is wrong before it and mismatched at it. It
is the same request-time evaluation the protocol already does for a derivation, not a browser
runtime, and it is strictly less than SvelteKit does -- which runs that same function per request
along with the whole component tree.

### Neither half is blocked. Both are unbuilt, and here is what each is waiting for

**Nothing is refused here for want of a mechanism.** Saying "not yet" without saying when is a way
of not deciding, so both halves get a condition that can be checked rather than felt.

**The enumerable half** -- `{...cond ? { ... } : { ... }}` on an element -- needs no new machinery
at all. It is the decision `class:` already compiles: call `$.attributes` once per outcome and keep
the strings. It is not built because **the one place it appears is refused before it is reached**.
press's home route writes it inside `{#each links as link}` beside
`link.href.startsWith('/') ? ... : ...`, and lowering stops on that first:

```
`link.href.startsWith("/") ? link.label : "x"` is computed once against the payload but reads
`link`, which an each block binds per item
```

So building it today would move nothing. **It is built when the per-item derivation is** -- the
open item in [derivation.md](derivation.md), and concretely `path()` in
`crates/lowering/src/assemble.rs`, which today refuses an expression reading a name an each binds.
Whichever of the two lands second unblocks the route; there is no other order.

**The unenumerable half** -- `{...data.attrs}`, keys arriving with the request -- is not built
because **no code needs it**. Not in press, and not in the 4157 files press installs, because a
library's `{...restProps}` is resolved by the call site and the call site is markup this compiler
reads. Two separate things would make it needed, and they are not the same event:

1. **An author writes an element spread whose object comes from the payload, in a route.** That
   needs nothing else finished. `attributes` goes into the derivation bundle -- 2.3 kB, measured --
   and the IR gains a node that writes attributes from a path. It can be built the week it appears.
2. **The walk descends into a child.** Concretely: when `collect()` in
   `pkgs/skeleton/src/skeleton.ts` walks the component a `Component` node names, instead of leaving
   that subtree to Svelte's render, and lowering resolves the child's props through
   `Derivation.scope`, which `crates/lowering/src/ir.rs` already carries for exactly this. On that
   day every wrapper's `{...restProps}` stops being something Svelte resolves for us and becomes
   something this compiler has to write, and the node stops being optional. That is when it is
   required rather than possible.

## `{@render}`, where the count of five was measuring the scan rather than the compiler

Five components were held by *`{@render}` of a snippet this component does not declare*. Every one
of them writes `{@render children()}`, and every one of them is a component somebody else's markup
goes inside -- a layout, a modal, a popover, a menu, an article. **Compiled where they are actually
used, four of the five compile and the fifth stops on something else entirely** (a `getContext` its
ancestor provides). The refusal fires only when such a file is made the entry, which nothing makes
it.

So the number was measuring the shape of the scan, not the compiler, for the second time. It is
kept here rather than deleted because the refusal is still right: an entry's props are the payload,
and a payload carries data rather than functions, so an entry genuinely cannot be handed a snippet.
What would make it possible is the walk descending into children, which is the composition item,
and this is one of its faces rather than a thing of its own.

### What was real, and it was the other half of the same tag

`{#snippet a(v)}` compiles to `function a($$renderer, v)` and `{@render a(x)}` to
`a($$renderer, x)` -- `visitors/SnippetBlock.js` and `visitors/RenderTag.js`. So **two renders
inline the body twice**, and this compiler plants its markers in that body once: each came back
twice, which the hole check reports, and a parameter would have to stand for two arguments at once.
Both were refused, and press writes it five times: a footnote entry, a copy button, a code action,
a label, a source link.

**One copy of the declaration per call site is what the render does anyway.** Each copy then has one
call, so it has one set of markers and one argument per parameter, and every pass below it is back
in the case it already handled. A snippet declaration writes no bytes -- the visitor pushes a
function to `hoisted` or `init`, never to the template -- so a copy adds none, which is what makes
this a rewrite of the source rather than a change to the output. It is done before any other pass
reads the file, and nothing downstream knows about it.

A snippet that renders itself is refused instead, and says so: a recursion has no fixed number of
call sites to make copies for.

**`{@render a?.()}` was refused for a reason that was simply untrue.** The optional form parses as
a `ChainExpression` around the call, so reading `callee` off the expression found nothing and a
snippet the component *does* declare was reported as one it does not. Svelte's own transform calls
`unwrap_optional` at exactly this point, which is what this now does. Third time a refusal has been
right about stopping and wrong about why.

Of press's 41 components, 15 compiled and now 17 do.

## A block inside an else, and the `{:else if}` that was never one

Five of press's components were held by *a block inside an else is not handled yet*, and reading
Svelte's `visitors/IfBlock.js` said that most of them were not that case at all.

**An `{:else if}` chain is one block.** The transform walks `metadata.flattened` and emits one
`if`/`else if`/`else` statement, telling the branches apart by numbering the marker it opens each
one with: `<!--[0-->`, `<!--[1-->` upward, and `<!--[-1-->` for the else, all inside one
`<!--[-->`/`<!--]-->` pair. The AST nests them -- the alternate is a fragment holding one `IfBlock`
marked `elseif` -- so a walk that followed the AST numbered a second block the render never wrote,
and the refusal fired on the commonest form of the construct there is. Confirmed by rendering, and
one more thing came with it: **a bare `{#if}` with no else still writes `<!--[-1--><!--]-->` when it
is not taken**, so the branch always exists whether or not anything was written for it.

So a block carries every test of its chain, one render is made per branch, and the IR's `if` node
already took a list of branches. `<!--[-1-->` is both Svelte's number for the else and the key the
render is filed under, which is one convention rather than two.

**The genuine case turned out to be one line.** A block inside a real `{:else}` is numbered by the
source walk after the branch above it, and the assembler meets it in that branch's own render --
in the same order. The two lined up already. What stopped them was that the assembler *rewound*
its block count before walking the alternate, so a block there would have been given a number the
consequent had already used. Nothing needed that rewind: it was invisible for as long as the
refusal meant no alternate ever held a block.

One thing did have to be added. A block inside an else exists only in the render made for that
branch, so the render made for **its** branches has to put its ancestors on the branch that makes
it exist. Each block records the branch of every if it sits inside, and the driver replays them.
Getting that wrong corrupts nothing -- the block does not appear, and the assembler says so, which
is how it was found.

Of press's 41 components, 13 compiled and now 15 do, and this refusal is gone from the list.

## `class:` is done, and it was never the same problem as `style:`

`class:on={t}` writes the class name when `t` is truthy and nothing when it is not, so the value
**decides** rather than being written, and a marker has nowhere to stand -- which is the distinction
[pipeline.md](pipeline.md) draws, and the reason a boolean attribute needed `presence`.

`style:color={c}` looked like the other kind. Its value *is* written, into the style attribute, so
a marker stands in it and four shapes came out byte for byte: alone, beside a static style, two
together, and with characters that escape. It was ready to ship. The fifth shape was a nullish
value:

```
style:color={undefined}      Svelte writes nothing at all
                             this wrote  style="color: ;"
```

**Each declaration is dropped when its own value is nullish**, not only the attribute when
everything in it comes out empty -- which `presence` already covers. So `style:` is a substitution
*inside* a decision.

A note here used to say that meant it was **not** waiting on what `class:` waited on, because a
class directive's value never reaches the bytes while a style declaration's does, so its outcomes
would be the values rather than two. That was wrong, and the section below says what it is
instead: the outcomes are two per directive after all, and the value stands inside them.

### What the source said that no measurement had

Read out of `phases/3-transform/server/visitors/shared/element.js` and
`internal/shared/attributes.js` rather than inferred from renders, and two of the four would not
have been found by trying payloads:

- **A directive is not an addition beside the class attribute; it decides what the attribute is.**
  Every directive on the element goes into one `$.attr_class(value, hash, directives)` call.
- **A falsy directive is not a no-op: it removes its own name from the value it was given.**
  `class="on"` with `class:on={false}` writes no class attribute at all, because the result comes
  out empty and `attr_class` returns nothing rather than `class=""`.
- **A truthy directive appends without checking**, so `class="on" class:on={true}` writes
  `class="on on"`.
- **The analysis invents an empty class attribute** when a directive has none to work with, and
  puts it after every attribute that was written, wherever the directive itself was written.

Confirmed afterwards by rendering each against Svelte, which is the order that
[the workspace protocol](../../../spec/agent-protocol.md) asks for and the reason this took one
pass rather than three.

### How it compiles

The outcomes are enumerated, which is the mechanism [pipeline.md](pipeline.md) names, and they are
enumerated by **calling `attr_class` itself** -- so the joining, the removal, the escaping and the
empty result are Svelte's answers rather than reproductions of them. `n` directives give `2^n`
finished attribute strings, and the IR needs no new node: nested `if`s, one test each, ending in
the bytes. The limit is 16 outcomes, refused with the number in it; the most on one element in a
real application is two.

**The anchor problem the earlier note worried about did not exist.** Lowering already finds a
sentinel that landed inside a tag, names the attribute it landed in and owns the whole
` name="..."` run including the space in front of it -- which is exactly the region a decision
replaces, and exactly the shape `attr_class` returns.

**What did not work was the obvious rewrite.** Putting the marker *in place of* the class value,
and deleting the directives, silently lost the scoping hash: whether Svelte scopes an element is
decided by whether a selector matches it, and it matches against the class attribute's text and
against the directive names -- `css-prune.js` reads a `ClassDirective` for that. Told the element
is no longer selected, the render carried no hash, and there was none to read. So the marker is
**appended** to the class text and the directives stay where they are with their expressions made
false, which leaves the analysis seeing what it would have seen and the hash as the whole of what
follows the marker.

### What is still refused

`class={expr}` beside a directive. The falsy branch removes the directive's name from that value,
so which bytes exist is decided by a string that only exists per request. Writing the whole class
as one expression, with no directive beside it, is a substitution and has always worked -- which is
what nearly every library does anyway, per the count in [ir.md](ir.md).

## The compiler refuses by allowlist

The sentinel pass names the markup it understands and stops on everything else. It used to do the
opposite -- handle what it knew, then recurse over every property of anything else -- and that
fallthrough is where every defect above came from. A construct it had never been taught descended
quietly, planted no sentinel, and rendered wrong with an exit status of zero.

**The refusal existed and was not carried across.** The pass that wrote the bytes walked the
markup and refused a node it did not know; the pass that renders reads a string and never sees a
node, so only one part of that refusal was rebuilt -- the one about holes, which is what caught
`<svelte:head>`. Three constructs went through the part that was not rebuilt.

Three things an allowlist over node types cannot catch, because they are not node types, and each
is checked on its own:

| | what it is |
| --- | --- |
| `<style>` | hangs off the AST root, not the fragment, so neither walk reaches it |
| an each block's `index`, `key` and `{:else}` | fields of a node the compiler does handle |
| `translate={true}` | the shape of an attribute's value, which Svelte maps through a table |

**And an accepted construct is only accepted on the payloads it was tried with.** `{:else}` on an
each agreed with Svelte byte for byte against a list with something in it, because the branch it
turns on renders only when the list is empty. Every case in the check carries the payload its
shape turns on. This is [pipeline.md](pipeline.md)'s rule about static examples, applied to the
check that enforces it.

One thing is not looked at closely enough to be listed either way. **Context** -- `setContext` and
`getContext` -- writes nothing structural into the bytes, but where its value comes from would
need a compile-time walk of the component graph that has never been attempted here. It may turn
out to be ordinary. It has not been shown to be.

## Raw HTML is not escaped at all, and cannot usefully be

Three things happen to `{@html data.x}` and none of them is escaping.

**At compile time the name is checked and the value is not.** Binding resolution says `data.x`
resolves to something the data carries. It says nothing about what is in it.

**At request time the bytes go out untouched.** `escape: false` is not a lighter escape than the
other two, it is none: the value is turned into a string and written.

**Whether that is safe is the author's.** That much is where React and Svelte both stand -- one
encodes the warning in the name of the prop, the other says in its documentation that it
sanitizes nothing -- but agreeing with them is the weakest reason available, and there is a
stronger one.

**Sanitizing on the server would not make the page safe.** Svelte's client does not re-render
`{@html}` while hydrating; it walks from the opening anchor to the closing one and adopts
whatever is there, saying so in a comment: *we're deliberately not trying to repair mismatches
between server and client*. So a sanitized server rendering survives exactly until the value
changes, at which point the client assigns the raw value to `innerHTML` and replaces it.
Sanitizing here would buy no safety and would make the first frame disagree with every one after
it.

The only place sanitizing means anything is where the value is produced, which is the load stage,
and [derivation.md](derivation.md) puts that outside the protocol on purpose. That is not the
protocol declining a job it could do. It is the only place the job can be done.

## But the fragment is made to stay where it was put

Not escaping it is one thing. Letting it rearrange the page around it is another, and that one is
fixed. **A raw value goes through a parser before either the bytes or the wire see it**, and what
comes out is what a browser would have made of it.

Measured, with the value written into the element that holds it:

```
"<b>unclosed"        <div><!----><b>unclosed<!----><span>after</span></b></div>
"</div><em>escaped"  <div><!----></div><em>escaped<!----><span>after</span></em>
```

The closing anchor is no longer a sibling of the opening one, in the first because the unclosed
tag swallowed it and in the second because the container ended early and took the rest of the page
along. Svelte's client finds the end of a raw block by walking siblings, so both throw
`hydration_mismatch` and the block is rebuilt from scratch. Confirmed in a browser: with the stage
off, the `<span>` that should hold the fragment contains nothing but the opening anchor.

**It is applied to the payload, not to the bytes, and that is the only place it works.** The
server writes the bytes and serialises the payload, and the client re-renders a raw block from the
payload when the value changes. Transforming one and not the other is how the first frame comes to
disagree with every frame after it; transforming the payload transforms both, because both are
read from it.

Which values is not a second list: the IR already says `escape: false` on exactly those slots. A
raw slot on a *derivation* is not among them, and that is the same rule rather than a gap in it --
a derived value is computed per request and never serialised, so the client recomputes it and
would disagree with anything done here.

**A raw slot inside an each is reached per item, not per path.** The IR's path is read in the
scope the slot was written in, so `{@html r.html}` inside `{#each data.rows as r}` says `r.html`
and names nothing at the payload's root. Reading it there returns nothing, which is
indistinguishable from a value the payload does not carry, so those values went through this stage
untouched and unreported until it was measured. The stage now carries the enclosing each blocks
with the path and expands them, and a path whose first name no scope binds is an error rather than
a skip -- it means the compiler and this walk disagree about scope, which is a fault and not a
condition. An each over a derivation is excluded for the reason above, which is the same rule
rather than a second one.

It cannot make the two backends disagree, which was the first objection and is a false one. The
server that writes the bytes is the server that serialises the payload, so a Rust implementation
and a TypeScript one never meet. They have to be internally consistent within one response, not
byte-identical with each other, which is what separates this from devalue.

### It removes two things and no more

**Comments**, which are not elements, so they render nothing and no selector reaches them. And the
newline after `<pre>`, which needs no code at all because the parser drops it, as the
specification says to.

Nothing else, and the reason is a measurement. Collapsing the whitespace between elements is where
every byte anybody would want to save lives, and whether that whitespace is a rendered space is
decided by CSS the markup cannot see. Two `<span>`s with the same whitespace between them render
`x y` under `display: inline` and `x` above `y` under `display: block`, so no rule over tag names
can decide it, and the fragment's CSS comes from the page it lands in rather than from itself.
**The provably safe removals and the ones worth doing are disjoint sets**, which is why there is
no minifying stage and no configuration for one.

The whole thing is one switch, on by default, because a page whose injected content rearranges it
is broken and the cost of preventing that was a parse.

The one place the decision is visible to a backend is `escape: false` on a `slot`, which means
write these bytes as they are. See [ir.md](ir.md).

**A development build is a separate output and is not produced.** Under Svelte's development
runtime, `{@html}` writes a hash of the value into the opening anchor so its client can warn when
the two sides disagree. A hash of the value is a decision position, so the compiler cannot write
one, and what it produces is the production form: an empty anchor, which the client's check
returns from on its first line. See [pipeline.md](pipeline.md) for what a sentinel can and cannot
stand in for.

**Which runtime is loaded is not the compiler's to assume, so it is checked.** It comes from
`NODE_ENV`, two dependencies away: Svelte reads `DEV` from `esm-env`, whose fallback is true for
any value that is set and does not begin with `prod`. Unset gives production, which is why this
was invisible for as long as the compiler only ever ran from a task. A test runner sets `test` and
`vite dev` sets `development`, and the compiler is going to run inside a Vite plugin -- where it
would render a hash of a *sentinel* into the IR, which is a hash of a value no request will ever
carry, making the artifact wrong for every payload rather than for an unusual one.

So the render pass measures it rather than reasoning about it: it calls the helper and compares
what comes back, because the rule lives in a dependency of a dependency and the call is the
behaviour itself. A development runtime is a refusal that names the variable to set.
