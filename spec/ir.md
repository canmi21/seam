# The intermediate representation

The IR is what the compiler produces and the server consumes. It is the artifact the whole
rewrite exists to introduce: v1 had no shared typed representation, and the thing that crossed
between the two halves was a string.

## What it is

**A program that emits HTML, not a model of the document.** Walking it produces the response
bytes. It says what to concatenate and in what order, and nothing else.

`<article>` is not a node. It is part of a string. There is no element tree, no attribute map,
no tag nesting, because a runtime that only concatenates does not need them. That is what lets
a backend be dumb: resolve a path, escape a value, append. Three operations, no knowledge of
Svelte, no knowledge of HTML.

## What it replaces

v1 stored the skeleton as HTML text carrying `<!--seam:...-->` markers, and re-tokenized it on
every request. Three hand-written HTML parsers existed because of that decision: one to extract,
one to verify the extraction, one to inject. Measured on a 30KB page with 200 dynamic positions,
scanning that text cost 26.3us against 15.4us for walking a precompiled tree, and the scan grows
with the length of the skeleton while the walk grows with the number of nodes.

The speed is not the reason. Neither number is close to mattering against a budget of several
hundred microseconds. **The reason is that two of those three parsers stop existing**, and with
them the class of bug where the extractor and the injector disagree about what a marker means.

## Node kinds

Five, and the tree bottoms out in strings. `body` and `head` are the two streams Svelte renders
and the two the injector produces; `title` is the channel it keeps beside them. A component that
uses none of the three leaves `head` and `title` empty.

```json
{ "component": "product", "head": [], "title": [], "body": [
  { "t": "static", "s": "<!--[--><article class=\"card\"><h1>" },
  { "t": "slot",   "path": "data.name", "escape": "content" },
  { "t": "static", "s": "</h1>" },

  { "t": "if", "branches": [
      { "test": "data.available", "body": [ {"t":"static","s":"<!--[0--><button>Buy</button>"} ] },
      { "test": null,          "body": [ {"t":"static","s":"<!--[-1-->"} ] }
  ]},

  { "t": "static", "s": "<!--]--><!--[-->" },

  { "t": "each", "source": "data.tags", "item": "t", "body": [
      { "t": "static", "s": "<span>" },
      { "t": "slot",   "path": "t", "escape": "content" },
      { "t": "static", "s": "</span>" }
  ]},

  { "t": "static", "s": "<!--]--></article><!--]-->" }
]}
```

- **`static`** -- an opaque string. Markup and Svelte's anchors sit in it indistinguishably; the
  runtime neither parses nor inspects it.
- **`slot`** -- a data path and an escape mode. Nothing else, but for one flag: `fresh` marks the
  anchor of a `$props.id()`, whose value the runtime counts out rather than reads -- `s1`, `s2`, in
  output order, which is the order Svelte's own server counts in -- and binds under the path in the
  innermost scope for every read that follows. The one value in the IR a backend makes rather than
  resolves, and it is a counter. See [refusals.md](refusals.md).
- **`if`** -- branches, each with a test and a body. The last branch may have `"test": null`,
  which is the else.
- **`each`** -- a source path, the name bound to each item, an optional `index`, and a body.
  `index` is the name the source binds to the counter, and it is absent rather than null when the
  source binds none. **A key is not here at all**: Svelte's server transform never mentions one,
  and a keyed each renders byte for byte what an unkeyed one renders -- measured, on a full list
  and an empty one. A key exists for the client's reconciliation, and the client compiles from the
  source, where it still is. **An `{:else}` is not here either**: an each with one is lowered as
  an `if` around the `each`, testing whether the list has anything in it, with the fallback as
  the else -- which is the shape Svelte's own server output has, and it needs no node of its own.
  See [refusals.md](refusals.md).
- **`attr`** -- one attribute of the element being opened, written between the static chunk
  that opens the tag and the one that closes it. It carries `parts`, which are `static` and
  `slot` nodes, and it is the only node that can decide to write nothing at all. One name carries
  a table with it: `translate`, whose value `true` is written `"yes"` and `false` `"no"`, because
  `translate="false"` would mean yes. It is the whole of Svelte's `replacements` in
  `internal/shared/attributes.js`, and a backend carries it under the name the way it carries the
  boolean list.
- Bodies are node arrays, so the shape recurses.

