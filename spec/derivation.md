# Derivation

A derivation is what a component's expression becomes once the runtime is not allowed to evaluate
it. `{#if price > 10}` compiles against `{#if __d0}`, and `__d0 = (price > 10)` is carried
alongside. See [pipeline.md](pipeline.md) for why that rewrite is what makes branch forcing
possible at all.

This file answers the question that rewrite leaves open: **what is a derivation allowed to be a
function of?**

## Three stages, and the protocol governs two

```
load     ->  payload      the backend's own capability
derive   ->  payload'     a function of the payload
inject   ->  bytes        concatenation
```

**Where the data came from is not the protocol's business.** A backend may read a database, call a
network service, or open a file, in whatever language and by whatever means. That is the load
stage, and nothing here constrains it.

This is the distinction that dissolves the question of whether a derivation may use `fetch`. It
may not, and not because the network is dangerous: because fetching is a capability of the stage
before this one. A derivation does not acquire values. It decides things about values that have
already been determined.

So the rule is not a list of permitted APIs. It is a property:

> **A derivation is a pure, deterministic function of the payload.**

Everything below follows from that sentence, and the sections are the two ways to violate it:
ambient input and side effect. A third was counted once and struck; see the end.

## Every identifier resolves, or it is refused

The compiler previously decided by shape alone: an expression matching a dotted identifier was a
data path, and anything else became a derivation carried verbatim. Nothing ever asked where the
names in it came from. Three failure modes were measured, and all three are the same missing pass:

| written | what happened |
| --- | --- |
| `{#if p.price > LIMIT}`, `LIMIT` a script const | compiled; `ReferenceError` at request time |
| `<script>const total = p.price * 2</script>{total}` | the baseline render threw Svelte's own `TypeError` |
| `{total}` on its own | matched the path shape, resolved against the payload, rendered empty |

The last is the worst of the three, because it is silent. A local variable and a payload key are
indistinguishable by shape, so a shape test cannot tell them apart, and the wrong answer is an
empty string rather than an error.

**Every identifier appearing in markup resolves to exactly one of these, or the component is
refused and the name is reported:**

| binding | comes from |
| --- | --- |
| a prop | the `$props()` destructuring, resolved against the data. See [payload.md](payload.md) |
| an each binding | `{#each xs as t}` |
| a carried constant | see below |
| request context | see below |
| anything else | refused, by name, at compile time |

This is one pass over the expression's ESTree, collecting `Identifier` nodes and subtracting the
locally bound ones. The AST is already in hand: the compiler reads the expression's source span
off a node it has already parsed, so nothing new is parsed and no dependency is added. It is
`pkgs/ast/src/bindings.ts`, and `bundle` refuses before it reads anything out of the markup.

**An expression the client owns is not this pass's business.** An event handler, a `use:`, a
`transition:` or an `animate:` reads whatever the component's own scope holds and writes no bytes,
so `onclick={() => n += 1}` is left alone where `{n}` would be refused. That is the same line the
compiler already draws elsewhere and it was measured rather than assumed.

An imported name is not reported here. It resolves, and what it resolves to is bundled: see the
next section, and `pkgs/carry`.

## Carrying is declared, never inferred

A constant the author wrote is not illegal to reference. It is a determined value like any other,
and refusing it would be arbitrary. The question is only how it gets into scope.

**The compiler does not analyse purity.** Purity analysis fails on the interesting cases, and the
frameworks that have taken this problem seriously all avoid it: Qwik decides what its optimizer
may capture by requiring `const` and by requiring module-level symbols to be imported or exported,
and Bun's macros decide what may be evaluated at build time by requiring the input to be
statically known and the result to be serializable. Neither proves anything about the code. Both
require a shape the author declares.

