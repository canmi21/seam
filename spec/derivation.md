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

> **A derivation is a pure, total, deterministic function of the payload.**

Everything below follows from that sentence, and the sections are the three ways to violate it:
ambient input, side effect, non-termination.

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
off a node it has already parsed, so nothing new is parsed and no dependency is added.

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
| `<script module>`, exported | evaluated once at build time and inlined as a literal; the value must be serializable |
| `<script module>`, not exported | refused, with instructions to export it |
| instance `<script>`, not reading props | refused, with instructions to move it to `<script module>` |
| instance `<script>`, reading props | **lifted into a derivation** |

The last row is not a concession. `const total = p.price * 2` **is a derivation the author wrote
outside the markup**: its free variables are props, and its shape is the same as the expression
inside `{#if p.price > 10}`. Lifting it costs no new mechanism, and it turns the loudest current
failure into the most ordinary feature.

A chain, `const a = p.x * 2; const b = a + 1`, is substituted at compile time into `(p.x * 2) + 1`
rather than emitted as two derivations. That keeps derivations independent of one another, which
the section below relies on.

**Imported functions are not carried.** Not because they are impure -- most are not -- but for the
termination reason given at the end.

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

## Termination comes from the shape

Neither prior art helps here. Qwik and Bun both serialize or evaluate, and neither has to bound
anything.

It is free anyway, because **a derivation is an expression, not a statement**. There is no
`while`, no `for`, and no named recursion to write. What remains -- `.map`, `.filter`, `.reduce`
over finite arrays -- terminates. No instruction budget is needed, and the two backends do not
need different mechanisms to agree.

**This guarantee is exactly as strong as the decision not to carry imported functions.** A
carried function can recurse, at which point termination returns to the author, an embedded
runtime needs a budget, and a component can succeed on one backend and exceed a budget on
another.

## Open

- **Imported functions.** They should be allowed eventually: `format(p.d)` is a pure function of
  the payload and there is no principled reason to refuse it. What has no answer yet is
  termination, which the shape argument above no longer covers once a function can call itself.
  Prior art gave nothing for this. It stays refused until there is a mechanism, not a preference.

  It is also the largest thing standing between the compiler and components people have already
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