- **`call`** -- a fragment's name and what each of its parameters is bound to, a path or a
  derivation resolved where the call sits. The runtime opens a scope holding the parameters and
  walks the fragment's body there, the way an `each` opens one per item. The bodies live beside
  the streams in `fragments`, by name, and are absent where a component has none. This is
  recursion in structure -- a component rendering itself, a snippet rendering itself -- and nothing
  else: the body is fixed and the depth is the data's. See **Recursion is a fragment and a call**.

`{@html}` needs no node of its own. It is a `slot` with `escape: false` between two static
`<!---->` chunks, which is the anchor pair Svelte writes around raw HTML. Nothing checks what
those bytes are, which is the author's, and is written out in [refusals.md](refusals.md).

## Svelte's anchors are baked in, not emitted

The comments in the output are not Seam's protocol. They are **the calling convention of
Svelte's client-side hydration**, which reads `<!--[-->`, `<!--]-->`, `<!--[0-->` and `<!--[-1-->`
to find block boundaries and learn which branch was taken. Seam's own structure is carried by
the node kinds above and never appears in the output.

Every anchor is a constant, so every anchor is compiled into a `static` chunk -- including the
per-branch markers, which live inside the branch they belong to. **No backend ever emits one, so
no backend ever needs to know that Svelte exists.** That is what makes "any language that can
concatenate strings can serve this" true rather than aspirational, and it is why the branch
marker is inside the branch body rather than a field the runtime interprets.

The alternative was an invented vocabulary translated at request time. It was measured at about
4% over the baseline walk, so cost was not the objection. The objection is that it expresses the
same information twice and puts a Svelte-shaped obligation in every backend.

v1 could not do this. It aimed to support more than one UI framework, so it could not depend on
any one framework's ABI and had to define its own. v2 commits to Svelte, which is what makes
borrowing the ABI available.

## An attribute can disappear, which is why it is a node

`data-x={value}` is not `data-x="` plus a slot plus `"`. When the value is null or undefined
Svelte writes no attribute at all, and a slot inside a static chunk cannot take the surrounding
characters with it.

The rule is narrower than it looks, and was measured rather than assumed:

| written | result |
| --- | --- |
| a single expression, null or undefined | the attribute is absent |
| a single expression, empty string | `name=""` |
| a single expression, `false` or `0` | `name="false"`, `name="0"` |
| several parts, one of them null | the null becomes empty, the attribute stays |

So an `attr` node omits itself only when it has exactly one part, that part is a slot, and the
value resolves to null or undefined. Everything else is written.

**Except where the name decides otherwise, which it does in two ways.** An `attr` node carries a
`presence`:

| | |
| --- | --- |
| `value` | written unless the value is null or undefined |
| `boolean` | present or absent: `name=""` when the value is truthy or an empty string, nothing otherwise |
| `nonempty` | written unless the value comes out empty |

So `disabled={false}` produces nothing while `data-x={false}` produces `data-x="false"`, and
`class={""}` produces nothing while `title={""}` produces `title=""`. `hidden` is boolean for
every value but `until-found`, which the value decides rather than the name. All three are facts
about HTML rather than about Svelte, which is what makes carrying them into the runtime
affordable.

**This is the one rule the render cannot show, and the reason is worth recording.** Rewriting an
expression to a sentinel makes it a string literal, and Svelte folds a literal attribute into the
template rather than calling the helper that decides presence:

```
disabled={data.d}      $.attr('disabled', data.d, true)     the helper, with boolean semantics
disabled={"%%s0%%"}    <input disabled="%%s0%%"/>           folded, the semantics gone
```

The bytes collected are correct for the rewritten program and wrong for the written one. No other
rewrite helps: a boolean attribute's output is `name=""` or nothing, and **a sentinel can stand
where a value is substituted but not where presence is decided.** So the `attr` node carries a
`presence` field and the runtime carries the rule, and a backend still does not learn that Svelte
exists.

It was found by measuring rather than by reading, and the corpus missed it because the case that
covers attributes writes `disabled` as a static attribute. A static attribute cannot stand in for
a dynamic one, here or anywhere else: it takes a different path through the compiler. The general
form of both halves -- where a sentinel can stand, and why a static example measures the wrong
program -- is in [pipeline.md](pipeline.md).

## Escaping is Svelte's, and is not what you would guess

`escape` is a mode, not a boolean, because Svelte escapes two ways and neither is general HTML
escaping:

| mode | characters replaced | left alone |
| --- | --- | --- |
| `content` | `&` `<` | `>` `"` |
| `attr` | `&` `<` `"` | `>` |
| `false` | none | the raw HTML slot |

`>` is never escaped, in either. That is Svelte's `escape_html` in `src/escaping.js`, and it is
part of the ABI for the same reason the anchors are: the bytes have to match.

This was not deduced. The first run of the conformance diff described below disagreed with
Svelte on `<b>&x`, because the obvious implementation escapes `>` and Svelte does not. It cost
one run to find, and would have cost considerably more as a hydration mismatch reported by
somebody else.

## Composition inlines, and needs no node

A child is spliced into its parent at compile time, with its paths rewritten.
`<Badge label={data.name} />` lowers the child's `{label}` into a slot on `data.name`;
`<Badge tone="warm" />` lowers the child's
`{tone}` into **static text**, because a prop passed literally has nothing left to resolve. The
runtime has no notion of a component, and the injector did not change to gain one.

That works only because every prop value is already a path or a literal, which is the same
constraint the protocol places on everything else. A prop that mixes text and an expression is
refused: it has no value to pass until something computes one.

The unit is still the component. A bundle carries the entry and everything reachable from it,
and lowering walks that graph -- so a cycle is an error rather than a hang, and a component the
bundle does not carry is named rather than skipped.

## Recursion is a fragment and a call

`<svelte:self>` is `build_inline_component(node, analysis.name)` in `SvelteSelf.js`, a component
calling itself; a component importing its own file is the same call; a snippet rendering itself is
its function calling itself, `RenderTag.js`. In all three the body is one fixed shape and the
depth is whatever the data has -- a tree, a thread of comments -- which is recursion in structure
and not in code, and the IR carries it as such: the body once, under a name in `fragments`, with
its parameters as names the body reads per call, and a `call` node wherever it is entered, the
first time from outside included. The runtime binds each parameter to the value at its path, in a
scope of its own, and walks the body; a `call` inside the body is met again with the next value,
and ends where the data does.

**How the body gets its region.** A component call has no boundary in the bytes, so the walk
gives the body one: it wraps the body in `{#if true}` in the render, marked `bare` so the anchors
the render carries stay out of the bytes, and the assembler finds the region by the block's stamp
as it finds any block's. Two things `clean_nodes` does to a fragment had to be written back: a
snippet's or component's body that opens with text gets `<!---->` ahead of it (`is_text_first`),
which an if's body does not, so the fragment carries `textFirst` and the assembler writes it; and
the body of a recursive component has to hold no `<svelte:head>`, which cannot sit in a block, so
one that does is left to the render. A rest gathered per call is left to the render as well.

**How the calls get their bytes.** Every call but the first renders a stand-in in place -- an
empty snippet rendered, an empty copy called -- and the stand-in writes the hole's marker itself,
from a `{@const}` in the snippet's init or from the copy's script, both of which run where the
call renders and hold nothing in the fragment. So Svelte writes around the render tag or the
component call exactly what it writes around the original, and the assembler reads the marker as
the `call`. The marker used to stand beside the stand-in as text, which held until a call stood
alone in an each: text first in the body is what `is_text_first` writes `<!---->` ahead of, and a
second node beside the call is what stops `is_standalone`, after which the call writes `<!---->`
after itself. Measured against Svelte's own recursion for the three spellings, a body opening with
text, a parameter default (`depth = 0`, taken where the argument is `undefined` as JavaScript
takes it), a second call from outside, and a call alone in an each. `pkgs/skeleton/src/walk.ts`,
`standIn` and `selfCall`; `marks()` in `sentinel.ts`.

**The three shapes that waited for a case are taken.** A recursive snippet whose parameter is a
pattern binds the names inside it, each reached from the argument the way a destructured
declaration is, and those names are the fragment's parameters; a default inside the pattern is
the runtime's per call, and the render, handed an empty object, is given `undefined` in its place.
The entry rendering itself through `<svelte:self>` is the fragment the way a child is, its props
the parameters and the payload's own paths what the first call binds them to. A cycle through a
second component -- `A` renders `B` renders `A` -- is read off the imports before the walk goes
in, `reachesItself`, so every component on the cycle is entered as a fragment and whichever of
them is met again while still on the stack is a call of the fragment it became. A pattern
defaulted whole, `({ a } = {})`, is the default wrapping the argument and the pattern taking that
apart, measured with the first call handed nothing. A rest is a parameter like the others, bound
per call to what the call wrote and the pattern did not name. A fragment whose component writes a
head is two fragments, a head half beside the body's, called from the head stream wherever the
body's is called; [refusals.md](refusals.md) has how the render is made to write its anchors.
Still refused, saying so: a head that reaches a fragment from a component inside its body.