| where it is written | what happens |
| --- | --- |
| either `<script>`, not reading props | substituted into the expression, where it is a constant |
| either `<script>`, reading props | substituted into the expression, where it is **a derivation** |
| a function or a class | substituted as the expression form of itself |
| a name taken out of a destructuring | substituted as the initialiser with the way in after it |
| imported, with its source reachable | bundled with the expression that calls it |

**A declaration is substituted, not evaluated**, and the two rows are one mechanism rather than
two. `TAX` becomes `(0.2)` and `total` becomes `(data.price * (1 + (0.2)))`; the first is a
constant because a module script has no props to read, and the second is a derivation for exactly
the reason any other expression over the data is one. Nothing runs at build time, nothing has to
be serialisable, and neither block needs a rule the other does not.

`const total = p.price * 2` **is a derivation the author wrote outside the markup**: its free
variables are props, and its shape is the same as the expression inside `{#if p.price > 10}`.
Substituting it costs no new mechanism, and it turns the loudest failure the compiler had into
the most ordinary feature.

A chain, `const a = p.x * 2; const b = a + 1`, is substituted through into `((p.x * 2) + 1)`
rather than emitted as two derivations. That keeps derivations independent of one another, which
the section below relies on, at the cost of computing a shared subexpression once per use. Cost is
not what this file governs.

An earlier draft had the module block evaluated at build time and inlined as a serialisable
literal, and required an `export` to make the author's intent explicit. Substitution needs
neither: there is no boundary being crossed, the declaration sitting in the same file as the
markup that reads it, and asking for a keyword to permit that would be ceremony over nothing.

A function or a class is substituted as the expression form of itself, so `fmt(x)` becomes
`(function fmt(v) {...})(x)`. One that calls itself still reaches itself, a named function
expression carrying its own name, which is worth saying because a function is the one shape here
that can. Declaring either evaluates nothing, so neither is neutralised for the render.

A destructuring is the same substitution with the way in written after it: `a` out of
`const { a, b: c } = data.t` expands to `((data.t).a)` and `c` to `((data.t).b)`, and `x` out of
`const [x] = data.t` to `((data.t)[0])`. A default and a rest are neither a member nor an index
and are left out, which reports the name rather than guessing at it.

A render is given no data, so a declaration reading a prop is handed something harmless in the
source the compiler renders -- `null`, or `{}` and `[]` where it was destructured, since a
destructuring needs something it can be taken apart from. One place in the source is written over
once however many names it declares.

A first attempt wrote over it once per name, which took the file apart and was reported by
Svelte's compiler as an undefined variable naming nothing anybody could act on. **Rewriting a
source file is a list of replacements, and two of them over the same characters is not a case to
resolve but a mistake upstream**, so applying them refuses instead of writing the second into the
middle of the first. Both passes that rewrite a component go through the same applier, and both
get the check. It has already been substituted into every expression that used it, which
leaves it dead there. That is what a component doing this used to crash on, inside Svelte's own
renderer, with a `TypeError` naming nothing an author could act on.

**An imported function is carried, on one condition: its source has to be reachable at compile
time**, so that it can be bundled with the expression that calls it. It usually is, being a module
the author already depends on.

**What is carried is gathered from every file whose expressions became derivations, not from the
entry alone.** Composition walks into a child, and the child's own markup becomes derivations in
the *entry's* artifact -- so a child writing `{shout(word)}` around a function it imported itself
compiled cleanly and threw `ReferenceError: shout is not defined` at request time. Nothing at
compile time could say so, because a render never evaluates a derivation: the expression is
collected as source and first runs when a request arrives. A component the walk did not enter is
rendered by Svelte and contributes no derivation, so it is not gathered from.

**And it is gathered from what the expressions read, not from what the markup names.** The
markup's own identifiers were the list once, and press's home route showed it wrong in both
directions. `const src = imgsrc(...)` read as `{src}` is a derivation calling `imgsrc`, which the
markup never names, so the bundle held nothing and the first derivation stopped at a name that was
not defined. And `<Provider client={queryClient}>` names a package the render evaluates and no
derivation ever calls; bundling it pulled a component library into esbuild, which has no loader
for `.svelte`. So the skeleton hands over every expression it planted -- each hole's, each
decision's tests, each block's source and tests -- and an import is carried when one of them
reads it. That is the same set the evaluator will look up, by construction.

