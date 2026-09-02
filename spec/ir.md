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

Five, and the tree bottoms out in strings.

```json
{ "component": "product", "nodes": [
  { "t": "static", "s": "<!--[--><article class=\"card\"><h1>" },
  { "t": "slot",   "path": "p.name", "escape": "content" },
  { "t": "static", "s": "</h1>" },

  { "t": "if", "branches": [
      { "test": "p.available", "body": [ {"t":"static","s":"<!--[0--><button>Buy</button>"} ] },
      { "test": null,          "body": [ {"t":"static","s":"<!--[-1-->"} ] }
  ]},

  { "t": "static", "s": "<!--]--><!--[-->" },

  { "t": "each", "source": "p.tags", "item": "t", "body": [
      { "t": "static", "s": "<span>" },
      { "t": "slot",   "path": "t", "escape": "content" },
      { "t": "static", "s": "</span>" }
  ]},

  { "t": "static", "s": "<!--]--></article><!--]-->" }
]}
```

- **`static`** -- an opaque string. Markup and Svelte's anchors sit in it indistinguishably; the
  runtime neither parses nor inspects it.
- **`slot`** -- a data path and an escape mode. Nothing else.
- **`if`** -- branches, each with a test and a body. The last branch may have `"test": null`,
  which is the else.
- **`each`** -- a source path, the name bound to each item, and a body.
- **`attr`** -- one attribute of the element being opened, written between the static chunk
  that opens the tag and the one that closes it. It carries `parts`, which are `static` and
  `slot` nodes, and it is the only node that can decide to write nothing at all.
- Bodies are node arrays, so the shape recurses.

`{@html}` needs no node of its own. It is a `slot` with `escape: false` between two static
`<!---->` chunks, which is the anchor pair Svelte writes around raw HTML.

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

A child is spliced into its parent at compile time, with its paths rewritten. `<Badge label={p.name} />`
lowers the child's `{label}` into a slot on `p.name`; `<Badge tone="warm" />` lowers the child's
`{tone}` into **static text**, because a prop passed literally has nothing left to resolve. The
runtime has no notion of a component, and the injector did not change to gain one.

That works only because every prop value is already a path or a literal, which is the same
constraint the protocol places on everything else. A prop that mixes text and an expression is
refused: it has no value to pass until something computes one.

The unit is still the component. A bundle carries the entry and everything reachable from it,
and lowering walks that graph -- so a cycle is an error rather than a hang, and a component the
bundle does not carry is named rather than skipped.

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

`p.available` is legal. `price > 10` never reaches the IR: the compiler rewrites it into a
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

`each` binds `item` for the extent of its body. Path resolution walks a scope stack: entering an
`each` pushes the binding, leaving it pops.

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

`render()` returns a head as well as a body, and the IR carries one sequence of nodes. Reading
only the body is how a `<title>` came to compile without complaint and then not exist -- present
after hydration, absent from the response, which is the failure this whole approach exists to
avoid.

So the head is read and **writing to it is refused** until the IR carries it. The hole check
cannot stand in for that: a head holding no expression produces no sentinel, so every count stays
correct while the bytes go missing.

What the shape will be is settled, because it was measured rather than argued:

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

Only one rule of Svelte's has to be lived with rather than copied: **`<title>` is moved to the end
of the stream** regardless of where it was written, leaving a `<!---->` where it stood. That does
not disturb holes, which are indexed, but it does disturb blocks, which are matched by document
order.

That is what the staging below is about. Reaching a head that holds no block needs the IR to carry
a second node sequence and nothing else. Reaching a head that holds one needs blocks to know which
stream they belong to, which is a field the render pass can supply because it has the AST. Merging
across routes -- one page's title overriding a layout's -- is the only part that would require the
IR to understand the bytes it concatenates, and it waits on routing, which does not exist.

## What is not in it

| | Where it goes instead |
| --- | --- |
| CSS | A separate artifact. Its consumer is the bundler, not the server. |
| Client behaviour, events, `$state` | Svelte's own client bundle already carries it. |
| The document head | A second stream, read and refused today. See above. |
| Types, the payload contract | The schema. The IR references paths and does not describe them. |
| The element tree | Nowhere. Nothing needs it. |

Client behaviour is the measured case. A component with `$state` and an `onclick` handler
compiles to **the same SSR bytes** as one without, so it cannot belong in an artifact the server
reads. Adding the handler to the conformance component changed none of the five expected
outputs, which is the proof rather than the claim.

The draft in the article bundled these into one `ComponentIR` struct. They are grouped by having
come from one compilation, not by having one consumer, and there are four consumers between them.
The server should have to understand one artifact, and this is that artifact.

## Open

Recorded rather than decided, because guessing now would be worse than deciding later.

- **`class:` and `style:` directives.** Both merge with a static attribute of the same name
  rather than standing beside it: `class="c"` with `class:on={true}` is one `class="c on"`, and
  `style:color` joins an existing `style` with `; `. That makes the attribute a computed join of
  conditional parts, which the `attr` node does not express.
- **Empty values.** `{p.name}` with an empty string produced `<h1></h1>` in Svelte's SSR, with no
  text node. Whether hydration requires one to exist is not yet known, and it decides whether a
  `slot` must always emit something.
- **Per-item derivation.** A derivation is a function of the payload, computed once, so an
  expression inside an each block is refused. What such an expression needs is a value per
  iteration, which is a different mechanism rather than a larger version of this one. See
  [derivation.md](derivation.md).
- **Snippets and children.** A component given a body is refused; `{@render}` is untouched.
- **The head, in three steps.** A head with no block needs the IR to carry a second node sequence,
  and depends on nothing else. A head with a block needs each block to record its stream, and
  depends on the first. Title override across a route and its layout needs the IR to read the
  bytes it concatenates, and depends on routing.
- **A linear form.** A flat opcode buffer walks faster and deserializes cheaper than a nested
  tree. The tree comes first because it can be written by hand, which the first milestone needs.
  Any linear form must be a lowering of it, not a replacement.
