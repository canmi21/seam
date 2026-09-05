# How a component becomes an IR

Two questions have to be answered about a component, and they are answered by different things.

**What is the structure?** Which parts are static, where the holes are, where the branches are.
Svelte's markup AST answers this exactly, which is the whole reason the rewrite exists.

**What are the bytes?** The literal HTML, including the anchors Svelte's client hydration walks.
Svelte's own server codegen answers this exactly, because it is the thing whose output the client
was written against.

The compiler asks each question of whatever already knows the answer. It reimplements neither.

What invokes this for a whole project, and what it writes out, is [build.md](build.md).

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

## Where a sentinel can stand, and where it cannot

A sentinel marks a hole. That works wherever the value it replaces **appears in the output**, and
it cannot work anywhere the value instead **decides what output there is**. The two are worth
naming, because which one a construct is decides whether it can be compiled by reading a render at
all.

| | the value | a sentinel |
| --- | --- | --- |
| **A substitution position** | is written into the bytes | stands there, and the render says everything |
| **A decision position** | chooses which bytes exist | has nowhere to stand |

`{data.name}` and `title={data.x}` are substitutions. `disabled={data.d}` is a decision: its
output is `disabled=""` or nothing, and there is no place in either for a marker to sit. Put one
there and it is swallowed, which the hole check reports rather than letting through. See
[ir.md](ir.md), where the rule that had to be reproduced because of this is written out.

**Decision positions already have a mechanism, and it is the one the blocks use.** An `if` is a
decision over two outcomes, and the compiler handles it by rendering each outcome and keeping
both. Nothing about that is specific to blocks. So a decision position is compilable exactly when
**its outcomes can be enumerated at compile time**:

| | outcomes | |
| --- | --- | --- |
| a boolean attribute, `class:`, `style:` | two | enumerable |
| `<select value={x}>` marking one `<option>` | one per option, all in the source | enumerable |
| `{...spread}` | whatever keys the data has | **not** enumerable |
| `<svelte:element this={x}>` | any tag name | **not** enumerable |

An unenumerable decision cannot be compiled into structure, and needs the runtime to make it. That
is a real cost, since every backend then carries it, and a small one: writing attributes from an
object, or a tag name from a string, is concatenation and a list of void elements. It is an HTML
fact rather than a Svelte one, which is the same ground on which the boolean rule was let in.

**A marker is outside every function's domain, and that is a risk the render carries.** A
component the walk does not enter is rendered with a marker where a request value would be, and
whatever it computes from that value it computes from a string no request sends. Where the result
is written it does not matter: the bytes are a hole and the runtime writes the real one. Where the
result decides structure inside that component it does: press's language name went through
`sourceLanguageName(marker, code)`, the marker was not a language tag, and the render took the
function's fallback branch, one no request reaches. Nothing in the bytes says so, which is what
makes it a risk rather than a refusal. What bounds it is that a component left to Svelte is given
the request's values only as markers, so a structure that depends on one is either declared as a
domain by the build and rendered per value, or is wrong for the values the domain would have held.
The byte oracle over real payloads is what finds the second, and it is why the oracle exists.

## Enumerate the structures, not the values

The table above is written in terms of outcomes, and that word has to be pinned down, because the
obvious reading of it is the one v1 died of. **The question is never how many values a field can
hold. It is how many structures depend on it.**

A field's type is not the count. `username` is a string with no bound, and what it costs depends
on what reads it, not on how many values it has:

| what the page does with it | structures | what compiles |
| --- | --- | --- |
| `<p>{username}</p>` | one | a slot, filled at request time |
| `{#if username}<p>{username}</p>{/if}` | two | both rendered, both kept |
| `<Message options={{ locale }} />`, nine locales | nine | nine rendered, all kept |

In the first row every payload writes the same shape, so the domain is irrelevant and there is
nothing to enumerate: the value is written into the bytes and a slot is the whole answer. **The one
question left about it is whether it is there at all**, because that decides whether the attribute
or the element around it is written -- a decision with two outcomes, whatever the field holds when
it is there. Nothing about the content changes the shape.