Two consequences worth stating. A specifier is resolved against the file that wrote it, since two
components in different directories spell `./helper.ts` differently and the bundle is written from
one place. And **one name means one module**: derivations are evaluated in a single scope, so two
components carrying the same local name for different modules is refused rather than settled by
whichever was read last. press does this with paraglide's messages, `import * as m` in one file and
`import { m }` in another, which are the same functions through two bindings; the sample copy is
normalised to one form, and press itself is told.

**Every derivation is JavaScript by the time it is evaluated.** A component written with `<script
lang="ts">` writes its expressions with annotations and `as` in them, and the walk copies them as
written, because a derivation is the author's source recorded rather than rewritten. Svelte strips
the types on its own way to the render; nothing did on the way to the IR, and `new Function`
stopped at the first colon. They are stripped at the one point every derivation passes through
between the skeleton and the IR, in the lowering wrapper, with the same stripper Node loads a
`.ts` file with -- types become whitespace and nothing else moves -- and the test a route's
structures are chosen by goes through the same function, being source text a `?:` was written
with.

A draft refused a call through a value -- `handlers[k](x)` -- for having no name to follow.
Bundling makes that unnecessary: `handlers` is the name, it is imported, the whole of it is
bundled, and which entry the call reaches is decided at request time inside the bundle like any
other lookup. What is refused is what was always refused, a name that resolves to nothing.

**It is bundled, not analysed**, and a draft that said otherwise was wrong on measurement. The two
functions the whole question is about do not survive an analysis: `clsx` is shipped minified and
its core recurses into itself, and `tailwind-merge` keeps a module-level LRU cache, which is a
mutation that is nonetheless deterministic. A transitive purity check rejects both, and they are
the ecosystem the carrying was for. Nor is a module the right granularity: the file exporting the
clean `cn` measured above also exports `typeof document !== 'undefined'` and holds a module-level
`Date.now()`, neither of which the function anybody wants touches.

There is a reason not to analyse beyond its being impractical. **The client runs the same function
during hydration**, out of the same module, so a library reading a clock produces the ordinary SSR
mismatch that SvelteKit, Next and Remix all have and none prevent. Analysing library code would
make this stricter than Svelte itself, at the cost of the library. What is genuinely ours to
govern is what the author writes in the markup, and that is exactly what the pass above reads.

## Ambient input is data, not capability

`fetch` is the obvious violation and the least dangerous, because nobody writes it by accident.
The dangerous ones arrive through APIs that look pure. Measured, on one payload, with no clock and
no randomness anywhere in the expression:

```
                                    TZ=UTC          TZ=Asia/Tokyo
new Date(p.d).getHours()            22              7
new Date(p.d).toLocaleDateString()  "11/14/2023"    "11/15/2023"
```

The value came entirely from the payload. The reading of it did not. Time zone and locale are
ambient inputs that no list of forbidden function names would catch, and they are reported
elsewhere as the most common silent hydration mismatch in server-rendered React.

So ambient access is refused in its bare form -- `Date.now()`, `new Date()` with no argument,
`Math.random()`, `toLocale*`, `Intl.*` without an explicit `timeZone` or `locale` -- and the
determined values are provided instead, resolved once during load and carried in the payload:

```
$.now      $.tz      $.locale
```

**The client agrees by construction.** Hydration re-evaluates the same expression in the browser,
so this would otherwise be the ordinary SSR mismatch that every framework has. Next's own guidance
is to pin the time zone into `Intl.DateTimeFormat`'s arguments so both sides use one value; it can
only be guidance there, because React cannot analyse component code. Here the browser has no
second source to read: the field it reads is the field the server wrote. The failure class is not
mitigated, it is absent.

