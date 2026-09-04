# What a refusal means

The compiler refuses things. An author who meets one needs to know which of three situations they
are in, because the three ask for different actions, and until this file existed the compiler said
the same kind of thing for all of them.

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
| `{...spread}`, `<svelte:element>` | an unenumerable decision, so a small closed runtime node |
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
*inside* a decision. It is still refused, and it is **not** waiting on what `class:` waited on: a
class directive's value never reaches the bytes, so its outcomes are two, while a style
declaration's value does, so its outcomes are the values.

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
