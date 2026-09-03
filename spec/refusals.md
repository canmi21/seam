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
| `{#await}`, `{#key}`, an each with an index, a key or an `{:else}` | measured, trivial, unwritten |
| snippets, children, `{@render}`, `{@const}` | inlining, or a substitution one scope further in |
| `class:`, `style:`, `<select value>`, `translate={true}` | decidable by enumeration; deferred on what they are worth |
| `{...spread}`, `<svelte:element>` | an unenumerable decision, so a small closed runtime node |
| a local `$state` read from markup | refused by the pass that resolves names, and told it is missing from the data; Svelte's own server renders the initial value, so this is a gap rather than a rule |
| per-item derivation, which of two titles wins | not decided |

**So "a subset of Svelte" is a statement about how far the work has got, not about where a line
was drawn.** The subset grows, and the README should say that rather than implying a boundary
nobody has found.

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