A weaker rule was considered and rejected: grading strictness by where the derivation lands.
Svelte's own behaviour does distinguish them -- `set_text` compares and silently overwrites, while
a mismatched anchor throws `HYDRATION_ERROR` -- so a wrong slot costs one frame and a wrong branch
costs the whole hydration. But grading only pays when strictness costs the author something, and
once the determined value is available it costs nothing. The distinction survives as the wording
of the diagnostic, not as two sets of rules.

## The payload is frozen

`(p.price = 999)` evaluated successfully, changed the payload in place, and was visible to every
derivation after it. That is not a matter of taste; a function does not modify its argument. The
payload is frozen before the derive stage runs.

## Derivations do not see each other

Each derivation is a function of the payload alone and cannot read another's result. That they
currently can is an artefact of accumulating into one object, not a decision.

Independence keeps **evaluation order out of the protocol**, so two backends cannot disagree by
evaluating in different orders. Recomputation is the cost and it is not worth avoiding; the
compile-time substitution above already removes the case where sharing would have mattered.

## A rune is an ordinary declaration

The compiler used to skip any declaration whose initialiser called a name beginning with `$`, on
the grounds that "a rune holds client state rather than a value the markup can be given". That is
false, and one line of Svelte's server transform says so:

```js
const value = args.length > 0 ? visit(args[0]) : void0;   // the rune's first argument
...
if (declarator.id.type === 'Identifier') {
  declarations.push(b.declarator(declarator.id, value));  // $state(0)  ->  let n = 0
}
```

**On the server there is no reactivity**, so nothing a rune marks can change after the render.
`$state(x)` is a declaration whose value is `x`; `$derived(e)` is one whose value is `e`, wrapped
in a lazy cell that memoises it; `$derived.by(fn)` is `fn()`. `$effect` is not a declaration and
does not run at all -- measured, on a component whose effect assigns `9` to a `$state(0)` read from
the markup: Svelte's server renders `0`.

So a rune declaration is substituted like any other, using the rune's argument as the initialiser.
What made them look different is that they say something about the value's *future*, and the
compiler read that as a statement about its present.

Four are substituted, and the list is short on purpose:

| | |
| --- | --- |
| `$state(x)`, `$state.raw(x)` | the value is `x` |
| `$derived(e)` | the value is `e` |
| `$derived.by(fn)` | the value is `fn()`, so what reaches it is a call |

`$props()` is the payload and is read elsewhere. `$effect` declares nothing and does not run.
`$props.id()` is not substituted either, and for the opposite reason to the one this file used to
give: an earlier draft called it a value the server and the client each generate, which would be
ambient, and Svelte's source says otherwise. The server writes the id into a `<!--$id-->` anchor
from a counter it keeps per render, and the client's `props_id` reads it back off that anchor when
it hydrates, so the value is the server's and is decided per component instance when the bytes are
written. The name stands for a binding the runtime makes at the anchor; see
[refusals.md](refusals.md). Anything else is left unresolved and reported by name.

**An event handler is exempt, and it had to be said twice.** Substituting into one turns an
assignment target into the value it was declared to be: `n += 1` became `(0) += 1`, which is not
JavaScript. The pass that resolves names already exempted handlers; the pass that reduces markup
did not, because Svelte 4 spelled a handler `on:click` and that was a directive carried across
whole, while Svelte 5 spells it `onclick`, an ordinary attribute. Nothing had noticed for as long
as no substituted name was ever assigned to.

