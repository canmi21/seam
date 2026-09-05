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

**What is refused today is `pkgs/skeleton/src/skeleton.test.ts`**, which compiles each construct
and records whether it was turned away. This file used to carry the list instead, and the list was
maintained by recollection. Measured against the compiler, it was wrong in both directions at
once: it called an each block with a key and `{:else}` on an each unwritten when both compiled,
and it did not mention `{@const}`, which compiled and rendered the wrong bytes.

A list nobody runs is a claim. The check is the list, and this file keeps only the reasoning:

| | |
| --- | --- |
| a snippet rendered twice | the body would have to stand in two places |
| `{@render}` of a snippet from a prop | composition in the other direction; see below |
| an expression over what an each binds | computed once against the payload; per-item is not decided |
| `{...spread}` on an element | an unenumerable decision; see below |
| per-item derivation, which of two titles wins | not decided |

**So "a subset of Svelte" is a statement about how far the work has got, not about where a line
was drawn.** The subset grows, and the README should say that rather than implying a boundary
nobody has found.

## What is still refused is ranked in one place, by what it waits on

[roadmap.md](roadmap.md) holds every construct still refused, sorted three ways: ready and not
done, not yet the time, and blocked on the meta-framework. The line it sorts by is the one at the
top of this file, stated once more there so that it can be checked against each item: before
hydration the page is what SvelteKit's SSR would serve, after it a standard Svelte SPA, and the
only thing given up is rendering the UI per request. The reasoning behind each refusal stays in
this file; the ranking and the dependencies are there.

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
where the arguments are chosen by the child and are not visible from here; it used to be refused
for saying it was never rendered, which was wrong in a way that would have sent an author looking
for the wrong thing, and what happens to it now is the next section.

### A parameter the component supplies, and whether the component ever asks for it

Read out of `3-transform/server/visitors/SnippetBlock.js` and `RenderTag.js`: `{#snippet
children({ checked })}` inside a tag is `function children($$renderer, { checked })`, passed as the
`children` prop, and the component's `{@render children?.({ checked: state.isChecked })}` is
`children?.($$renderer, { checked: ... })`. So the body runs inside the component's render, with a
value the component computed. In bits-ui's radio item that value is `groupValues.includes(value)`,
and `value` came from the page's own data -- so from outside, `checked` is a decision the package
takes, per request, that no marker can stand for. It is the same wall as walking into the package.

**But a parameter only matters where the component calls the snippet, and a closed menu never
does.** press's language switcher is the case: the snippet sits inside `<DropdownMenu.Content>`,
whose `menu-content.svelte` renders nothing while `open` is false, and `open` is client state with
no value on the server. Svelte's own server writes no menu; `checked` is never asked for; the rows
are content the client makes after hydration. That is the stance already taken above for a
declaration with no value and for the search dialog: **the whole of what a client-only thing is on
the server is its absence**, and the markers planted in it are meant not to come back.

The refusal was taken at the declaration, which is before the question can be answered. Now the
walk plants markers in the body as it does in any markup and records, on the group the snippet
arrives as, why the group cannot compile *if the component writes it* -- and the probe render,
which already exists to say whether a component writes what it is handed, decides:

| the probe's literal | what it means | what happens |
| --- | --- | --- |
| does not come back | the component never calls the snippet on the server | compiles; the holes are safe and the blocks absent, as for a portal |
| comes back | the component calls it, with a value the walk cannot see | refused, with the message it always had, and now for a reason that is true |
| the probe cannot be made | nothing is known | refused, because a compile that skipped the check is the wrong direction |

A `forceMount`, or a menu open by default, renders the snippet on the server and is refused the
way it was. What changed is that a snippet nobody renders is no longer refused for a value nobody
computed. Of press's 42 components rendered bare, 32 compile where 31 did, and the one that moved
is the switcher.

**The probe had never measured a `{#snippet children}` at all, and this is what found it.** The
literal is planted at the head of the group the markup arrives under, and the group for
`children` was being opened by the *whitespace* between the tag and the snippet -- a text node,
one child among the others. The literal landed there, Svelte's analysis saw non-whitespace content
beside an explicit `children` snippet, and the probe failed with `snippet_conflict` -- silently,
which for the render-only shape meant nothing was relaxed and nothing was reported, and for this
shape would have meant refusing every case. Svelte's rule, in `2-analyze/visitors/SnippetBlock.js`,
is that whitespace text and comments are not content, so they open no group now; they hold nothing
to measure either way.

## `{...spread}` on an element, which Svelte hands over whole

The refusal called it an unenumerable decision needing a closed runtime node. The first half was
right and the second was too small a description: what is needed is not a node this compiler
writes, it is **Svelte's own function, carried**.

**An element with a spread does not write its attributes one at a time.** Every attribute and every
spread on it is merged into one object and handed to
`$.attributes(object, hash, classes, styles, flags)`, which walks the object's keys at request
time. Which keys those are is the only thing that cannot be known at compile time.

So the marker stands for the whole run rather than for an attribute in it, and the expression
behind it is that same call. **And the call is taken from Svelte's own output**, which is what the
compiled code looks like:

```js
$.attributes({ ...data.r, id: 'i' })
$.attributes({ ...data.r }, void 0, void 0, void 0, 4)          // an input
$.attributes({ ...data.r }, void 0, void 0, void 0, 3)          // inside <svg>
$.attributes({ ...data.r, class: 'a' }, 'svelte-1lj1c3f')       // a scoped element
```

Everything after the object is decided by the element rather than by its attributes, so replacing
the attributes with a probe leaves the hash, the directives and the flags exactly where they were,
and they are read back from the compiled output verbatim. Nothing here reproduces the merging
order, the escaping, the boolean names, `defaultValue` on an input, the case rules for a namespaced
or custom element, or the invalid-name regex.

### The runtime node is `attributes` itself, in the bundle that already exists

`spec/pipeline.md` defines the derivation bundle as the author's expressions **and the pure
functions those expressions call**, compiled to one script with no imports left in it, which both a
TypeScript and a QuickJS backend already evaluate. `attributes` is a pure function, so it goes in
that bundle beside the author's own imports and the two backends run one implementation rather than
agreeing about a rule.

Measured: bundled it is 17 kB, and its only two host references are
`globalThis.process?.env?.NODE_ENV` and `globalThis.document?.contentType` -- **optionally chained
off `globalThis`**, so an evaluator with no host reads them as undefined rather than failing. It
evaluates and answers in a bare sandbox with nothing but `new Function`.

