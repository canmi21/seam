# Svelte's own tests, as the measure of how much of Svelte compiles

`pkgs/skeleton/src/skeleton.test.ts` is the refusal surface, and it is ours: every case in it was
written here, which means it measures what somebody thought to write down. It has been wrong in
both directions before -- [refusals.md](refusals.md) records the two times the table it replaced
went stale -- and replacing a remembered list with a check fixed the drift without fixing the
blind spot. A construct nobody here has thought of is absent from both.

**So the measure is somebody else's corpus.** Svelte ships 2395 samples across the three suites
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
| `server-side-rendering` | 132 | the server bytes, directly. Its assertions are ours. |
| `runtime-runes` | 1054 | the client, in runes mode. Repurposed: both sides get the same props and the server render is compared. |
| `runtime-legacy` | 1209 | the client, in Svelte 4 spelling. Repurposed the same way. |

The two runtime suites are not written for a server and the temptation is to leave them out. They
are in because they found most of what was wrong: of the 115 samples that compiled and wrote the
wrong bytes, 97 are theirs. A test written for a client still renders on a server, and the render
is the thing being checked.

**A sample that renders to nothing is a pass.** An agreement whose streams are
`<!--[--><!--]-->` and nothing else is one, and most of them are in the two runtime suites, which
were written to be driven by a client. It had a column of its own, as agreement that was not
evidence; the bytes are the same bytes, and a state nobody acts on differently is a state that
only makes the table harder to read.

**Both streams, because a sample can render everything it has into the other one.** The test read
the body alone, and fourteen samples whose whole content is a `<svelte:head>` were filed as saying
nothing: every head and title case the corpus has, which is which title wins, a block standing in
the head stream, a child's head merged into its parent's, and the anchor a `$props.id()` writes.
They are the only evidence there is for the half of the IR that [ir.md](ir.md) records was missed
once already by reading the body and not the head. A column that says "not evidence" has to be read
as often as the one that says "wrong", and this one was not.

## What a sample comes out as: pass, skip or fail

**Three states, and no more.** Seven columns were read off this suite at one point -- identical,
empty, differs, gap, decided, skipped, oracle -- and a reader could not tell from the table whether
the run was good. What a reader acts on is three things, so the table has three.

**pass** -- seam's bytes are Svelte's, body and head. An empty render on both sides is a pass.

**skip** -- the sample is not a condition of the run, and the list says why. The why is one of
three, and it is written into the reason so that nobody has to guess whose judgement a skip is:

- `upstream:` -- the sample's own `_config.js` says not to run it on the server.
- `blocked:` -- this compiler refuses it because it needs the UI run per request, which waits on
  request-time rendering beside compile-time rendering (see [roadmap.md](roadmap.md), **Blocked on
  request-time rendering**): a value the render changes, a value the payload cannot carry because
  it is a function, a value that is not the same twice, module state its module changes, and async
  Svelte for now. The reason is which of those it is, not the message.
- `harness:` -- neither side answered, because this runner could not ask the oracle. That is a
  debt of this repository's, kept visible in the list rather than folded into either of the others.