The memoisation is worth one line. `$derived(e)` evaluates `e` once however many times it is read,
where substituting it evaluates `e` per use. That is observable only if `e` has side effects, which
[the rule above](#every-identifier-resolves-or-it-is-refused) already excludes.

## What the compile-time render needs from the script, which is nothing

The render that produces the byte skeleton does not read the script. Measured, on the source the
sentinel pass actually hands to Svelte:

```html
<script>let { data } = $props(); let x = 1; x = 2</script><p>{"%%s0%%"}</p>{#if true}<b>y</b>{/if}
```

Every markup expression is already a sentinel and every branch is already a constant, so no name
the script declares is referenced and neither is `data`. Rendering the same markup three ways --
script intact, script reduced to its `$props()`, and no script at all -- gives **byte-identical
output**.

**So the script cannot influence the compile-time bytes, and the only way it can break that render
is by executing.** A script that reads `data` throws inside Svelte's own renderer, because the
render is given no data. That is a reason to stop executing it, not a reason the component cannot
be compiled: what the compiler needs from a component at compile time is its structure, and
structure comes from the AST and from forcing each branch.

**What the runtime needs is not a value either.** A slot needs something it can evaluate to a
value; a branch needs something it can evaluate to a choice. Neither is a value known at compile
time, which is the whole reason this stage exists.

## `{@const}` is the same substitution, one scope in

Svelte's server compiles `{@const x = e}` to `const x = e` in the block it sits in, so it is a
declaration whose scope is that block rather than the script. It substitutes like any other: the
name stands for its initialiser wherever the block's markup reads it, chained where one const reads
another, and taken apart where it destructures -- the same function a destructured declaration
uses. A default or a rest has no way in and is refused by name.

The render is handed something in the initialiser's place, for the reason a declaration reading a
prop already is: by then every read of it is a marker, and evaluating it would reach for data the
render is not given. What stands in has to come apart the way the name does.

## Substitution maps a name to an expression, and a program is not an expression

Every name the markup reads becomes one self-contained expression. `const t = data.a + 1` becomes
`(data.a + 1)`, and nothing else is needed. The limit is exact and it is not about runes:

```
let x = 1; x = 2                Svelte renders 2; substitution sees the initialiser, 1
const o = { a: 1 }; o.a = 2     Svelte renders 2; substitution sees 1
let s = ''; for (...) s += c    there is no expression to substitute at all
```

The first two **compiled and produced the wrong bytes with nothing to say so**, which is the same
shape as every other defect this specification records: a model narrower than its input, and no
error at the boundary.

Running the script instead is not blocked by anything measured. Its inputs are `$$props` and the
module scope, and there is no third: Svelte's compiled component is a function of exactly those,
with no DOM, no lifecycle and no request. What it would cost is written under Open.

## Termination is not one of the three

An earlier draft counted it as the third way to violate the sentence at the top, and claimed it
came free: a derivation is an expression, there is no `while` and no named recursion to write, and
what remains terminates. Imported functions were refused to protect that.

**The guarantee was never there.** Measured, with no carried function, no import and no loop
keyword -- an expression, exactly what this file permits:

```
[...Array(N)].map((_, i) => i).filter((i) => i % 7 === 0).length

N = 1e5      2ms
N = 1e6     11ms
N = 1e7    128ms
```

`N` is a literal the author typed. Two more zeroes and the request never returns.

The languages built for this say the same thing about themselves. CEL is non-Turing-complete and
evaluates in linear time; Starlark forbids recursion and unbounded loops; both are the right prior
art and neither was consulted the first time. But Starlark's own issue tracker puts it plainly:
prohibiting recursion **helps achieve finite execution in theory, while in practice it is easy to
write a five-line program which will not finish**. Syntactic totality buys *finite*, and a request
needs *bounded*.

So the third violation is struck. **This file governs divergence, not cost.** Ambient input,
mutation and non-determinism each make one side wrong -- the server and the browser disagreeing,
or two backends disagreeing about the bytes. A slow derivation is slow everywhere, which is not a
disagreement about anything.

Cost is the same question the load stage raises and it has the same answer: it is the author's,
running the author's code over the author's data in the author's process, and an expression that
will not finish is the same failure as a loader that will not return. The protocol declines both.

The asymmetry that was supposed to follow runs the other way, which is worth recording because it
was assumed rather than checked. **QuickJS can bound execution and Node cannot.** Its
`JS_SetInterruptHandler` is called throughout evaluation and raises an uncatchable exception, and
`rquickjs` exposes it; Node has no way to preempt synchronous code at all. A backend may set a
budget, and that is a deployment choice rather than a rule here.

## Open

- **A default or a rest inside a destructuring.** `const { a = 1 } = t` and
  `const { a, ...rest } = t` both leave a name that is not a member of anything, and a default
  fires only on `undefined` where `??` would also catch `null`, so writing one as the other would
  be wrong rather than partial. Both are reported by name.

  It is the largest thing standing between the compiler and components people have already
  published. The way a modern Svelte library writes a conditional class is `class={cn(...)}` or
  `class={tv({...})}` -- a call, producing a string, in a substitution position the pipeline
  already handles. Measured across 1107 `.svelte` files in eleven published libraries, 267 carry
  such a call. Almost every one of them imports the function it calls.
- **A script that substitution cannot reach.** A reassignment, a mutation or a loop leaves a name
  with no single expression standing for it. **It is refused**, and the refusal is not permanent;
  what it waits on is measured rather than argued.

  Across 4323 real components, 15 assign to a declared name outside a function, and **not one of
  them is refused by that alone** -- every one is also turned away by a spread, a binding or
  something else. So building the machinery would compile nothing that does not compile today. See
  [refusals.md](refusals.md), where the whole ranking is.

  **It is reopened when it becomes the refusal that decides a component**, which means after the
  ones above it in that ranking. Then three questions have to be answered rather than one:
  `<script module>` runs once where an instance script runs per render, so a preamble that merged
  them would rebuild module state per request; the script's imports are a superset of the names
  `carry` bundles today, which follow expressions only; and a backend needs a JavaScript engine
  exactly when a component has a derivation -- 10 of the 14 components in the corpus have none, and
  that survives only if substitution stays the thing that turns a name into a path wherever it can,
  with the script reached for only where it cannot. See [ir.md](ir.md).
- **Per-item derivation.** *Settled.* A derivation reading a name an each block binds is computed
  where it is used, once per item, rather than once before injection.

  It was refused twice over, and the second refusal was right about the fault and wrong about the
  reason. First it was not refused at all: a component writing `{x > 2}` inside an each compiled and
  threw at request time with `deriving \`x > 2\` failed`, because the pass deciding between a path
  and an expression did not know what the block it sat in had bound. Teaching it turned that into a
  compile-time refusal naming the binding -- an improvement, and still a refusal.

  What was wrong is the premise. **"Computed once per request" was read as a rule about derivations
  and is a consequence of what their inputs are.** A derivation is a pure function of what is in
  scope; where that is the payload alone it can be computed once, and where it also reads a loop
  variable the same function is called per item. Nothing else changes: no component runs, no
  markup is rendered, and the expression is the author's own, unrewritten, as every other one is.

  So a scoped derivation is carried into the scope as a function of the scope stack rather than as
  a value, tagged so the injector calls it at the point of use instead of writing it out. A path
  rooted at an each binding is unaffected -- `{x.name}` was always resolved per item by the
  runtime, and the two now differ only in whether a function is called on the way.

  The cost is real and worth naming: an expression inside an each is evaluated once per item rather
  than once per request, so a list of a thousand is a thousand calls. That is what the author wrote,
  and it is what Svelte would have done with it.

  The written-bytes pass still refuses this, and stays refusing. It is an oracle with a limited
  life -- see [pipeline.md](pipeline.md) -- and the agreement test simply does not cover a case the
  render pass takes and it does not.
- **The shape of request context.** `$.now`, `$.tz` and `$.locale` are named here, and the wire
  carrying them is settled -- see [payload.md](payload.md), which means they can hold real values
  rather than numbers the author has to reconstitute. Where they sit within the data, and whether
  the load stage must supply them, is not decided.
