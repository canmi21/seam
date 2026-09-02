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

A render is given no data, so a declaration reading a prop is handed `null` in the source the
compiler renders. It has already been substituted into every expression that used it, which
leaves it dead there. That is what a component doing this used to crash on, inside Svelte's own
renderer, with a `TypeError` naming nothing an author could act on.

**An imported function is carried, on one condition: its source has to be reachable at compile
time**, so that it can be bundled with the expression that calls it. It usually is, being a module
the author already depends on.

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

- **A declaration that is not a plain `const` or `let`.** A function declared in a script, a
  class, and a destructuring other than `$props()` are all still unresolved names. Each is the
  same substitution with a different shape to read off, and none waits on a decision.

  It is the largest thing standing between the compiler and components people have already
  published. The way a modern Svelte library writes a conditional class is `class={cn(...)}` or
  `class={tv({...})}` -- a call, producing a string, in a substitution position the pipeline
  already handles. Measured across 1107 `.svelte` files in eleven published libraries, 267 carry
  such a call. Almost every one of them imports the function it calls.
- **Per-item derivation.** A derivation is computed once against the payload, so an expression
  inside an each block is refused. What it needs is a value per iteration, which is a different
  mechanism rather than a larger version of this one. See [ir.md](ir.md).
- **The shape of request context.** `$.now`, `$.tz` and `$.locale` are named here, and the wire
  carrying them is settled -- see [payload.md](payload.md), which means they can hold real values
  rather than numbers the author has to reconstitute. Where they sit within the data, and whether
  the load stage must supply them, is not decided.