In the second row the same unbounded string induces exactly two structures, because two is how many
the author's markup asked for. The value space of `username` is no more enumerable than it was; it
never had to be.

The third row is the only one that needs anything new, and only because the branching happens
somewhere the compiler cannot read.

**This is precisely the line between v1 and v2, stated from the other side.** v1 enumerated values
-- a cartesian product over each field's type -- and diffed the renders to find the branches, which
is why `price > 10` defeated it. v2 enumerates structures, which the AST names one at a time. The
count is set by the markup, never by the data.

## Where the structures come from

Three sources, and the compiler treats them the same way once it has them.

**The author's own markup.** An `{#if}`, the branches of an `{:else if}` chain, a `class:`
directive's two states. The AST says how many, and the compiler renders each and keeps them all.
This is what blocks already do; nothing here is new. A `?:` in a value handed to a component the
compiler cannot read is the same source one step into the script, and is enumerated when a marker
could not stand for what it chooses between; see [refusals.md](refusals.md).

**A declared domain.** A value the author's markup does not branch on, but something downstream
does -- a locale read by a package, a role that selects a layout. The compiler cannot see inside
the package and cannot know that a locale has nine values, so **the build declares the domain**,
and the compiler renders once per value and keeps them all. Read out of paraglide's generated
output: for a fixed locale a message's `parts` is a literal array -- the same length, the same
markup names, in the same order -- and the only thing an input changes is a text value inside one
of them. Nine locales are nine structures, and each of them is static bytes with holes, which is
the shape this compiler is built for.

**Nothing.** A domain nobody can enumerate: the keys a `{...spread}` carries, the tag a
`<svelte:element>` names, and the id `$props.id()` hands out, which is one per component instance
and so one per item of an each. The runtime makes that decision, and this is the residue the
section above is about. **It is the only thing that reaches the runtime.** Everything enumerable is
compiled.

## What an enumerated field costs, and what it does not

A field with `n` structures does not mean `n` files. The IR already carries branches, so the whole
of it can sit in one artifact under an `n`-way `If` whose test reads that field -- which is what a
`class:` directive already does with its `2^n` outcomes, in one hole. Emitting `n` artifacts and
having the server choose between them is the same compilation with the branch resolved at a
different moment.

**So how many artifacts is a deployment choice, not an architecture one**, and it can be decided
per project without changing anything above it. What is settled here is that the structures are
produced at compile time either way.

**Every branch carries its own test, and none of them is the else.** The tempting shape is to let
the last combination be the else, which makes the artifact total -- and total by handing a value
outside the declared domain somebody else's structure. Measured: with `en`, `fr` and `de` declared,
a payload saying `ja` rendered the German page and nothing anywhere said so. A page that renders
nothing is a bug report; a page in the wrong language for one reader is not. The domain is a
promise the build makes, and where the data breaks it the artifact has no structure to offer and
says so by having none.

The saving is not only the request-time work. A value carried to the runtime drags its dependencies
into the derivation bundle with it: a locale evaluated per request means every message module it
reaches is bundled, which for one real project is a 628KB directory with an 80KB runtime in it.
Enumerated at compile time, the text is bytes and none of it is carried at all.

## A hundred structures is a warning

**Not a refusal.** A page really can have that many, and a compiler that stops is a compiler
guessing about the author's intent.

But nobody reaches a hundred structures from one field by writing an ordinary page, so reaching it
is more likely a domain declared wrongly -- an enumerable dimension pointed at a field that is not
one -- than a page with a hundred shapes. The choices the walk finds on its own count towards the
same number, since each doubles the route it sits in. The number exists to be said out loud at the moment the
cost is incurred, to whoever is watching the build. It says which field and how many, and compiles
anyway.

## Static in the corpus does not cover dynamic

The boolean attribute rule was missing for as long as it was because the case covering attributes
writes `disabled` as a static attribute, and every payload agreed with Svelte. It had to: nothing
in that case ever reached the code that decides presence.

**Svelte compiles a statically known value down a different path from an expression**, folding it
into the template rather than calling the helper the expression would have gone through. So a
static example is not a smaller version of a dynamic one, it is a different program, and a corpus
made of static examples measures a compiler nobody will run.