**fail** -- everything else: the bytes are not Svelte's, the compiler refused it for a reason that
is not one of those, or the sample disagrees with [the list](#the-list-is-what-verify-holds-it-to).

**A refusal is a skip or a fail, and which one is read off its message**, in a table in the runner:
the classification is the measurement's and nothing in a build has a use for it. **An unmatched
refusal is a fail**, which is the safe direction -- a refusal nobody has classified is work until
somebody says otherwise. The two used to be one column, `refused`, and the figure a reader took away
counted 264 decisions as though they were work.

**And a blocked skip is not an upstream skip.** An upstream skip is somebody else saying not to run
the sample. A blocked skip ran, and this compiler read it and turned it away because what it needs
is not built yet. One prefix
for both would make upstream's column our judgement, which is the one thing it is written not to
be.

**A harness skip is where neither side answered.** Svelte's own render could not be built or run
here, or the sample's own config could not be read, or the props it names could not be built at
all. There is nothing to compare against, so it is not a pass and not a fail. **Whichever half
could not answer, the reason says so**: nobody measured this sample, and the list names it so that
somebody can.

**A harness skip is this runner's debt, and it is paid by doing what upstream's runner does.**
Eighteen were, when the list was first written, and every one was a piece of upstream's environment
missing here rather than anything about the sample:

- **Upstream's helpers.** Twelve `await` samples build their props out of `create_deferred()` in
  `tests/helpers.js`, which is not vendored and was stubbed to throw. It is ten lines that build a
  promise, and it is copied now. The same samples showed the setup running after the props were
  read, where upstream runs `before_test` first; a getter reads what the setup made.
- **Vite's resolution.** Upstream runs a config under Vite, so `./data` is `./data.js` and an import
  of a name a module does not export is `undefined`; Node and rolldown refuse both. Resolved the
  way Vite resolves them.
- **The mode each suite compiles in.** Upstream passes `runes: true` for `runtime-runes` and
  `false` for `runtime-legacy`, unless the sample's own `compileOptions` say otherwise, and the SSR
  suite passes nothing. Both sides get it -- ours through a `svelte.config.js` staged beside the
  sample, which is how a project gives it (see [pipeline.md](pipeline.md)). Without it a file with
  no rune infers legacy mode, which upstream is not testing and which writes other anchors.
- **A DOM.** Upstream renders the runtime suites' server variant under
  `// @vitest-environment jsdom`, which is the next paragraph.

**An upstream skip is what the sample's own `_config.js` says**: `skip: true`, a `mode` upstream
does not run on the server, a `skip_mode` that names `server`, or an `error` the sample is written
to produce. Not our judgement, and never used to make a number look better. A sample skipped here is
skipped by the people who wrote it.

**And a sample that renders only with a DOM is upstream's environment, not a server.** Upstream's
server render runs with jsdom's globals in place, so `customElements.define` in a module script,
`$: document.title = ...` and a bare `{name}` -- which is `window.name` -- render there. Kit's server
is plain Node, where Svelte's own render of the same component throws, so the sample is not one a
server can render at all. The oracle is asked without a DOM, and only where that fails is it asked
again with one; a sample that renders then is skipped with that reason. This compiler is never
given a DOM: a build has none.

**Which requires reading the config, and for 342 samples it was not read.** Upstream's runner is
not vendored, so the imports that reach for it are stood in for; the rule matched
`import { test } from '...'` alone, and 276 of upstream's configs write `import { ok, test }` or
`import { test, ok }`, with the rest reaching for `helpers`, `../../../suite` and
`#client/constants`. Those configs threw on an import nothing resolves, and a config that will not
evaluate was filed as a skip -- which put this harness's own failure in the one column that exists
to hold somebody else's judgement. **A number this column makes smaller is a number nobody checked**,
and the argument two paragraphs up, that folding a decision in here would make the column ours, is
the same argument. Every import that leaves the sample's own directory is replaced now, and what
stands in for a name throws when it is called, so a config that merely mentions upstream's helpers
evaluates and one whose props are built by them says so where the props are read. 276 of the
recovered samples are identical with no change to the compiler, one wrote bytes that are not
Svelte's and three were gaps, and those four are done.

**CodeQL reports the stub as a code construction, and it is dismissed as a false positive.**
`js/bad-code-sanitization`, alert 36. The value is a vendored `_config.js` pinned at one tag and
read off the disk, and the file it is written into is a module this harness already imports and
runs, so a name reaching code position grants nothing that running the config does not: there is no
boundary to cross. The identifier check above is stricter than what the rule's own recommendation
asks for, which is escaping. It cannot be written some other way either -- an ESM named import is
satisfied only by a real export, so the names upstream wrote have to be emitted as names. **What
the alert is worth is the sentence before it**: code built from text nobody parsed is how a shape
this harness does not know goes quiet, and that is the defect this file exists to keep out.

**And a config that still will not evaluate goes where nobody's answer goes.** One is left, and the
rule holds for one the same as for 342: it is not upstream saying anything, so it is not a skip. The
clause is read rather than pattern-matched now -- every name checked against what a `const` may be
written against before it becomes one, and a shape this does not understand reported instead of
left as written, since leaving it as written leaves an import nothing can resolve and the config
fails for a reason that names no shape.

**A `runtime_error` is one of these where it is what the render threw, and only then.** The field is
upstream naming an error the sample is written to raise while it runs, which is `error` one word
along -- the renderer raising it rather than the compiler -- so a render that then raises it has
said what upstream said it would and there are no bytes for either side to be held to. Matched
against what came out rather than taken from the declaration, and the difference is not pedantry:
seven samples write the field and six of them render on the server perfectly well, their
`runtime_error` being what upstream's *client* test asserts. Skipping on the declaration took those
six out of the measurement, which is the one thing this column must not do.

### The oracle is asked even where this compiler refused

It used to be asked second and only where we had bytes of our own, so every sample Svelte cannot
render here was reported as our gap: fifteen of them, a quarter of what was being ranked as work. A
`<svelte:boundary>` whose body throws needs the `transformError` upstream's harness passes and this
one does not. `$: document.title = 'foo'` needs a DOM. Two samples exist to raise upstream's own
error, and one reads a global upstream's harness sets before rendering. None of those is a
difference between two renders, because there is only one render.

**And what a sample says about how to render it is given to the oracle.** A sample whose own
`_config.js` names what the render needs is not a sample the oracle cannot render; it is one this
harness did not read. Three fields say it. `transformError` is the largest: `Renderer`'s
constructor defaults it to a function that rethrows and `boundary()` calls it where the children
throw, so without the sample's own the throw escaped and neither side answered, for eight samples.
`server_props` is what upstream hands a **server** render where it differs from the client's, which
fourteen write and both sides were getting the client's. `before_test` is upstream's setup, and for
one sample it is the environment: `<p>{frag}</p>` over a `globalThis.frag` its config sets.

**And the entry was in the graph twice.** The oracle wrote a compiled copy of `main.svelte` as its
input and the plugin compiled the file again for every child that imports the entry's own
`<script module>`, so that block ran twice and everything it declares had two identities:
`createContext()` closes over a fresh key, and `set` in one copy with `get` in the other is
`missing_context`. The entry re-exports the file now. It is the fault
[refusals.md](refusals.md) records for a copy this compiler stages, met on the other side of the
comparison -- which is worth saying out loud, because an oracle is only an oracle while nothing is
wrong with it.

**With one exception, and it is this harness's own.** Upstream compiles the runtime suites with
`experimental.async` on and this one does not, so Svelte's compiler turns away every async sample.
That is not the oracle failing; it is a question this harness did not ask. The flag is
process-global and irreversible once set, so passing it would make every later sample's render
depend on the order the samples ran in. Those samples stay ours to answer, and they are async
Svelte: compile-time work where the build can know what is awaited, and blocked on async
request-time rendering where the request decides it.

**Which is also how membership of that class is decided.** A sample the oracle cannot build without
`experimental.async` is async Svelte, whatever this compiler's own message says -- two of them were
turned away earlier for a reason of their own and were being ranked as gaps on the strength of that
message while being out of scope either way. Upstream's compiler says which samples those are; a
message match here does not.

### Two passes: the synchronous render and the async one

Every sample is measured in the render upstream measures it in, and there are two: the synchronous
server render, and the same render with `experimental.async` on -- the render a project gets with
the flag, and the only one Svelte 6 keeps (see [roadmap.md](roadmap.md)). The runner is a parent
that starts **one process per pass**, both at once, because the flag is process-global and nothing
turns it off once a compiled component has imported `svelte/internal/flags/async`; each writes its
results for the parent to hold to the list. The async pass stages a `svelte.config.js` with
`experimental.async` beside every sample, so this compiler reads the mode the way a project gives
it, and both renders are awaited.

**The async pass measures the SSR suite and the runes suite**, since upstream's `async-ssr` variant
is `no-test` for the legacy suite. A sample upstream renders in only one of the two passes is
measured there and is upstream's skip in the other, saying which pass has it: `skip_no_async` or a
`mode` naming only the async server render sends a sample to the async pass, `skip_async` or a `mode`
naming only the synchronous one keeps it out of it, and a sample Svelte's own compiler will not
build without the flag is the async pass's whatever this compiler said. It replaced `SEAM_ASYNC`,
the environment variable that ran the async render as an experiment.

**Each sample has a deadline.** An awaited render can wait forever: five samples hand it a promise
that never resolves, and upstream's own async render does not finish either. One that passes the
deadline is reported as the oracle's failure rather than hanging the run.

### `mode` names the modes upstream runs, in each runner's own words

The two runners do not share a vocabulary. The runtime suites' `mode` is `client`, `hydrate`,
`server` and `async-server`; the SSR suite's is `sync` and `async`. In each, the first server mode
is the synchronous render this runner makes and the second is the same render with
`experimental.async` on, so a sample is upstream's skip only where its config leaves neither on.

It was read wrong twice. First for `sync`, which no runtime sample names, so every runtime sample
carrying a `mode` was skipped -- twenty of them server tests upstream runs,
`head-payload-validation` saying `mode: ['server']` in as many words. Then for `server` alone, so
38 samples written for an async server render were filed as upstream's skips, when upstream does
measure them on the server; and `skip_no_async`, upstream's own word that a sample runs only with
the flag, was not read at all. **A condition that cannot be false does not fail. It makes the
denominator smaller and says nothing**, which is the same shape as counting a gap out because the
compiler announces it.

**A sample upstream renders on the server only with the flag is the async pass's**, and upstream's
skip in the synchronous one -- see **Two passes** above.

## The denominator, said once

A percentage over every sample is meaningless, because a skip is not a failure. **The number this
file tracks is pass over pass and fail, and the target is every one of them**: nothing failing.

**The upstream skips.** 445 in the sync pass and 166 in the async one at `svelte@5.57.1`, and every
one is upstream saying so -- in the sample's own config, in Svelte's compiler refusing it without the
flag, or in a render that needs upstream's DOM. Many sync-pass skips are async-pass samples: the
reason says which pass has it. It read 554
while 342 configs were not being read at all, and reading them raised what upstream really declares
as well: `mode` from 160 to 182 and `skip` from 17 to 19, because a config that throws declares
nothing.

**The harness skips.** None in the sync pass and 5 in the async one at `svelte@5.57.1`, every one a
render handed a promise that never resolves, which upstream's own async render does not finish
either. There were 18, and then 57 waiting for an async pass, and what paid them is above.
There is nothing to compare against in one, so counting either way is a claim about a comparison
nobody made -- and a sample skipped because of this runner is a sample nobody has measured, which is
why the reason is written into the list rather than into a count.

**The blocked skips, which wait on request-time rendering rather than being an excuse.** 67 in the
sync pass and 30 in the async one. An `await` is not among them unless it waits on what the request
decides, which is async request-time rendering; Svelte's own corpus has none. An `await` whose value
the build can know is compile-time work, measured in the async pass and failing there until it is
done (see [roadmap.md](roadmap.md)). A refusal that is none of these is a fail --
it is work nobody has done, and hiding it behind the same word as a blocked one is exactly the
confusion [refusals.md](refusals.md) was written to stop.

## What it said the first time it ran, at `svelte@5.57.0`

| suite | samples | identical | empty | differs | refused | skipped |
| --- | --- | --- | --- | --- | --- | --- |
| `server-side-rendering` | 132 | 55 | 4 | 18 | 38 | 16 |
| `runtime-runes` | 1054 | 463 | 15 | 18 | 274 | 278 |
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
decision come out -- 1883 of the 2395 -- and why neither SvelteKit's own test apps nor a real
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

## The list is what `verify` holds it to

**Upstream's tests are not a condition of `verify`; a list this repository keeps of them is.** The
gate used to be two counts, the samples that differ and the samples refused as a gap, and a count
cannot see a sample move between the columns it does not count: identical into a scope skip because
a refusal's message was widened, into an upstream skip because this runner misread a config -- which
is how 342 samples left the measurement once with both counts at zero -- into a harness skip, or out
of the corpus altogether. So every sample is named.

`pkgs/suite/baseline.json` holds every sample in the corpus by `<suite>/<name>`, once per pass it
is measured in -- a `sync` section and an `async` section, each with `pass` and `skip` and a reason
for every skip -- and the Svelte it was recorded against. Version 2; version 1 was one section. It sits with the runner rather
than under `vendor/`, which holds upstream's files and nothing of ours, and an upgrade of the vendor
is then a diff of this file. A run fails where

- a sample the list has passing does not pass,
- a sample the list skips passes, or is skipped for another reason,
- a sample is not on the list, or a name on the list is not in the corpus,
- the Svelte installed is not the one the list was recorded against.

**Every sample runs, skipped ones included**, because a skip's reason is a fact about somebody
else's file or about this compiler, and both move without anyone editing the list: upstream
un-skips a sample at the next tag, a refusal lifted by a change here lets a sample through to write
wrong bytes, a stand-in for upstream's harness makes thirteen samples measurable. A list that is not
checked is only true on the day it was written.

**`--write` records the run as the list, and refuses while anything fails.** A failure is not a
state the list has, so it cannot be recorded away; what the list can take is a sample moving
between `pass` and `skip`, and that is one line in a diff, which is where it is read.

**`--skip-failing` is the one way past that refusal, for one situation.** A sample fails, it has
been decided to be work that is owed -- not a decision, not a skip -- and what else moved still
has to be recorded. `--write --skip-failing` writes the list with the failing samples left off it,
so each goes on failing every run until the work is done, and `verify` stays red with it. It is not
for a failure nobody has read. It was added when one did exactly that: the harness fixes above
turned seventeen skips into passes and upstream skips and one into a refusal nobody had classified,
`runtime-legacy/reactive-import-statement`, decided as owed work at first, and the seventeen could
not be recorded behind it. It was later filed as blocked on request-time rendering; see
[refusals.md](refusals.md).

```
mise run vendor-baseline               the failures, the skips by reason, then the table
mise run vendor-baseline -- --table    the table alone
mise run vendor-baseline -- --write    record the run as the list
mise run vendor-baseline -- --write --skip-failing
                                       the same, leaving failing samples off it; see above
```

Run from anywhere in the workspace it is `mise run //repos/seam:vendor-baseline`.

**The table is written last and the samples are silenced while they run.** A sample is a component
somebody wrote to exercise Svelte and a good number of them log: 127 lines of `0n`, `1n`, `100`,
`undefined` used to come out of the corpus before the table did, and a terminal shows the end of
what a command wrote. Upstream's output is not a result of this run, so it goes nowhere; every
outcome here is a value returned or thrown, so nothing is lost with it.

The corpus is vendored rather than fetched, at one tag, under the workspace's arrangement for
vendored source: see [`vendor/svelte/VENDOR.md`](../vendor/svelte/VENDOR.md). It is 2.0 MB of text
across 5746 files, most of them under 500 bytes -- `du` says 22 MB, which is the filesystem
allocating a 4 KB block per file and not a reason to take fewer of them.

The runner is `pkgs/suite`. It does not call `compile()`: that batches lowering across a whole
project and writes artifacts, and this compiles one component at a time and compares in memory.
The steps are its steps, which is what keeps the two from drifting into two compilers.
