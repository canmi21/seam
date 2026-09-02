# Where the ideas came from

Credit, and a way back. Nearly every decision recorded in this directory was shaped by something
somebody else built, and a year from now the useful question about any of them will be *why*
rather than *what*. This file answers it in one line each and says where the reasoning is written
out.

Something appearing here is not an endorsement of it, and several entries are things that were
looked at and turned down. Those are the ones most worth keeping, because a rejected option
leaves no trace in the code.

## The bytes

**Svelte's serialized output.** The entire response format is Svelte's calling convention, not an
invention: the block anchors `<!--[-->`, `<!--]-->`, `<!--[N-->` and `<!--[-1-->`, the two escaping
sets in `src/escaping.js`, the rule that an attribute disappears when its only expression is
nullish, the hash anchor around a head block, and the title kept in a channel of its own. Reading
them out of the compiler rather than reproducing them by hand is the reason the second pass exists
at all. See [ir.md](ir.md) and [pipeline.md](pipeline.md).

**Svelte's server code generator.** The compiler renders the component and splits the result
instead of writing the bytes itself. Writing them was tried first and cost four undocumented
positional rules before the first real component. See [pipeline.md](pipeline.md).

**Svelte's `set_title`.** Looked at for a precedence rule between two titles, and *not* copied:
two readings of it each disagreed with what it measurably does. More than one title is refused
rather than guessed at. See [ir.md](ir.md).

## The head

**SvelteKit's document shell.** A placeholder in a template that the rendered head is substituted
into, which is the shape `%head%` already had. See [ir.md](ir.md).

**Next.js's App Router metadata, and Remix's `meta`.** Both moved the head out of the component
tree and made it a function of the loaded data, because aggregating it at render time is messy.
Considered and not followed: compile-time rendering knows the component graph statically, so
Svelte has already merged a child's head into its parent's by the time the compiler sees it. See
[ir.md](ir.md).

**React 19's metadata hoisting.** Evidence that the head is an aggregation rather than a
concatenation, which is why it could not simply be appended to the IR. Not usable here, since
hoisting happens during a render and there is no render. See [ir.md](ir.md).

## What an expression may be

**Qwik's optimizer.** What a closure may capture is decided by `const` and by export visibility,
never by proving anything about the code. That is where the rule about carrying a component's
constants comes from. See [derivation.md](derivation.md).

**Bun's macros.** Build-time evaluation requires an input that is statically known and a result
that is serializable. The same two conditions govern folding a module constant into a derivation.
See [derivation.md](derivation.md).

**React Server Components.** A boundary that only serializable values cross, and a convention
where a prop may be a function only if its name ends in `Action` -- shape rather than analysis,
for the third time. See [derivation.md](derivation.md).

**Next.js's guidance on time zones.** Pin the zone into `Intl.DateTimeFormat`'s arguments so both
sides use one value. It can only be advice there, because React cannot analyse component code.
Here the same idea becomes protocol: the determined value moves into the payload and the browser
has no second source to read. See [derivation.md](derivation.md).

**QuickJS.** The sense in which a backend that is not Node embeds an expression evaluator rather
than a JavaScript runtime. Named as a size, not as a dependency. See [pipeline.md](pipeline.md).
Its `JS_SetInterruptHandler` also settled which side can bound a running expression, and the
answer was the opposite of the one that had been assumed: the embedded engine can, and Node,
which cannot preempt synchronous code at all, cannot.

**CEL, and Starlark.** The right prior art for whether an expression language should guarantee
termination, and not consulted the first time the question came up -- framework tooling was
searched when the answer was in expression languages. CEL is non-Turing-complete and evaluates in
linear time; Starlark forbids recursion and unbounded loops. Both were considered and neither is
followed, on the strength of a line from Starlark's own issue tracker: prohibiting recursion helps
achieve finite execution in theory while in practice a five-line program can still fail to finish.
That is what struck termination off the list of things this protocol governs. See
[derivation.md](derivation.md).

## The payload

**devalue.** The wire format, and `crates/devalue` is a port of its `stringify` so that a server
which is not Node can produce it. See [payload.md](payload.md) and
[crates/devalue](../crates/devalue).

**Svelte's `hydratable`.** Evaluated as the mechanism for getting data to the client and not used:
it is experimental, it serializes with `uneval` into an executing script, and it solves the
problem of a client re-running a fetch, which does not arise here. Its development-mode checks for
a key stashed twice with different values, and for one missing at hydration, are the instinct
worth keeping. See [payload.md](payload.md).

**SvelteKit's `data`.** The payload is one prop with a fixed name rather than the props object,
which is what gives anything that is not the author's data somewhere to live. Its `sync` step,
which writes types as plumbing and checks nothing, is also why the ordering question has the shape
it does. See [payload.md](payload.md).

**Next.js's `getServerSideProps`.** The case against plain JSON, made by its users: a props object
restricted to JSON produced `superjson` and a pair of compiler plugins to work around a decision
the framework made for them. See [payload.md](payload.md).

**Tauri with specta, and Inertia.** The two surveyed projects that really cross a language
boundary, and both answer it the same way: the backend declares its types and the frontend's are
generated from them. Neither keeps a neutral schema. See [payload.md](payload.md).

**Askama.** A template checked at compile time against the struct that will render it, reported as
an ordinary error in the backend's own language. It is where the idea of a demand list came from.
The check it suggested in the other direction was dropped, because it catches the same mistake as
the one that remains. See [payload.md](payload.md).

**JSON Typedef and `jtd-codegen`.** Considered as a neutral schema generating both sides, and
rejected: JTD describes JSON, and a `Date`, a `Map` or a `BigInt` has no spelling in it. Choosing
devalue for the wire is what ruled it out, which is why the two decisions are not independent. See
[payload.md](payload.md).

## The starting point

**[Rendering as a Protocol](https://canmi.net/architecture/compile-time-rendering)** and
**[Future of SeamJS](https://canmi.net/architecture/observation-to-lowering)**, which set out
compile-time rendering and the correction the rewrite is built on.

**The `observation` branch.** The previous version, which found structure by rendering against
mock data and diffing the output. Everything in [pipeline.md](pipeline.md) about rendering to
serialise rather than to discover is defined against it.
