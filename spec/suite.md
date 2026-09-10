# Svelte's own tests, as the measure of how much of Svelte compiles

`pkgs/skeleton/src/skeleton.test.ts` is the refusal surface, and it is ours: every case in it was
written here, which means it measures what somebody thought to write down. It has been wrong in
both directions before -- [refusals.md](refusals.md) records the two times the table it replaced
went stale -- and replacing a remembered list with a check fixed the drift without fixing the
blind spot. A construct nobody here has thought of is absent from both.

**So the measure is somebody else's corpus.** Svelte ships 2388 samples across the three suites
whose assertions a server render can be held to, and they were written by the people who decide
what Svelte does. Running them says how far the subset reaches in a way our own cases cannot,
because we did not choose them.

## The oracle is `render()`, not `_expected.html`

Upstream compares a sample's output to its `_expected.html` with `assert_html_equal`, which parses
both and compares the trees: attribute order, insignificant whitespace and the exact anchors do
not survive it. Passing that assertion is a weaker claim than the one this protocol makes.

**So the comparison here is against Svelte's own `render()` of the same component with the same
props, byte for byte, body and head.** That is the same oracle
[refusals.md](refusals.md) sets out and the same one `skeleton.test.ts` uses; what changes is
where the cases come from. It also means a sample with no `_expected.html`, and one whose expected
output upstream keeps for the client, is still usable: the oracle is the renderer, not the file.

## What the suites are, and why all three

| suite | samples | what it was written for |
| --- | --- | --- |
| `server-side-rendering` | 131 | the server bytes, directly. Its assertions are ours. |
| `runtime-runes` | 1048 | the client, in runes mode. Repurposed: both sides get the same props and the server render is compared. |
| `runtime-legacy` | 1209 | the client, in Svelte 4 spelling. Repurposed the same way. |

The two runtime suites are not written for a server and the temptation is to leave them out. They
are in because they found most of what was wrong: of the 115 samples that compiled and wrote the
wrong bytes, 97 are theirs. A test written for a client still renders on a server, and the render
is the thing being checked.

**A sample that renders to nothing is not evidence.** 38 of the 1052 agreements have a body of 20
bytes or fewer, which is `<!--[--><!--]-->` and nothing else -- 34 of them in the two runtime
suites, which were written to be driven by a client. They are agreements and they say nothing
about the compiler, so the suite gives them a column of their own rather than folding them in.

## What a sample comes out as

**identical** -- seam's bytes are Svelte's, body and head. The only outcome that is a pass.

**differs** -- it compiled and the bytes are not Svelte's. This is the serious one: nothing said
so. Everything else announces itself.

**gap** -- the compiler turned it away, named a specification file, and nobody has said that
turning it away is the right answer. This is the list of what is left to do, and
[roadmap.md](roadmap.md) ranks it.

**decided** -- the compiler turned it away and the scope line settles it: async Svelte, a value the
render changes, a value the payload cannot carry because it is a function, a value that is not the
same twice. Out of the denominator, and printed grouped by which decision it is rather than one
message at a time, because for one of them it is the same sentence 183 times.

**A refusal is one of those two and the suite says which, rather than one number for both.** Which
it is was in prose while the table said `refused`, so the figure a reader took away counted 264
decisions as though they were work. It is read off the message, in a table in the runner: the
classification is the measurement's and nothing in a build has a use for it. **An unmatched refusal
counts as a gap**, which is the safe direction -- a refusal nobody has classified is work until
somebody says otherwise.

**And a decision is not a skip.** A skip is upstream saying not to run the sample. These ran, this
compiler read them and turned them away on purpose. Folding them into `skipped` would make that
column our judgement, which is the one thing it is written not to be.

**oracle** -- neither side answered, because Svelte's own render could not be built or run here.
There is nothing to be identical to, so the sample is not a pass, not a difference and not a
refusal.

**skipped** -- upstream's own `_config.js` says so: `skip: true`, a `mode` upstream does not run on
the server, a `skip_mode` that names `server`, or an `error` the sample is written to produce. Not
our judgement, and never used to make a number look better. A sample skipped here is skipped by the
people who wrote it.

### The oracle is asked even where this compiler refused