## The anchors come from Svelte, not from us

Every anchor in a static chunk is Svelte's, and the compiler no longer works out where they go:
it renders the component with no data and splits the result. Reproducing that placement by hand
was tried first, cost four undocumented positional rules before the first real component, and was
still growing when it was replaced. See [pipeline.md](pipeline.md).

What survives here is the shape: a chunk is opaque, the runtime never inspects it, and no backend
emits an anchor of its own. That was the point of baking them in and it is unaffected by where
they now come from.

## Expressions are not evaluated

**`test` and `path` are data paths. They are never expressions.**

That is what lets a backend serve a component without a JavaScript engine. Walking this IR needs
three things -- follow a dotted path over the payload, escape a string, and ask whether a value is
truthy -- and none of them is JavaScript. An engine is needed exactly when a component carries a
derivation, which happens exactly when the author wrote something that is not a path. **Measured on
the corpus: 10 of 14 components carry none.** A Rust server runs those with nothing embedded in it.
See [derivation.md](derivation.md), where what would end that property is recorded.

**A compiled backend decides this once, for the whole binary, from a `cfg` flag.** One component
with a derivation is enough to need the engine, so the question is about the artifact rather than
about a route, and the manifest answers it in one field:

```json
{ "expressions": false, "routes": { ... } }
```

Reading a field rather than scanning every route is the point: a build script that had to open each
IR to decide would be reimplementing this rule somewhere it could drift from. See
[build.md](build.md).

`data.available` is legal. `price > 10` never reaches the IR: the compiler rewrites it into a
derived field and carries the expression separately, so what the IR tests is always a path and
what evaluates the predicate is a stage that runs before injection. See
[pipeline.md](pipeline.md) for why, and [derivation.md](derivation.md) for what such an expression
is allowed to be a function of. Elements, enums and nullables are finite decisions and belong in
the protocol; predicates over open value spaces are not, which is the correction the second
article makes to the first.

Written as a field constraint rather than a convention because the failure mode is gradual: an
IR that accepts one comparison grows an expression evaluator, and an expression evaluator in the
runtime is a JavaScript runtime in the backend by another name. That is the thing being removed.

## Scope

`each` binds `item` for the extent of its body, and `index` beside it rather than through it,
which is what the `for` loop Svelte compiles to does with its own variable. Path resolution walks
a scope stack: entering an `each` pushes the bindings, leaving it pops.

Chosen over v1's `$.` prefix convention because prefixes collide under nesting -- two nested
`each` blocks have no way to say which `$` they mean, while named bindings shadow in the ordinary
way.

## One IR per component

**The unit is the component, and page IR is composed from component IR.** A page-level flat tree
would be simpler today and impossible to fix later, because CTR's unit is the static component
graph rather than the file.

Svelte wraps every component render in `<!--[-->` and `<!--]-->`, so the composition seam and the
output seam are the same place. That is not a coincidence: both describe where one component's
output ends.

## The head is a second stream

`render()` returns a head as well as a body, so the IR carries both. Reading only the body is how
a `<title>` came to compile without complaint and then not exist -- present after hydration,
absent from the response, which is the failure this whole approach exists to avoid.

A head is assembled the way the body is, from the same string-splitting pass, and nothing about
the node kinds changed to allow it. The hole check does not reach this case on its own: a head
holding no expression produces no sentinel, so every count stays correct while the bytes go
missing. Reading the stream is what makes its content reachable at all.

The shape was measured rather than argued:

```
HEAD  <!--167snak--><!--[0--><meta name="a" content="%%s1%%"/><!--]--><!---->
      <!--eo1t1a--><meta name="child" content="c"/><!----><title>%%s0%%</title>
BODY  <!--[--><div>%%s2%%</div><b>child</b><!----><!--]-->
```

- Sentinels reach the head, and a sentinel carries its own index, so **holes need no positional
  correlation** and cross a stream boundary for free.
