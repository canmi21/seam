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

## What reproducing Svelte's output actually costs

The anchors around blocks are structural and were cheap. The rest is not, and the difference is
worth recording, because it is a cost that recurs with every Svelte release.

- A component writes a trailing `<!---->` **unless** it is the last node of an if branch, an
  each body, or a root fragment that contains nothing else.
- The root fragment and an each body write a leading `<!---->` when they open with text, an
  expression or raw HTML. An element body and an if branch do not.
- Svelte trims trailing whitespace off a fragment during code generation, so the AST's text and
  the emitted text differ.

None of these are derivable from the protocol. Each was found by rendering a shape and reading
what came out, and the last one is not an anchor rule at all but a second transform living in
the same place. **The conformance corpus is what makes this survivable**: every rule above has a
case, and a Svelte release that changes one lands on that case rather than on a user.

## The coupling this creates, and what pays for it

Baking Svelte's anchors couples the compiler to Svelte's internal output format, which may change
in a minor release. **The coupling is build-time, not runtime**: the IR is regenerated on every
build, and a Svelte upgrade means a recompile, which happens anyway.

The risk that remains is silent divergence -- our anchors stop matching what the new client
expects, and nothing says so. v1 guarded the equivalent risk with `ctr_check`, which re-injected
mock data and diffed against a real `renderToString`. **That guard has to survive in a new form:
compile a component with `svelte/compiler`'s server codegen, render it, and diff against what our
IR and injector produce for the same data.** It is not a test suite and does not wait for one. It
is the only thing standing between a Svelte patch release and broken hydration.

## Expressions are not evaluated

**`test` and `path` are data paths. They are never expressions.**

`p.available` is legal. `price > 10` is not, and must be derived into a boolean field on the
payload before the IR sees it. Elements, enums and nullables are finite decisions and belong in
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

## What is not in it

| | Where it goes instead |
| --- | --- |
| CSS | A separate artifact. Its consumer is the bundler, not the server. |
| Client behaviour, events, `$state` | Svelte's own client bundle already carries it. |
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
- **Whitespace.** Only the trailing-trim above is reproduced by omission, in that no case
  exercises it. Svelte's full normalisation is not implemented and a component that relies on it
  will differ.
- **Snippets and children.** A component given a body is refused; `{@render}` is untouched.
- **A linear form.** A flat opcode buffer walks faster and deserializes cheaper than a nested
  tree. The tree comes first because it can be written by hand, which the first milestone needs.
  Any linear form must be a lowering of it, not a replacement.