Two things beside it used to be refused and are the same call. A `class:` or `style:` directive on
the element is the third or fourth argument: `prepare_element_spread` makes one object of the
class directives and one of the style directives, name to value, and hands both to `attributes`
(an `|important` modifier goes nowhere there, which is Svelte's and is kept). The directives stay
in the render with a value that evaluates to nothing, so Svelte compiles the two slots with the
hash and the flags around them, and the objects built from the source -- each expression in the
scope it was written in -- go into those slots when the call is read back. An attribute mixing
text with an expression is one value once the attributes are merged, and it is the template
`build_attribute_value` builds, with nothing for null and undefined. A `style:` written short
beside a spread stays refused: the name is a local this pass has no node to expand.

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

## A value a component never writes

A marker that does not come back has two readings, and only one of them is a fault.

The component may have **transformed** it -- computed with it, measured it, branched on it -- and
written something the value decided rather than the value. That is content lost, and it stays
refused: the artifact would carry bytes nobody can reproduce.

Or the component may simply **not write it**. press's language switcher hands its menu a source
language, the menu is a dropdown that is closed, and Svelte's own server writes the trigger and
nothing else. Measured directly, by rendering the component with a value nobody could produce: it
appears nowhere in the output. Refusing that refuses a page that would have been correct.

**Absence cannot tell them apart, so absence is not the evidence.** The render is made again with a
different value in each place a marker went missing, and the two outputs are compared. Identical
bytes say the value reaches none of them. A difference says it reaches some, which is the first
reading.

The replacement differs in length as well as in content, because a component that writes what it
measured would otherwise agree by accident.

**All of them at once first, then one at a time.** Asked together, a difference only says that
something reaches the bytes and not which -- so one live value kept every dead one beside it
refused, and the refusal named whichever came first rather than the one that was a fault. The
common answer is that they are all dead, and that is one render; the rest are asked separately only
when it is not.

This is the same shape as the probe for handed markup, and carries the same exposure, which is
worth naming rather than leaving implied: what a component writes at compile time is what it writes
for the render it was given. A subtree that stays closed there stays closed at request time for the
same reason -- it is client state, false on the server both times -- and a subtree that would open
per request is a decision the compiler cannot see either way.

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
does, which was already there. A getter and a setter, `bind:value={get, set}`, is the same rewrite
with the getter called: `element.js` writes `b.call(expression.expressions[0])` where the value
goes, `component.js` a getter returning that call, and the setter is never run while bytes are
written. Svelte itself refuses the pair on `bind:group`, so the group rewrite never meets one.

Everything the visitor drops is dropped, from the same reading: `bind:this`, the forty the table
marks, and `bind:value` on a `<select>` or on a file input, both of which it skips because the
attribute has no effect on either.

Three shapes are not an attribute, and each now says what it is rather than what it is not:
`bind:innerHTML`, `bind:textContent` and `bind:innerText` are written as the element's *content*,
replacing its children; `bind:value` on a `<textarea>` is the same; and `bind:group` is written as
`checked`, computed from the bound value together with the element's own `value` attribute.

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

### Both halves are built, and by one mechanism rather than the two this section priced

The line above drew between a choice of object literals and a name arriving with the request, and
priced them separately: the first as `class:`'s enumeration, the second as a runtime node writing
attributes from an object. Neither was built that way. What was built is the section above this
one -- **the marker stands for the element's whole attribute run, and the expression behind it is
Svelte's own `$.attributes` call**, the object rebuilt from the source and every other argument
read verbatim from what Svelte compiled. That call walks the object's keys per request, so it does
not care whether the object is a choice of literals, a name, or `{ ...data.attrs, id: 'i' }`; the
enumerable half was never a separate case once the run is one expression.

What waited on the per-item derivation was the each around press's home-route spread, and that
is settled in [derivation.md](derivation.md). What waited on the walk descending into a child is
composition, which is built, and every wrapper's `{...restProps}` is now this compiler's to write
rather than Svelte's to resolve. Both conditions came due, and the cost was the one measured
above: `attributes` and what it reaches, in the derivation bundle both backends run.

What stays refused beside it is listed where the mechanism is: a `class:` or `style:` directive on
the same element, an attribute mixing text with an expression, and `{...}` on a `<svelte:element>`.

## `{#key}` is the client's, and an each's `{:else}` is a second shape

Both were "measured, trivial, unwritten" in the table above, and both are written now. Read out
of `3-transform/server/visitors/KeyBlock.js` and `EachBlock.js` rather than inferred.

**A key block writes no block.** The server transform never evaluates the key: it writes
`<!---->`, the fragment, `<!---->`, and an empty comment is what the assembler already steps over
as a component boundary or a leading text marker. So the body is walked as if the key were not
there, because on the server it is not; the key exists for the client's reconciliation, which
compiles from the source, where it still is. Measured holding a value and a block.

**An each with an `{:else}` is two shapes, the way an if is.** Svelte's server writes

```js
if (each_array.length !== 0) { push('<!--[-->'); for (...) { ... } } else { push('<!--[!-->'); fallback }
```

so the anchor that opens the block differs by which shape was taken, which is exactly an if with
its branch marker inside the branch. The fallback is rendered from an empty list -- one more
render, keyed `-1` among the alternates as an else is -- and the lowering writes the block as
Svelte wrote it: an `if` around the `each`, with the opening anchor inside the first branch and
the fallback, marker and all, as the else. The test is what `ensure_array_like` decides,
`((xs)?.length ?? 0) !== 0`, so `undefined` is an empty list there as it is in Svelte. The
fallback is markup like any other, and its blocks are numbered within the each's else the way an
else's are within its if. Measured on a full list, an empty one, nothing at all, nested inside a
branch and with a branch inside it.

## `{#await}` is an if whose test is whether the value is a promise, and a boundary is no block

**`{#await}`.** Read out of `internal/server/index.js`, where `$.await` is eleven lines: a
promise writes `<!--[-->` and the pending branch, without waiting, and swallows the rejection;
anything else writes `<!--[!-->` and the then branch with the value handed to it; the catch
branch is never written, because nothing is awaited and so nothing rejects. Two branches decided
by one test -- `typeof value?.then === 'function'`, which is Svelte's `is_promise` -- so every
pass after the walk meets an if, and the anchors are bytes read off the render whichever they
are. Nothing in the rendered source is rewritten but the expression: the block stays an await so
Svelte writes its own anchors, and the expression becomes `Promise.resolve()` for the render that
holds the pending branch and something the pattern can take apart for the render that holds the
then branch, whose value is unused because every expression in it is a marker already. The value
substitutes the way a snippet's parameter does, destructuring and all, with a default or a rest
refused by the same rule.

The payload is data and holds no promise, so on a payload path the then branch is what a request
gets. A derivation may return one -- `Promise.resolve(data.a)` is measured -- and then the
pending branch is written, which is exactly what Svelte's own server writes for it. An earlier
draft of this section considered rewriting the block as an `{#if}` and reading the anchors from
that; measured, an if opens with `<!--[0-->` and `<!--[-1-->` where an await opens with
`<!--[-->` and `<!--[!-->`, so the bytes would have been wrong and the hydrating client would
have found a block it did not expect.

**`<svelte:boundary>`.** Read out of `3-transform/server/visitors/SvelteBoundary.js`. On the
server a boundary is one shape and not a decision: `<!--[-->`, its children, `<!--]-->` -- or,
given a `pending` snippet, `<!--[!-->`, that snippet's body, `<!--]-->` and none of the children,
because a synchronous render is pending by definition. The `failed` snippet is never written:
nothing throws during a render this compiler accepts, and if something did, Svelte would write
the failed snippet in place of the children and every marker planted in them would fail to come
back, which the hole check reports. So there is no block. The anchor pair is copied out as bytes
the way a package component's own anchors are, and what is inside is walked as anything else.
The failed snippet is cut from the rendered source, since a snippet with a parameter that nothing
renders is otherwise a refusal about a body nobody writes. `pending={p}` and `failed={f}` as
attributes are the tag form written differently, and are written back to it before the walk
reads the file: `SvelteBoundary.js` calls a `pending` attribute between the same `<!--[!-->` and
`<!--]-->` as the snippet block, and puts `failed` into the props of `$$renderer.boundary`, which
writes nothing for it. So a `pending` naming a snippet the file declares with no parameters is
copied inside the tag as `{#snippet pending()}`, and `failed` goes from the tag, with its
declaration when nothing else renders it. What stays refused is a `pending` that is not such a
name -- a prop, say: Svelte's scope cannot prove it defined and writes `if (p) { pending } else {
children }`, a choice per request over a snippet that arrived as a value, which is the same
refusal as a `{@render}` of one.

## Six small ones, each read out of the visitor that writes it

None of these was a boundary, and together they were most of what the allowlist still turned
away in a component with no composition in it. Each is one rule, and each rule is Svelte's.

**`translate={...}`.** `internal/shared/attributes.js` puts attribute values through a
replacement table with one entry: `translate`, `true` to `"yes"` and `false` to `"no"`, because
`translate="false"` means yes. A literal is folded by Svelte in the render and is bytes. A value
decided per request is a hole like any other, and the injector carries the table under the name,
the way it carries the boolean list. See [ir.md](ir.md).

**`bind:group`.** `element.js` writes `checked`, computed from the bound value together with the
element's own `value`: `includes` for a checkbox, `===` for a radio, and nothing at all where the
element has no `value` attribute. So the directive is rewritten to exactly that -- `checked={g ===
"a"}` -- before the walk, beside the other bindings the server writes as attributes.

**`bind:textContent`, `bind:innerText`, `bind:value` on a `<textarea>`.** The server writes
`$.escape(value)` as the element's content, and the children only where that comes out empty.
With no children the two are one thing, `{value}` as the content, and that is what the directive
becomes. An element with children stays refused: which of the two is written is a decision per
request that nothing takes yet.

**`bind:innerHTML`.** The same, unescaped: the value when truthy, the children otherwise, and no
anchor around either -- which is what tells it from `{@html}`, whose `<!---->` pair the client
reads. So it is a raw hole for `value || ''`, planted as text where the content goes, and the
directive goes.

**A content binding on an element with children.** `RegularElement.js` writes `if (body) {
value } else { children }`, and nothing around either branch. That is an if with no anchors, and
it is written as one: the walk plants a block whose first branch is the hole and whose else is the
children, so the else is rendered and found the way every other else is, and the block is marked
`bare` so that the assembler leaves the anchors that render carries out of the bytes. What is
tested is what Svelte tests -- the value itself for `innerHTML`, and `$.escape(value)` for the
rest, which is empty exactly when `String(value ?? '')` is, so `0` is written and `null` is not.
A `<textarea>` can hold no block; its children are text once Svelte has looked at them (anything
dynamic is moved into a `value` attribute by the analysis, which a binding beside it contradicts),
so there the choice is one escaped expression between the value and that text.

**A snippet parameter with a default.** A default is JavaScript's: taken when the value is
`undefined` and only then. So `{#snippet r(v = 1)}` binds `v` to `(arg === undefined ? 1 : arg)`,
and a destructured default reaches through the member the same way, which is one function shared
with an await's pattern. An argument not written is `undefined` too, so `{@render r()}` is a call
like any other, and so is one with more arguments than parameters: `RenderTag.js` passes every
argument through, JavaScript drops the ones nothing receives, and they bind nothing. A rest or a
nesting stays refused: neither is a member nor an index, so it has no way in. An each block's pattern used to be the one place a default was still refused, on the reading
that the name is bound by the runtime per item and a default is an expression the runtime would
have to evaluate. It is: `EachBlock.js` writes `let { id = d } = each_array[i]`, so the name is
the member unless that is `undefined`, and `null` is not defaulted. The runtime binds the member
the way it binds every destructured name, and every read of the name inside the body is written
as `(id === undefined ? (d) : id)` -- a derivation over what the block binds, made per item, which
[derivation.md](derivation.md) settled. The default goes out of the render's source, since the
render is given nothing it reads and every read in the body is a marker already. A rest or a
nesting stays refused, as in a snippet.

**`style:` mixing text and an expression.** `build_attribute_value` joins the parts into a
template literal with `$.stringify` around each expression, which writes nothing for null and
undefined. So the directive's value is written as that template, one expression, and the
declaration's presence is decided by it the way a single expression's already was:
`style:width="{a}px"` with `a` null is `width: px;`, and it is written, because that is what
Svelte writes.

**`<select value>`.** Read out of `renderer.js`. The renderer drops the select's `value` and
keeps it aside; each option compares its own value against it as it closes -- `includes` where
the select is `multiple` and the value an array, `===` otherwise -- and writes ` selected=""`
after its attributes when they match. An option's own value is its `value` attribute, or the one
expression that is its content, which the analysis marks so a number stays a number, or otherwise
its rendered text. A `bind:value` on a select reads the same way, and is no longer dropped.

So the select's value is cut from the render, which writes nothing for it, and every option
under the select gets a decision nobody wrote. It cannot be a marker: an option's attributes go
through the runtime helper rather than being folded into the template, and the helper writes a
boolean attribute as `=""` whatever its value, so a marker planted as the value never comes back
-- measured, and the second render that tells a swallowed value from an unwritten one then
called it safe, which is the one wrong answer that check can give. It is a decision the way a
`class:` is: the marker rides in an attribute of its own, written last, and the decision owns
the whole of that attribute and replaces it with nothing or ` selected=""`. The outcomes need no
render to be known. `defaultValue` on a select is the same comparison: `renderer.select()` takes
`value` and `defaultValue` both off the attributes, writes neither, and compares the options
against `value === undefined ? defaultValue : value`, which is what the test reads when both are
written. An option whose own value is mixed content stays refused by name.

## A byte oracle over press's own payloads, and what it found first

Every measurement above asked whether a route *compiles*. None asked whether the bytes are
right, because nothing had a payload to inject: the load functions depend on the site's virtual
modules and on Kit, and the stubs hold nothing. The dev server has it. SvelteKit exposes each
route's data at `<path>/__data.json`, devalue-encoded, and decoding it gives the `data` a request
would bring. So the oracle is: fetch the payload, compile the route through the same pipeline the
build uses, inject, and compare against Svelte's own server render of the same route entry given
the same data. press itself is never touched; its output is read.

**Every one of press's seven routes is byte-identical** as of the rules below, one of them
346 KB and one 238 KB long. Five were after the first six fixes. What
stood between the compile and the first comparison was six things, each invisible to a compile that never
evaluates a derivation, and each recorded where it belongs: the `file:` specifier a sample maps a
workspace library to, which esbuild cannot resolve; the TypeScript a `lang="ts"` component writes
its expressions with, which `new Function` cannot read; what gets carried, which was gathered from
the markup's names and was wrong both ways; a path rooted at an imported constant, which resolved
against the payload; a prop left for Svelte to evaluate, written with a name the render had
neutralised; and a dynamic component named by a `$derived`, below. See
[derivation.md](derivation.md) for the first four.

**A component tag naming a rune declaration is a dynamic component.** `metadata.dynamic` in
`2-analyze/visitors/Component.js` is set for a binding whose kind is not `normal`, and the server
then writes `<!--[-->` and `<!--]-->` around what it renders, or `<!--[!--><!--]-->` when the
value is nothing. press's language switcher picks its trigger's icon that way, `const CurrentMark
= $derived(code === preferred ? Compass : markFor(current))`. The declaration reads a prop, so the
render had been handed a literal for it, and the tag rendered nothing where a request renders an
icon: ten bytes short on every route that carries the switcher. `<svelte:component this={...}>`
goes through the same `build_inline_component`, dynamic, so the tag is rewritten to that with the
expression expanded -- what the name stands for, with every fixed path a literal -- for Svelte to
evaluate. A tag naming a plain `const` is not dynamic and is not rewritten. One whose expression
reaches the request is a component chosen per request, which is a structure that is not
enumerable, and is refused by name; the article route's switcher is that, being given the
article's own language, and declaring `data.meta.lang` a domain is what would enumerate it.

**A value the request does not decide is bytes, and the render is where it is computed.** The
home page's newsletter block reads `createEngagementQuery().data?.subscriber_count ?? 0`, and
the walk planted a hole for it because it was not a literal. A hole is a derivation, and a
derivation is a value asked for per request; asking for this one meant evaluating it outside a
render, which is impossible by construction. Read out of the package and out of Svelte:
`createBaseQuery.svelte.js` is a runes module, legal only once Svelte's compiler has been over
it, which esbuild has not; `useQueryClient()` is `getContext()`, and `get_or_init_context_map`
in `internal/shared/context.js` throws `lifecycle_outside_component` when `ssr_context` is null,
which it is anywhere but inside `render()`. Kit renders it because the whole tree runs inside
`render()` under the layout's provider, with Vite's plugin compiling the module. So does this
compiler's own render, and it computes what Kit computes: `enabled: browser` is false on the
server, the query never runs, `data` is `undefined`, the count is `0`, the same on every request.
Which is the whole point: an expression that reads nothing the request decides is not a value
the runtime resolves, it is structure, and it is baked. So the walk writes such an expression out
for Svelte to evaluate and plants nothing, the rule a prop handed to a package already followed.
An earlier attempt at this rule was narrowed, above, because components compiled one at a time
threw without the context a route brings; a route is the unit now, and that reason is gone.
Anything ambient in such an expression, a clock or a random, is refused before it by `resolved`.
What is still a hole is exactly what varies: a payload path, a name a block binds, an id the
runtime counts.

**Written as the author wrote it, where the walk bound nothing in it.** The expansion of a name
is its initialiser, and the render runs the author's script whole: `const u = new URL(x);
u.searchParams.set('q', y)` holds the query at render time and the expansion of `u` does not --
press's home page lost `?q=` from a link that way. So the render is given the author's own text
wherever the expansion through what the walk bound -- a snippet's parameters, an argument's way
in -- is the same as the expansion without, and the expansion only where it is not.

**A block the request does not decide is decided once, by the render.** An `{#if}` whose every
test reads nothing the request decides is bytes too: the branch it takes, between anchors the
assembler copies as it copies a package's own. The walk is not told which branch the first time
through, so it asks -- a statement at the end of the instance script reports the test's value --
and every render of that pass, the baseline and each alternate, has its say, so a component in a
branch the baseline does not take answers too. Then the walk runs again told, walks only the
branch taken, and plants no block. A test no render answered is not asked again and is walked
as the decision it was, which the runtime makes. Under a test not yet answered, nothing is handed
to the render to evaluate and nothing further is asked: the render of that pass forces a branch
to hold it, and `tip.stat.lang` under `{#if tip}` throws where `tip` is state with no value.

**An each the request does not decide is iterated per request all the same**, so the runtime has
to hold its source -- as the value, never as the computation. press's subscriber counter takes
its digits from that query. The render is asked for the value as JSON, and the literal stands
where the expression stood, so the runtime iterates data. **A prop the request does not decide is
bound the same way** where the render can say: to the render's value as JSON rather than to the
expansion, which is what carried the query above through a component. A value is answered only
where it is data -- a string, a number, a boolean, null, arrays and plain objects of those; a
`URL` or a `Date` would round-trip as a string and come back a different thing, and for those
the expansion stays.

**A call into a runes module is decided by the render whatever its arguments read.** press's
article reads `createReadsQuery(() => slug).data?.read_count`, and `slug` is the payload's. The
expression mentions the request, and its value on the server is decided inside a render by the
library without the argument's value ever mattering: a query is pending on the server whatever
its key. `reads.svelte.ts` is a runes module, compiled by Svelte and legal nowhere else, so the
render is the only place it can be evaluated at all. So a read of the request that sits only
inside the arguments of a call into a runes module does not make the expression the request's,
and it is asked of the render like anything else the request does not decide -- in the file's
own names, since the copy has those in scope and the caller's it does not.

**A `?:` whose branches a marker cannot stand for is a structure wherever it is written**, and
is enumerated the way one handed to a package is: `{#if (summary ? PROVIDERS[summary.provider] :
undefined)?.icon}` chooses between icon components on a payload key, and so does
`{summaryProvider.name}` beside it, whose object holds the same components. Told which way, the
expression is what the branch leaves, and the render decides it. Evaluating either per request
would have reached for components in a scope that holds data. What makes a branch one a marker
cannot stand for is that it names something or is a function; `(undefined).entries`, which is
what state with no value expands to, names nothing and is a value like a literal, and the
ternary around it is the runtime's.

**With the article at 238 KB byte-identical, all seven of press's routes are.** Its compile was
eight minutes, of which nearly all was renders: each pass rendered the baseline and one alternate
per block, and a route with ninety blocks that asks three times rendered every alternate three
times over. The first thought was to cache them across passes, and it does not work: once a test
is answered the block it decided is folded into bytes, every block after it is renumbered, and no
alternate of the earlier pass is the alternate of the next. What is true instead is that **an
asking pass needs an alternate only where the alternate can answer**. The baseline has run every
script the taken branches hold; what it has not run is a component inside a branch it does not
take, and that component's asks are answered by that branch's alternate and nowhere else. So a
copy records the branches its call site sits within, an asking pass renders the alternates that
hold an asking copy and skips the rest, and the probe, the dead holes and the class outcomes wait
for the pass that is told everything, whose bytes are the ones they read. The article's three
passes went from ninety alternates each to eight, one and one, and the compile from 438 to 126
seconds, byte-identical still.

**Two more things the same oracle found beside these.** A class written as an expression on an
element the stylesheet could match: Svelte scopes the element when it cannot read what the class
could be -- `gather_possible_values` in `2-analyze/css/utils.js` reads a literal, a ternary, a
logical and an array, and gives up on anything else -- and a marker or a constant written there
is a literal it can read, so the hash went missing. Whatever is written into a class value is
wrapped as `(0, ...)`, a sequence, which evaluates to the same thing and cannot be read, as the
author's own expression could not be. And `to_class` writes the value and the hash with a space
between, the hash alone for an empty value, and nothing for neither, so a class that is one
expression on a scoped element is a decision with the value inside its non-empty outcome, the
way a `class:` is one with the hash inside its outcomes. The other: an each's key goes from the
render, because Svelte's server never reads one and the placeholder the render iterates is what
`(tile.stat.lang)` was evaluated against.

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

### `class={expr}` beside a directive is Svelte's own call, carried

It used to be refused here: the falsy branch removes the directive's name from that value, so which
bytes exist is decided by a string that only exists per request. That is true, and it is not a
reason to enumerate. `build_attr_class` compiles the element to `$.attr_class($.clsx(value), hash,
{ on: t })`, one call whose result is the whole attribute -- space, name and value -- or the empty
string, and `attr_class`, `clsx` and `to_class` are pure functions in `internal/shared/attributes.js`.
So the hole is that call, with the value as `build_attribute_value` builds it (through `clsx` where
`2-analyze/visitors/Attribute.js` says a value needs one, which is anything but a literal, a template
or a binary expression; a template literal where text stands beside it), the hash read off the
render the way a `class:` decision reads it, and the directives as the tests they are. The hole
owns the whole attribute, which is one more thing the assembler knows about a marker landing in one
(`whole` on the hole), and the two functions go in the carried bundle beside `attributes`, so both
backends run Svelte's implementation of the removal rule rather than agreeing about one. The same
`clsx` now wraps a class written as one expression with no directive beside it, which used to write
an array as its `toString`.

## A `?:` handed to a package chooses what is handed, and is enumerated

The last route of the real application stopped inside a translation package with `callableMessage
is not a function`. What it had been given was a marker, and what it wanted was a function:

```svelte
const message = $derived(
  (code === 'zh' && source === 'tw') || (code === 'tw' && source === 'zh')
    ? m['notice.script']
    : source === code ? m['notice.polished'] : m['notice.translated'],
);
<ParaglideMessage {message} ... />
```

`code` is the locale the build fixes and `source` comes off the request, so the expression picks a
different function per request. Under the law in [pipeline.md](pipeline.md) that is a decision with
enumerable outcomes -- two structures once the locale is fixed -- but it sits in an expression
rather than in the markup, where the blocks are. Two ways were on the table.

**Refuse it, and say the other spelling.** Move the choice into a block: `{#if source === code}
<Message .../>{:else}<Message .../>{/if}` compiles today, and the refusal would be the third kind
above. Rejected because the author wrote a page SvelteKit serves, and the target is that every
such page compiles without being rewritten for this compiler.

**Enumerate it.** The compiler renders once per branch and keeps both, the way it renders once per
value of a declared domain. This is what was chosen, and what follows is how it is bounded.

### Which ternaries, because a marker still stands for most of them

Not every `?:` in a prop. A marker stands wherever the value is *written*, and a ternary whose
branches are all things a marker can stand for is a value like any other: `tone === 'dark' ?
'text-black' : 'text-white'` on a package's icon is written per item inside an each block, which
one marker does and which enumeration could not have done at all. So the rule is about the branches
and not about the operator:

| a branch that is | a marker | because |
| --- | --- | --- |
| a literal, a template, `undefined` | stands for it | it can only be written |
| a value the request decides | stands for it | it would have to be a marker whatever it was |
| anything else the request does not decide | **cannot** | it is a name, a member, a call, a function, an object -- what `inert` leaves for Svelte to evaluate, and a string in its place is the crash above |

A ternary with a branch in the third row is enumerated; a ternary in a branch is asked the same
question, so a choice between choices comes out as a tree. It is `settle` in `pkgs/ast`, and the
first draft enumerated every ternary in an opaque prop, which turned link cards and the language
switcher away for a choice between two strings that had always compiled.


**And not one whose test the request does not decide.** `code === preferred ? Compass :
markFor(current)` with `code` fixed is a choice Svelte can make in the render, and it was being
enumerated anyway: one structure per constant choice, the second the first again, on every route
that carries the switcher. A ternary is enumerated when its test varies with the request; one
that does not is left to Svelte the way any inert expression is, and only what is inside its
branches is looked at.

### Where the branch goes, because a component call has no anchor

A `class:` decision is joined where its attribute sits, because lowering can find the attribute in
the render. A component call has nothing around what it writes -- the same line of
`visitors/shared/component.js` that makes every item above hard -- so there is no place inside the
render to put an `if` whose branches are the two things the package wrote. The join is therefore
the one a declared domain already has: the whole route, rendered once per branch, under one `if`
at the top of the artifact, with each branch tested by the expression it was rendered for. Nothing
new in the IR, the injector or lowering; `joined()` in `pkgs/compiler` gained a second kind of key.

Rewriting the source to an `{#if}` instead was considered and is not available: a block writes
`<!--[0-->` anchors the client was not compiled against, and the client is compiled from the
author's own source.

### Found rather than declared, and a tree rather than a product

The build cannot declare these: the expression is the author's, and a declared domain is for a
value the compiler cannot see the branch of. So the walk finds them. Meeting a ternary it has not
been told about, it stops with `Undecided` naming the test, and the build replaces that run with
two -- the same run told `true`, and told `false`. A ternary in one of those branches stops again
one render deeper. The runs come out as a tree: a choice inside the branch that is not taken is
never rendered, and two nested choices cost three structures rather than four.

The key is the test's own source text, after expansion, so `code` has become its literal and a
prop has become the caller's expression by the time it is compared. `descend` has to let this one
error through where it turns every other into a component left to Svelte, since it is the walk
asking for something rather than failing at it.

### What it costs, and what it refuses

Each choice doubles the renders of the route it sits in, and the hundred-structure warning in
[pipeline.md](pipeline.md) now counts these beside the declared domains. A test the request does
not decide is not folded -- once the locale is fixed, `("en") === 'zh' && ...` is still rendered
both ways, one of which no request reaches -- because folding would be evaluating the author's
expression at build time, and the structure it produces is correct if unreachable.

A test that reads a name an each block binds is refused, with the other spelling: the choice is
made per item, the derivation the branch is tested by has no item to read, and an `{#if}` around
the component inside the each is a block and is taken per item.

The route that forced this now walks past the notice and into the link cards, and stopped one
component later on `$props.id()`, which is the next section.

## `$props.id()` is counted by the runtime

[derivation.md](derivation.md) refused it as a value each side generates. Read rather than
assumed, it is nothing of the kind:

| | |
| --- | --- |
| `transform-server.js` | `const id = $.props_id($$renderer)` is made the first statement of the component |
| `props_id` on the server | `renderer.push('<!--$' + uid + '-->')`, the uid from a counter kept per `render()` |
| `props_id` on the client | while hydrating, if the current node is a `$` comment, take its text as the id |

So the id is the server's, and the client compares nothing. That looked like the best case for
static bytes -- the compile-time render writes an anchor and a request-time one would write the
same -- and Svelte's own output says otherwise, on two shapes measured before anything was built:

```
{#if a}{:else}<Id/>{/if}{#if b}{:else}<Id/>{/if}{#each items as it}<Id/>{/each}

a=false b=false items=[p,q]     <!--$s1-->  <!--$s2-->  <!--$s3-->  <!--$s4-->
```

The two else branches are rendered separately here and each numbers from where its own render
stands, so both would carry `s1`. The each body is rendered once and would carry one id for every
item. Neither is the bytes above, and duplicate ids are not a hydration fault -- the client adopts
whatever it finds -- but they are wrong HTML: `aria-describedby` on the second card resolves to the
first card's description.

**So the id is the one value in the IR the backend makes rather than reads.** A `slot` carrying
`fresh` writes the next id, `s1`, `s2`, ... per response in output order, and binds it under the
slot's path in the innermost scope; every read of the id is a slot on that path, and a derivation
reading it is computed where it is used, as one reading an each binding is. Output order is the
order Svelte's counter runs in, since the anchor is the first thing a component writes, so the
bytes are the ones Svelte would have written and the corpus holds them to that without an
exception. What a backend pays is an integer and a string per instance, which is what Svelte's own
server pays; a scheme that avoided the counter -- a site number with the each index appended --
would have cost the oracle instead.

### Two ways an anchor is found, because there are two kinds of component

**A component the walk entered** has its anchor planted. The declaration stays in the copy, so
Svelte still writes the anchor where it writes it, and the compiled copy has the one call
`$.props_id($$renderer)` replaced by a helper that writes the hole's marker in place of the id.
Replacing the call rather than the helper keeps the placement Svelte's; the helper cannot be given
the marker any other way, since a reference to `$$renderer` from the instance script is refused by
Svelte's analysis and nothing the server runtime exports reaches the renderer.

The name the id is bound under is one per copy, `__i` and the copy's ordinal, so two components
declaring an id in one page do not share a binding, and the name is in the walk's dynamic set:
an expression reading it varies per request and is a hole, however inert the rest of it looks.

**A component the walk did not enter** is Svelte's to render, and packages declare ids too -- a
menu trigger names the panel it opens by one. The render is given an `idPrefix`, so every such id
is a token nothing else produces, numbered by Svelte, and the anchor is told from a read by the
`<!--$` around it rather than by which came first.

**Those ids are markers rather than holes, and the difference is the whole of what makes them
work.** A hole is a position in one list every render shares. Svelte numbers ids per render, in
instantiation order, so the same component is `s5` in one render and `s6` in another that took a
different branch -- and neither a hole per render nor a hole shared between them can hold that. Per
render leaves holes that no region is ever read for, which is what `__p1 is written but never comes
back` was; shared gives one hole to two different components. So the number goes into the marker,
each render says what it means, and lowering reads it where it stands. That also costs nothing to
put an id in an attribute, which is where a package puts it -- `aria-controls="p-s3"` -- because the
scan that finds it is the one that already finds every other marker.

The name is the number Svelte gave, which is one per render rather than one per component, and that
is enough: a component's reads follow its own anchor and end before a sibling's begins, and one
nested inside it is instantiated after it in every render that holds both, so a rebinding never
reaches a read that meant the outer one. A first draft mapped anchors to walked components by
counting them in document order, and the first real route had a package's anchor in the count.

### What this changed beside itself

A derivation is marked as computed per use by scanning its expression for the names in scope, and
the scan stepped over a template literal as if it were a string, so `` `${id}-panel` `` read
nothing. That was wrong for an each binding as well and had not been met; the template's
expressions are scanned now.

## The marker saying which block closed is a sibling, and Svelte's CSS reads siblings

Every block writes a stamp after it so the assembler can tell our blocks from those a package
renders -- a package's `{#if}` opens and closes exactly as ours does, and matching by order counted
somebody else's as ours. The stamp is removed again when the IR is assembled, so it reaches no
artifact and no reader. **What it must not do is change anything else in the render it sits in**,
and it was doing exactly that.

It was a `<template>` wherever text was not writable, which was almost everywhere. A `<template>` is
an element, and Svelte's CSS analysis walks elements: `get_possible_element_siblings` stops at the
first one it meets, so a stamp standing between two of the author's elements makes `.a + .b` stop
matching and **both of them lose their scoping class**. Nothing says so; the page renders unstyled
in one place.

Measured, every carrier in every parent, against the same markup carrying none:

| parent | text | `<template>` | `<option>` |
| --- | --- | --- | --- |
| anything ordinary, the root, `<pre>`, `<option>` | same | **differs** under `+` or `~` | refused |
| `<table>` and its parts | refused | same | refused |
| `<select>`, `<optgroup>` | makes it rich | makes it rich | same |

**Text is not an element, so the analysis steps over it**, and it is the carrier wherever text is
writable. An element is used only where it is the one thing that works: an `<option>` inside a
`<select>`, where anything else makes the select *rich* and changes how it closes, and a
`<template>` inside a table, where text is refused outright.

A `<template>` inside a table keeps the problem, and no carrier there avoids it. So that one
combination is **refused**: a block directly inside a table part, in a component whose stylesheet
relates siblings with `+` or `~`. The stylesheet says so in its own AST, which is cheaper than
meeting it, and the alternative is a page that is quietly missing a class. Everything else compiles.

This was found through a route that would not compile, and the failure named something else
entirely -- a value written but never coming back, three components away from the stamp that had
made the compiler read the wrong block as a package's. The scoping class was the second half of it:
a `@keyframes` rule scopes every element in a component, the stamp included, so a `<template>`
carrier comes back wearing a class and the assembler stopped recognising it. It reads the tag to
the `>` now rather than matching `<template>` whole.

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