- Blocks render there with the same anchors as anywhere else.
- **A child's head is already merged into the parent's stream**, carrying its own hash anchor.
  The aggregation other frameworks moved out of the component tree is done here at compile time,
  by Svelte, because the component graph is static. Two `<svelte:head>` blocks in one component
  are a compile error, so there is no ordering left to invent.
- The hash is `hash(filename)` and not a hash of the source, so the sentinel rewrite does not move
  it. It does depend on the filename string, which is the same coupling the scoped style class
  has, and the same requirement: one filename, spelled identically wherever the component is
  compiled.

## The title is a channel, not markup

It reads as an element and behaves as nothing of the sort. Svelte keeps it out of both streams:

```js
// internal/server/renderer.js, #close_render
let head = content.head + renderer.global.get_title();
```

`head()` writes `<!--hash-->`, its content, then an empty comment. Every head block ends that way,
and the title is appended after all of them, so **the last empty comment is where the head ends
and the title begins**. That split is Svelte's own line rather than a position worked out here,
and what follows it is checked to be a whole `<title>` so that a release appending something else
fails rather than being misread.

The client agrees, and more strongly. It compiles a title to `document.title = value` in an
effect, with **no DOM node and no hydration**, so the title's bytes are outside the ABI entirely.
That is why `{#if a}<title>T</title>{/if}` renders as an empty block with the title outside it:
neither side treats it as content.

**Which title wins is Svelte's rule, and it is derivable.** An earlier draft here said it was not,
and refused a title inside a block and more than one title on a page. Read rather than measured,
`set_title(value, path)` in `internal/server/renderer.js` keeps the title whose render path
compares later -- lexicographically, a longer path winning on an equal prefix -- where a path is
the chain of `#out` indexes from the root renderer down to the one the title was set on. Two
facts of the transform decide what that means in practice. `SvelteHead.js` pushes `$.head` into
the template, and `clean_nodes` hoists a `<svelte:head>` ahead of everything else in its fragment,
so a component's head block runs before any child component it calls and gets a smaller index
than any of them. And `TitleElement.js` pushes `$$renderer.title` into the *init* of the block it
sits in, so a title at the top level of a head block runs before one inside an `{#if}` there, and
every title in one head block shares that block's path. Together: **the last head block executed
wins, and inside it the first title executed** -- a child's title beats its parent's whichever
order they are written in, a later sibling beats an earlier one, the last iteration of an each
beats the rest, and within one block a top-level title beats a nested one and an earlier one beats
a later one of its kind. Measured against Svelte for each of those.

So the walk leaves the title where Svelte executed it. In the render, `<title>` becomes a
stand-in element, `<seam-title-top>` or `<seam-title-nested>` by where it sits in its head block,
and every head block holding one opens with `<seam-title-open>`, so the title's bytes stay in the
head stream inside whatever block they were written in and the assembler reads them as a `title`
node with that role. The injector walks the head, counts a head block at each `open`, and keeps a
candidate when its block is later than the winner's, or the same block and top-level where the
winner was nested; what it keeps is appended after the head, wrapped as `<title>`, where Svelte
appends its own. The client compiles a title to `document.title = value` in an effect, with no DOM
node and no hydration, so nothing about the stand-in reaches it.

The `title` field beside `body` and `head` stays for the one case the render still decides: a
title written by a component the walk did not enter goes through Svelte's channel and comes out
after the head, and it is the winner as Svelte decided it over everything in that render.

**A body block a head sits inside stands in the head stream too.** `$.head` runs where the
component does, so a headed component inside an `{#if}` writes its head block on the branch that
holds it and none on the others, and one inside an `{#each}` writes one per item -- and the head
Svelte returns is a flat run of head blocks with nothing around the ones a block produced. So the
head IR carries the same `if` or `each` the body does, with the child's head block as its body,
and the runtime decides and repeats it there as it does below. How the render is made to write
anchors for it without touching the body's bytes is in [refusals.md](refusals.md). A head inside
an `{#await}` or inside a recursive fragment is refused for now; [roadmap.md](roadmap.md) has
both.

## What is not in it

| | Where it goes instead |
| --- | --- |
| CSS | **Undecided.** The rule that was here is wrong; see below. |
| Client behaviour, events, `$state` | Svelte's own client bundle already carries it. |
| The document head | Nothing: it is in the IR, as a second sequence of nodes. See above. |
| Scalar types | Declared where the payload is produced. The IR enumerates paths, which is what a page requires rather than what its values are. See [payload.md](payload.md). |
| The element tree | Nowhere. Nothing needs it. |