It used to be asked second and only where we had bytes of our own, so every sample Svelte cannot
render here was reported as our gap: fifteen of them, a quarter of what was being ranked as work. A
`<svelte:boundary>` whose body throws needs the `transformError` upstream's harness passes and this
one does not. `$: document.title = 'foo'` needs a DOM. Two samples exist to raise upstream's own
error, and one reads a global upstream's harness sets before rendering. None of those is a
difference between two renders, because there is only one render.

**With one exception, and it is this harness's own.** Upstream compiles the runtime suites with
`experimental.async` on and this one does not, so Svelte's compiler turns away every async sample.
That is not the oracle failing; it is a question this harness did not ask. The flag is
process-global and irreversible once set, so passing it would make every later sample's render
depend on the order the samples ran in. Those samples stay ours to answer, and what we answer is
the scope line.

**Which is also how membership of that class is decided.** A sample the oracle cannot build without
`experimental.async` is async Svelte, whatever this compiler's own message says -- two of them were
turned away earlier for a reason of their own and were being ranked as gaps on the strength of that
message while being out of scope either way. Upstream's compiler says which samples those are; a
message match here does not.

### `SEAM_ASYNC=1` compiles both sides with `experimental.async` and awaits both renders

The one experiment this runner carries. Upstream's flag is process-global and irreversible once a
compiled component imports `svelte/internal/flags/async`, so it is the whole process or none of it
-- which is why it is an environment variable rather than a per-sample decision. What it measures
is in [roadmap.md](roadmap.md); the short of it is that 143 of the samples this compiler refuses as
async write Svelte's exact bytes with no change to the compiler.

**Each sample has a deadline.** An awaited render can wait forever: five samples hand it a promise
that never resolves, and upstream's own async render does not finish either. One that passes the
deadline is reported as the oracle's failure rather than hanging the run.

### `mode` names the modes upstream runs, and `sync` is not one of them

The skip rule read `mode` for `sync`. No sample in the corpus names that mode -- they are `client`,
`hydrate`, `server`, `async` and `async-server` -- so the test was true wherever `mode` was written
at all, and every sample carrying one was skipped. Twenty of those are server tests upstream runs,
`head-payload-validation` saying `mode: ['server']` in as many words. **A condition that cannot be
false does not fail. It makes the denominator smaller and says nothing**, which is the same shape
as counting a gap out because the compiler announces it.

## The denominator, said once

A percentage over 2388 is meaningless, because three of the outcomes are not failures.

**Upstream's skips are out.** 553 of them.

**A sample the oracle cannot render is out.** 17. There is nothing to compare against, so counting
it either way is a claim about a comparison nobody made.

**A refusal by decision is out, and it is the scope line rather than an excuse.** The suite counts
it in a column of its own, `decided`, and prints the samples grouped by which decision each is.
Async Svelte is most of it: `await` in markup or at the top of a script awaits a promise per request
while the bytes are written, which is the load stage's. A refusal that is a *gap* stays in the
denominator -- it is work nobody has done, and hiding it behind the same word as a decision is
exactly the confusion [refusals.md](refusals.md) was written to stop, which is why the two are no
longer one column.

**Everything else is in.** So the number this file tracks is

```
identical / (samples - upstream's skips - oracle failures - refusals by decision)
```

and the two figures beside it are the count that differs and the count refused as a gap.

## What it said the first time it ran, at `svelte@5.57.0`

| suite | samples | identical | empty | differs | refused | skipped |
| --- | --- | --- | --- | --- | --- | --- |
| `server-side-rendering` | 131 | 55 | 4 | 18 | 38 | 16 |
| `runtime-runes` | 1048 | 463 | 15 | 18 | 274 | 278 |
| `runtime-legacy` | 1209 | 496 | 19 | 79 | 350 | 264 |
| | **2388** | **1014** | **38** | **115** | **662** | **558** |

One sample in `runtime-legacy` failed inside the oracle rather than inside either side, and is
counted apart. The whole run takes eleven seconds, which is worth saying because it is the
argument against ever sampling it: there is no reason to run part of this.

Read against the denominator above, on the `server-side-rendering` suite alone -- 131 samples, 16
upstream skips, 17 async, 2 that ask a boundary to catch a throw -- **59 of 96**.

## This is the first of three, and the order matters

[conformance.md](conformance.md) puts this suite in its place: it is stage one of three, and it
says what "all of them" means once the skips, the oracle's own failures and the refusals by
decision come out -- 1544 of the 2388 -- and why neither SvelteKit's own test apps nor a real
application should be measured until
this one is finished. What follows here is the rule that decides the order of work inside it.

