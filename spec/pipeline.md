# How a component becomes an IR

Two questions have to be answered about a component, and they are answered by different things.

**What is the structure?** Which parts are static, where the holes are, where the branches are.
Svelte's markup AST answers this exactly, which is the whole reason the rewrite exists.

**What are the bytes?** The literal HTML, including the anchors Svelte's client hydration walks.
Svelte's own server codegen answers this exactly, because it is the thing whose output the client
was written against.

The compiler asks each question of whatever already knows the answer. It reimplements neither.

## Why not write the bytes ourselves

It was tried, and it works, and it is still the wrong trade. Reproducing Svelte's output by hand
meant reproducing the part of its code generator that decides where anchors go, and that part is
undocumented, positional, and layered. Four rules came out of measurement before the first real
component:

- A component writes a trailing `<!---->` unless it is last in an if branch, an each body, or a
  root fragment holding nothing else.
- The root and an each body write a leading `<!---->` when they open with character data.
- An element body and an if branch do not.
- Whitespace is trimmed off the end of a fragment during code generation, which is not an anchor
  rule at all but a second transform living in the same place.

None was derivable from the protocol; each came from rendering a shape and reading the output.
The list was still growing when it was abandoned. **A rule set discovered by measurement is a
rule set that changes when the thing being measured does**, and Svelte changes its output between
minor releases without owing anybody notice.

Borrowing the code generator removes the class of problem rather than the current instance.

## Sentinels, and why they are not v1

v1 also rendered at build time, so the difference has to be stated precisely.

**v1 rendered in order to discover structure.** It filled data with sentinels, rendered the
component across a cartesian product of type values, and diffed the outputs to work out where the
conditional blocks were. That is why it was unsound: the value space of `price > 10` is not
enumerable, so the branch was never found, and the user was asked to supply mocks instead.

**v2 renders in order to serialise a structure it already knows.** The AST says this is an
`IfBlock` with two fragments. Nothing is discovered, nothing is diffed, and the number of renders
is set by the number of blocks rather than by the size of any value space.

The sentinel returns as a *marker of a known hole*, not as a probe. It must survive both escaping
modes untouched, so it may contain none of `&`, `<`, `>` or `"`.

## Deriving is what makes branch forcing possible

To get the bytes of a branch, the compiler has to make Svelte take it. It cannot do that by
constructing a value that satisfies `price > 10`, because solving the predicate is exactly the
thing being avoided.

So before handing the component to Svelte's code generator, the compiler **rewrites every
expression that is not a data path into a derived field**:

```
written by the author     {#if price > 10}
compiled against          {#if __d0}
carried alongside         __d0 = (price > 10)
```

Now the branch is forced by setting `__d0`, and the predicate is never evaluated at build time at
all. At request time it is evaluated once, over data, before injection.

**This is why the derivation and the borrowed code generator are one decision rather than two.**
Without the rewrite there is no way to force a branch; without the forcing there is no way to
collect the bytes.

## What runs at request time, and what does not

A derivation is a pure function of the payload. It computes values. It renders nothing, touches
no component, and produces no HTML.

- **A TypeScript server already has a JavaScript runtime**, and uses it.
- **A Rust or Go server embeds a small one**, in the QuickJS sense: a JavaScript subset for
  evaluating expressions, not Node and not Bun, with no filesystem, no network and no module
  system.

The line is between running data and running UI. Everything the old objection to a JavaScript
backend was about -- a component tree executed per request, a renderer, a virtual DOM, a
framework runtime -- stays gone. What arrives is an expression evaluator, and the alternative to
it is asking the author to hand-write every derived value, which is the author doing the
compiler's work.

An enumerated operator set was considered instead, with the injector comparing a path against a
constant and no JavaScript anywhere. It is rejected: the operators are a language, the language
acquires edge cases, and defending its boundary costs more than admitting that the expression was
JavaScript to begin with.

## A build-time JavaScript runtime is not a dependency worth avoiding

The compiler needs Node, to run `svelte/compiler` and its server code generator. This is not a
cost worth engineering around. **Whoever is writing Svelte components has a JavaScript runtime on
their machine already**, and a build step that assumes one assumes nothing.

The deployed server is where the constraint actually mattered, and that is where it still holds:
no UI code, no framework, and no JavaScript at all unless a derivation needs it.

## Where the code is against this

Both passes exist, and the render is the one that produces the IR. Every case in the corpus is
compiled by rendering, including blocks, composition and derivation, and every payload still
matches Svelte's own output byte for byte.

The written-bytes pass stays for now, not as a fallback but as an oracle: a test holds the two
against each other on every case, and they agree field for field. It has a limited life. The
first Svelte release that moves an anchor will break it and leave the render pass working, and
that failure is the signal to delete it rather than a defect to fix.

What the render pass does not take yet: a block inside an else, which is numbered but never
appears in the baseline render where every if is taken, so the render and the block list would
stop lining up. It is refused rather than mis-assembled.

## What this does not change

**The IR does not change, and neither does the injector.** How the static chunks are produced
moves; what they are does not. The runtime still walks a tree, resolves paths, escapes values and
concatenates.

That makes the change checkable rather than hopeful. The conformance corpus compares
`inject(ir, data)` against Svelte's own server output for every case and payload, so it pins the
expected bytes without caring how the IR was built. **The corpus written for the old strategy is
the acceptance test for the new one.**