**The CSS row used to say that the artifact is separate and its consumer is the bundler rather
than the server. That is not true and it is left here as a question rather than an answer**,
because a wrong rule is worse than a missing one. A component carrying a `<style>` puts a scoped
class **into the bytes the IR holds**:

```
<div class="card %%s0%% svelte-1w6kyzv"><span class="svelte-1w6kyzv">%%s1%%</span></div>
```

Two things follow. The class lands on elements that had no `class` attribute at all, so it
interacts with the rule about when an attribute disappears. And the hash is taken over the
filename, so the compiler and the bundler have to spell one identically -- the same coupling the
head block's hash has. Injected styles are appended to the head stream as well, which is what the
check after the last head block is really watching for.

So CSS is not in the IR today and something about it is, and which of the two that is depends on
deciding who owns it. Recorded in the list below.

Client behaviour is the measured case. A component with `$state` and an `onclick` handler
compiles to **the same SSR bytes** as one without, so it cannot belong in an artifact the server
reads. Adding the handler to the conformance component changed none of the five expected
outputs, which is the proof rather than the claim.

The draft in the article bundled these into one `ComponentIR` struct. They are grouped by having
come from one compilation, not by having one consumer, and there are four consumers between them.
The server should have to understand one artifact, and this is that artifact.

## Open

Recorded rather than decided, because guessing now would be worse than deciding later.

- **Who owns CSS.** Decided in [build.md](build.md), and no longer blocking the row above. The
  scoped class stays in the response bytes and the stylesheet is the client build's, which is not
  the clean split the table used to claim but is a split. Two things had to be settled first and
  both now are: what happens to a component the compiler refuses, in
  [refusals.md](refusals.md), and how a hashed asset reaches the document, which is a string the
  compiler writes into the manifest. The hash is taken over a filename Svelte makes relative to
  `rootDir`, whose default is the working directory, so **both halves of the build pass the project
  root** -- three directories otherwise give three different classes for one file. It is no longer refused: the plugin
  runs the client build that emits the stylesheet, and a check holds the class in the bytes against
  the class in that stylesheet, since neither half can be wrong alone. It used to compile without
  either: the class went into the bytes, the stylesheet reached no artifact, and the page rendered
  unstyled with an exit status of zero.
- **`translate={true}`.** *Settled.* Svelte maps it through a table of value replacements, and
  the injector carries that table: `true` is written `"yes"` and `false` `"no"`, because
  `translate="false"` would mean yes. It used to be refused when the value was not plain text,
  waiting on a second entry to make the table worth carrying; the table is two lines, and a
  refusal was the more expensive of the two. See [refusals.md](refusals.md).
- **`class:` and `style:` directives.** *Settled.* Both are decision positions over outcomes, and
  both are enumerated: `class:` over which names are present, `style:` over which declarations
  are, with the value written inside the outcome. The way an element is found in a render, which
  this entry called the cost, is a marker riding in an attribute of its own, written last, that the
  decision owns. Nothing of `to_class` or `to_style` is reproduced: each outcome's bytes are
  Svelte's own. See [refusals.md](refusals.md).
- **Empty values.** `{data.name}` with an empty string produced `<h1></h1>` in Svelte's SSR, with
  no text node. Whether hydration requires one to exist is not yet known, and it decides whether a
  `slot` must always emit something.
- **Per-item derivation.** *Settled* in [derivation.md](derivation.md): a derivation reading a
  name an each block binds is called per item, at the point of use, rather than once per request.
- **Snippets and children.** *Settled.* The walk descends into a child and carries the markup it
  was given, so a component with a body is entered rather than refused, and a `{@render}` of a
  snippet declared beside it is inlined. What stays refused is in [refusals.md](refusals.md): a
  render of a snippet that arrived as a prop, and a passed snippet that reads a parameter as a
  value where the component writes it.
- **A title inside a block, and more than one title.** Both need a rule for which title wins,
  which is stated here rather than taken from Svelte, whose own rule is not derivable. Overriding
  across a route and its layout is the same question one level up, and depends on routing.
- **A linear form.** A flat opcode buffer walks faster and deserializes cheaper than a nested
  tree. The tree comes first because it can be written by hand, which the first milestone needs.
  Any linear form must be a lowering of it, not a replacement.
