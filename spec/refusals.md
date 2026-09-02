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

## Nothing is outside on principle

The list of what is refused today falls entirely into the first two kinds:

| | |
| --- | --- |
| `{#await}`, `{#key}`, an each with an index or a key, `{:else}` on an each | measured, trivial, unwritten |
| snippets, children, `{@render}` | inlining, which composition already does |
| `class:`, `style:`, `<select value>` | decidable by enumeration; deferred on what they are worth |
| `{...spread}`, `<svelte:element>` | an unenumerable decision, so a small closed runtime node |
| per-item derivation, which of two titles wins, who owns CSS | not decided |

**So "a subset of Svelte" is a statement about how far the work has got, not about where a line
was drawn.** The subset grows, and the README should say that rather than implying a boundary
nobody has found.

One thing is not looked at closely enough to be listed either way. **Context** -- `setContext` and
`getContext` -- writes nothing structural into the bytes, but where its value comes from would
need a compile-time walk of the component graph that has never been attempted here. It may turn
out to be ordinary. It has not been shown to be.

## What is not refused, and is not ours either

`{@html}` writes bytes without escaping them, which is what it is for. **Nothing in this protocol
checks what those bytes are**, and that is the same position every comparable framework takes:
React makes the author write `dangerouslySetInnerHTML` and sanitizes nothing, and Svelte's own
documentation says it performs no sanitization and asks the author to escape the string or to
populate it only with values under their control.

It is worth stating rather than assuming, because the distance here is one hop longer. The value
reaches `{@html}` out of the payload, and where the payload came from is the load stage, which
[derivation.md](derivation.md) puts outside the protocol on purpose. So the chain from the author
to the bytes runs through a stage nothing here governs, and it is still the author's.

The one place the decision is visible to a backend is `escape: false` on a `slot`, which means
write these bytes as they are. See [ir.md](ir.md).