Every construct in the corpus should appear at least once with a value that is not statically
known. That is the check that would have caught this, and it is cheaper than the next thing it
catches.

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

What such an expression may reference, and why that is a boundary rather than a feature list, is
[derivation.md](derivation.md).

## What runs at request time, and what does not

A derivation is a pure function of the payload. It computes values. It renders nothing, touches
no component, and produces no HTML.

- **A TypeScript server already has a JavaScript runtime**, and uses it.
- **A Rust or Go server embeds one**, in the QuickJS sense: not Node and not Bun, no filesystem,
  no network, no host of any kind.

An earlier draft called that embedded engine "a JavaScript subset", which confused two things.
QuickJS implements almost all of ES2025 and passes nearly the whole test suite; what it lacks is
a host -- no DOM, no `fetch`, no `require`. **The subset is what this protocol allows an author to
write, not what the engine can run.** It is also missing ECMA402, so a derivation reaching for
`Intl` would not run there at all, which agrees with a rule already arrived at from the other
direction.

The line is between running data and running UI. Everything the old objection to a JavaScript
backend was about -- a component tree executed per request, a renderer, a virtual DOM, a
framework runtime -- stays gone. The alternative to running anything is asking the author to
hand-write every derived value, which is the author doing the compiler's work.

What arrives is the derivation bundle: the author's expressions, and the pure functions those
expressions call, compiled to one script with no imports left in it. Bundling is what keeps the
promise about a module system -- there is nothing to resolve, because nothing is imported at
request time. Measured on the most ordinary case there is, a class helper over `clsx` and
`tailwind-merge`: **27KB minified, zero references to any host API**, using nothing beyond
classes, arrow functions and `Map`, and evaluated once when the process starts rather than once
per request. See [derivation.md](derivation.md).

One syntactic constraint comes out of that and is the same on both engines. `with` is a syntax
error in a module, modules being always strict, so the carried code is bundled as ordinary
functions and the expressions themselves are built with `new Function` at startup, which is
sloppy mode and where `with` is legal.

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

A block inside an else used to be refused here, because it is numbered but never appears in the
baseline render where every if is taken. It is taken now: each block records the branches it sits
within, and the render made for one of its own branches forces those ancestors back onto the
branch that makes it exist. See `within` in `pkgs/skeleton/src/walk.ts`.

## The client is held to the same oracle as the bytes

The corpus compares `inject(ir, scope)` with Svelte's own server output, so the fragment is settled
there: where two strings are identical, a client cannot tell them apart. What it does not cover is
the document those bytes are placed in -- the shell around them, the payload written beside them,
and whether the value read back off the wire is the value the bytes were rendered from.

**Hydration does not leave a correct document alone**, which is the first thing measured here and
the reason the obvious check is the wrong one. Two of Svelte's own client behaviours change the
DOM without anything being wrong, and both are in its source rather than inferred:

| | |
| --- | --- |
| `head_anchor.remove()` in `head()` | the anchor that opens a head block is consumed on purpose |
| `dom.style.cssText = ''` in `set_style` | an empty style materialises an attribute the server omitted |

Writing a list of allowances for those would be this project reproducing Svelte's behaviour by
hand, which is what it stopped doing when it stopped writing the bytes. So the same document is
built twice -- once from the IR, once from Svelte's own render -- and both are hydrated by the
same client. What Svelte does to its own output, it does to ours, and the comparison cancels it.

**But the comparison after hydration is not enough on its own, and this was measured rather than
reasoned about.** With a word changed in the served bytes, the client repairs the text silently, in
the direction of the payload, so both documents converge and a check that only compared what they
became passed. The two documents are therefore compared *before* the client runs as well as after.
The first assertion is the one with teeth; the second is what tolerates the mutations above.

## What this does not change

**The IR does not change, and neither does the injector.** How the static chunks are produced
moves; what they are does not. The runtime still walks a tree, resolves paths, escapes values and
concatenates.

That makes the change checkable rather than hopeful. The conformance corpus compares
`inject(ir, data)` against Svelte's own server output for every case and payload, so it pins the
expected bytes without caring how the IR was built. **The corpus written for the old strategy is
the acceptance test for the new one.**