## Bytes before capability, and why that ordering is not obvious

**A difference outranks a refusal, however many refusals there are.** 662 refusals against 115
differences makes the refusals look like the work, and they are not. A refusal is a compile that
stopped and named a file; the author knows. A difference is a page that shipped bytes nobody
asked for, and the entire claim this protocol makes is that the bytes are Svelte's. One of them
falsifies the claim and the other only bounds it.

So the suite's own failure condition is the count that differs, and the refusals are a list it
prints.

## The six that were found the first time, and the shape of the rest

The counts in the table above are the first run's. The first of these six is fixed, which took it
to 1125 identical, 42 differing and 624 refused; [roadmap.md](roadmap.md) records what moved.

**78 of the 115 were one thing: a default on the entry's own props was dropped.**

```svelte
<script>let { foo = 42 } = $props();</script><p>{foo}</p>
```

compiled to a bare read of `foo` off the payload. Svelte writes `42` where the payload has no
`foo`; this wrote nothing. A *child's* default is right, because the render bakes it in and the
walk takes the bytes -- so the fault is in exactly the one component whose props become payload
paths. It is not spread evenly: 64 of `runtime-legacy`'s 79, 13 of the SSR suite's 18, and 1 of
`runtime-runes`'s 18.

**press could not have found it.** Kit's generated root receives `data_0 .. data_n`, `page` and
`form` on every request, so no default on an entry prop ever fires there, and 603 byte-identical
responses say nothing about it. That is the argument for a corpus somebody else chose, stated as
a fact rather than as a principle.

Five more were read off their output:

| | |
| --- | --- |
| `{#each}` over a string | Svelte iterates the characters; this renders nothing. A `Map` and a `Set` were taken and a string was not. |
| a quoted attribute holding one expression | `<Widget baz='{40 + x}' />` passes `"42"` where Svelte passes `42`. Quotes around a single tag do not make it text. |
| an attribute after a spread | `{...{ defaultValue: 'b' }} defaultValue="a"` selects both options; the later attribute has to win. |
| `<select value>` over a child's options | the `<option>` a component renders is not reached, so nothing is marked selected. |
| a namespaced component | `<Components.Foo />` gets a block anchor pair around it that Svelte does not write. |

**All of them are attributed now**, and [roadmap.md](roadmap.md) holds the reading: fifteen causes
across the 42 that remain, the largest a component `bind:` whose writeback the server performs and
this does not. Reading them was a morning rather than a project because the suite prints the first
byte the two renders disagree on beside each name -- a list of forty sample names is not something
anybody acts on.

## Why it is red, and where it is run

The suite fails today and is meant to. It is not part of `verify`: a check that cannot pass stops
being read, and every commit would carry it.

```
mise run suite              the lists, then the table
mise run suite -- --table   the table alone
```

Run from anywhere in the workspace it is `mise run //repos/seam:suite`. It exits non-zero while
any sample writes bytes that are not Svelte's.

**The table is written last and the samples are silenced while they run.** A sample is a component
somebody wrote to exercise Svelte and a good number of them log: 127 lines of `0n`, `1n`, `100`,
`undefined` used to come out of the corpus before the table did, and a terminal shows the end of
what a command wrote. Upstream's output is not a result of this run, so it goes nowhere; every
outcome here is a value returned or thrown, so nothing is lost with it.

It becomes part of `verify` when the count that differs reaches zero -- at which point its
condition changes from "no sample writes the wrong bytes" to "no sample that used to be identical
stops being", which is a regression check and belongs in the gate. The refusals stay a list at
that point, ranked by [roadmap.md](roadmap.md), and the file has nothing left to decide.

The corpus is vendored rather than fetched, at one tag, under the workspace's arrangement for
vendored source: see [`vendor/svelte/VENDOR.md`](../vendor/svelte/VENDOR.md). It is 2.0 MB of text
across 5730 files, most of them under 500 bytes -- `du` says 22 MB, which is the filesystem
allocating a 4 KB block per file and not a reason to take fewer of them.

The runner is `pkgs/suite`. It does not call `compile()`: that batches lowering across a whole
project and writes artifacts, and this compiles one component at a time and compares in memory.
The steps are its steps, which is what keeps the two from drifting into two compilers.
