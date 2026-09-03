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
| `{@const}` | a substitution one scope further in |
| `class:`, `style:`, `<select value>`, `translate={true}` | decidable by enumeration; deferred on what they are worth |
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

**`{@render children()}` is not a snippet problem.** It renders a snippet that came in as a prop,
which is the markup a *parent* wrote inside the child's tag -- so it is composition running the
other way from the one this compiler does, which inlines a child into its parent. It is 600 of the
4323 and the largest thing after `{...spread}`, and it is recorded here as its own question rather
than as a missing piece of this one.

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
