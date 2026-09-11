# What has to pass, in what order, and what each stage proves

Three bodies of tests stand between this compiler and the claim it makes, and they are not
interchangeable. This file puts them in order, says what each one proves that the one before it
cannot, and fixes the condition for calling a stage done -- so that "it works" is a reading of a
number somebody else wrote rather than a judgement made here.

[suite.md](suite.md) is the machinery for the first. [roadmap.md](roadmap.md) ranks the individual
gaps. This file is only the order.

## The order, and why it is this one

**1. Svelte's own samples.** 2388 of them, compared byte for byte against Svelte's own `render()`.
Proves: every way of writing a Svelte component compiles, and compiles to Svelte's bytes.

**2. SvelteKit's own test apps.** Kit's `test/apps/*`, built with this plugin and driven by Kit's
own specs. Proves: a page is what Kit would have served -- routing, the layout chain, the load
stage, the data script, hydration -- with the render replaced.

**3. An application written for Kit, moved.** press, whose components nobody wrote for this
compiler. Proves: the first two are not a description of a test corpus.

**The order is about attribution and nothing else.** A stage-2 failure has two possible causes
while stage 1 has holes -- the framework layer, or a construct the compiler still gets wrong -- and
telling them apart costs more than finishing stage 1 would have. The same again at stage 3, where
a third cause joins them: the application's own code. Each stage removes one explanation for the
next stage's failures, and that is the whole value of doing them in order.

It follows that a stage is not started early to see how it looks. Measuring stage 3 while stage 1
is unfinished produces a number that cannot be acted on, and the number will be good -- press was
byte-identical on 603 of 603 responses while 115 of Svelte's samples were wrong, because press does
not write the constructs those samples cover.

**Neither speed nor size is a stage.** Both are measured and both are recorded -- the comparison
against Kit is in this repository's history and the reductions are in [build.md](build.md) -- and
neither gates anything. A compiler that is fast and writes the wrong bytes has nothing.

## Stage 1: Svelte's own samples

### What "all of them" means, because it is not 2388

Three of the outcomes are not failures and saying so once is what keeps the target honest.

**Upstream's own skips are out.** 239 samples whose `_config.js` says `skip`, or a `mode` upstream
does not run on the server, or a `skip_mode` naming `server`, or an `error` the sample exists to
produce -- or a `runtime_error` that is what the render then threw, which is the same statement one
word along. Not our judgement.

**It was 554, and 342 of those were never anybody's judgement.** The shim that stands in for
upstream's un-vendored runner replaced `import { test } from '...'` and nothing else, and 276 of
upstream's configs write `import { ok, test }` or `import { test, ok }`, with the rest reaching for
`helpers`, `../../../suite` and `#client/constants`. Every one of those threw on an import nothing
resolves, and a config that will not evaluate was filed here -- in the one column [suite.md](suite.md)
requires to be upstream's own and nobody else's. Nobody skipped them. They were not measured, and
four of them are work. Reading the configs raised the skips upstream really does declare, since a
config that throws declares nothing: `mode` went from 160 to 182 and `skip` from 17 to 19.

**A sample Svelte's own render cannot produce bytes for is out.** 18, and 14 of them are this
harness rather than the oracle: 13 whose `props` are *built* by `create_deferred()` and the rest of
upstream's helpers, so neither side can be handed the props the sample names, and one whose config
imports a sibling without naming its extension. Each is a sample nobody measured rather than a
sample that agrees, which is what the column is for and why a config this harness cannot read is
counted here rather than among the skips.

The other 4 are the oracle's own. It is asked even where this compiler refused, so a sample nobody
can render is not counted as our gap -- fifteen of them were, a quarter of what was being ranked as
work. That number was 17 once before, until the eight samples whose own `_config.js` says what the
render needs were read: a sample this harness did not ask properly is not a sample the oracle
cannot render, and all eight were out of the denominator without either side having answered.
[suite.md](suite.md) has the rule and the one exception to it.

**A refusal by decision is out.** 259 samples, in seven shapes the scope line settles, and the
suite counts them in a column of their own rather than beside the gaps:

- **193 await** in markup or at the top of a script, which is async Svelte and the load stage's.
  Which samples those are is upstream's compiler to say: one that will not build without
  `experimental.async` is async Svelte whatever this compiler's own message says.
- **37 change a value** the markup reads while the bytes are written -- assigned after being
  declared, changed by a function this render calls, written into `$$props`, or a store the script
  writes -- which is a program per request. There were 68, and the rule was asked at the
  declaration; it is asked where the walk writes an expansion out now, since the render runs the
  instance script and has the value. [derivation.md](derivation.md) has the rule and
  [roadmap.md](roadmap.md) what came out of moving it.
- **14 want a function off the wire.** The payload carries data and no function, deliberately: see
  [payload.md](payload.md). Eleven subscribe to a store the request brings, `$x` reading whatever `x`
  holds while the bytes are written, so the store itself would have to be in the payload -- and a
  store is an object with a `subscribe` function. Three render a component the request sent, which
  is the same shape: a component is a function. Reading the value, or choosing the component, in
  the load stage is the same page.
- **4 read a value that is not the same twice**, `Math.random`, `Date()` and `Symbol()`, which a
  compile-time render freezes into bytes every request would then share.
- **8 catch what a `<svelte:boundary>`'s body throws.** What the `failed` snippet is handed is
  `transformError(error)`, a render option a server passes and an artifact has nowhere to hold, so
  which of the two shapes a request gets is not a function of the request at all.
- **2 are a raw snippet whose bytes the request decides.** `createRawSnippet` hands the renderer a
  string its own function writes, so an artifact would have to run that function per request, with
  a renderer of its own, to know what the bytes are.
- **1 reads a bare global**, a name no script in the file writes, which can only be a global of
  whatever is running -- and a backend that is not Node embeds an evaluator with no host to hold
  one. [derivation.md](derivation.md) has it, and prices `process`, the one name kept.

[roadmap.md](roadmap.md) holds them. None of them moves. The count itself moved as the work landed,
and upward: a sample refused for a gap earlier in the walk reaches one of these instead, which is
what the last three shapes are -- every one of them was counted as work until somebody read it.

**Everything else is in, refusals included.** A gap is work nobody has done. Counting it out
because the compiler announces it is how a subset comes to be described as a boundary.

So the target is: **of the 1839 samples that are in, every one is byte-identical to Svelte's own
render.** Nothing differing, nothing refused as a gap.

### Where it stands

```
                        samples  identical  empty  differs   gap  decided  skipped  oracle
server-side-rendering       131         90      0        0     0       25       16       0
runtime-runes              1048        667     19        0     0      189      170       3
runtime-legacy             1209       1082     14        0     0       45       53      15
total                      2388       1839     33        0     0      259      239      18
```

Against the target: **1839 of 1839**. Nothing differs and nothing is refused as a gap, which is the
condition this file sets for stage one -- this time over the corpus this file describes. It read
1559 of 1559 first, over one 342 samples smaller: 276 of the recovered samples agreed with no
change to the compiler and four were work, and those four are done.

**The denominator is the measurement, and it is the half that gets audited last.** Every number
in the table moved by 302 samples without a line of the compiler changing, because a column nobody
can see into is a claim nobody checked. The rule this file already stated for the oracle's column
holds for the skips exactly as written, and it was not being applied to them.

**Both numbers moved once before because the columns were read, not because the compiler did.** Fourteen
samples whose whole content is a `<svelte:head>` were filed as agreements that say nothing, and
thirteen were filed as the oracle's failure where what could not run was this harness: it rendered
them without the `transformError`, the `server_props` or the `before_test` their own configs name,
and it held a second compiled copy of the entry, so a child importing the entry's `<script module>`
got a module that had run twice. **A column that says neither side answered is where work hides
without being counted**, which is the whole reason it is read out rather than totalled. See
[suite.md](suite.md).

### What is left, in the order it should be taken

**Nothing, and the four that came out of the skips are done.** None of them had ever been refused
or measured; they were in a column that said upstream had spoken. Each was taken the way this file
ranks work, the difference first, and none of the four was the construct its symptom named:

| | what it was |
| --- | --- |
| `runtime-runes/bind-getter-setter` | **differed.** A `bind:` given a getter and a setter is the getter *called*, and the call was carried on a synthetic node's `name` where an expansion is sliced out of the source by span. The child was handed the function. |
| `runtime-legacy/binding-contenteditable-html` | **a gap**, for a tag this compiler could not read, and the tag was readable: what it could not do was put content inside an element the author closed in one piece. `unbind.ts` had already answered that and the arm planting the content carried its own reading. |
| `runtime-legacy/transition-css-iframe` | **a gap**, for a name the data does not carry, over a `Foo` two lines above it in an `import`. A component import resolves; what it cannot do is reach a derivation, and that is asked over the finished expressions now. |
| `runtime-runes/bindable-prop-and-export` | **a gap**, for a binding the child sends back, over one that sends nothing: `bind_props` assigns up only where the caller passed `undefined`, and the half of `descend()` reading readonly exports was not asking. |

**No sample writes bytes that are not Svelte's.** The last one before those was the identity question rather
than a construct: `runtime-runes/props-equality` handed an array to a child as a prop, and each
read inside the child built it again, so `items.includes(item)` was false where Svelte's own
render, which evaluates the value once, says true. A value that makes something is now held where
it crosses into a child, which [derivation.md](derivation.md) states and bounds.

**No refusal names no specification file any more.** There were 24. [refusals.md](refusals.md)
requires a refusal to say where the question lives, and these said `deriving ... failed` instead,
which happens when the artifact is injected rather than when it is built: a real build writes the
artifact and the server throws per request, the suite catching it only because it injects. The last
two were one question underneath, a value a function this render calls changes, reaching the walk
by a route the rule does not watch -- a spread and a generator rather than a name. Both are now
refused for assigning to a name outside the value this compiler has to write.

**Of the gaps that were being measured, the three left are the scope line said in the wrong words.**
Eight are a `<svelte:boundary>` whose body throws while the bytes are being written: what the
`failed` snippet is handed is `transformError(error)`, a render option a server passes and an
artifact has nowhere to hold, so which of the two shapes a request gets is not one this compiler
can write. Two are a raw snippet whose `render` reads the request and calls `svelte/server`'s own
`render()` inside itself, which is an artifact running Svelte's renderer per request. One is a bare
global the harness sets before rendering, which is a value only a JavaScript host holds and the
second backend has none. [roadmap.md](roadmap.md) records all three as decisions and
[derivation.md](derivation.md) has the third; this table is read off the messages, so the count
moves when the messages do.

**The eight that were work are done, and reading them one at a time is what said which was which.**
Each was measured against Svelte's own render of the sample before anything was written, and three
of the eight were a rule already stated for one construct and not asked by another:

| what it was | where the rule now lives |
| --- | --- |
| a `{@render}` callee asked of the expansion rather than of the author's text | [derivation.md](derivation.md) |
| a `class:` run enumerated whatever it read, where a `style:` run is not | [refusals.md](refusals.md) |
| an ask filed under the expression alone, so two copies of one component shared an answer | [derivation.md](derivation.md) |
| a component binding inside a block, and inside a block another binding settles | [roadmap.md](roadmap.md) |
| a bound value the render is the one to know is not `undefined` | [roadmap.md](roadmap.md) |
| an inert binding written out expanded, and its refusal rolling back the wrong component | [roadmap.md](roadmap.md) |

**The two the order mattered for were the last two.** `runtime-legacy/context-api` was one refusal
standing in front of a difference: with the `class:` directive that turned it away taken off, the
file compiled and wrote bytes that are not Svelte's. Taking the refusal first would have traded the
only column that matters, so the difference was found first and the refusal lifted after.

The three that used to fail inside the derivation evaluator are counted as decisions now, being the
rule about a value the render changes reaching the walk through a spread, a generator and a computed
key rather than by name.

### It is done, and what the second time was worth

`mise run suite` reports 0 differing and 0 refused as a gap, which is the condition this section
sets. It reported that once before over a corpus 342 samples smaller than the one this file names,
and the audit that found those samples is the reason the claim is worth more the second time: the
work that had reached zero stood, 276 of the recovered samples agreed with no change to the
compiler, and four were work. **A target is only as good as the denominator under it**, and the
denominator is the half nothing was checking.

**What the gate cannot see is the denominator.** It fails on the two counts, and both stayed at
zero while 342 samples sat outside them. Two directions are owed and they are the same direction:
a sample sliding from `identical` into `decided`, which is read off a message and a message can be
widened, and a sample sliding out of the measurement altogether. Both want a baseline of names
rather than a count. See [suite.md](suite.md).

## Stage 2: SvelteKit's own test apps

Not started, and not to be started before stage 1 is done.

**What they are.** At `@sveltejs/kit@2.70.2`, `packages/kit/test` holds fourteen whole SvelteKit
applications -- `basics`, `options`, `no-ssr`, `embed`, `amp`, `hash-based-routing`, `writes` and
the rest -- each with its own `svelte.config.js`, `vite.config.js` and a `test/` directory of
Playwright specs. `apps/basics` alone carries `server.test.js`, `client.test.js` and `test.js`,
45 KB, 70 KB and 58 KB of assertions. Beside them are `test/prerendering` and `test/build-errors`.

**What running them means here.** Each app is built with this plugin in its Vite config and
Kit's own specs are run against the result, unedited. `server.test.js` is the one that bears
directly: it asserts what the server sent, which is the half this compiler replaces. The others
assert what the client does afterwards, which is Svelte's own hydration against those bytes and is
therefore a check on them.

**What it will prove that stage 1 cannot.** Stage 1 renders a component. It says nothing about the
layout chain, `load`, `params`, the data script, redirects, error pages, `+server.js`, or the
document shell -- all of which the artifact sits inside. [framework.md](framework.md) is where
that layer is taken from Kit, and this is its check.

**What is already here.** `vendor/kit` holds Kit's `src` and `types` at that tag, and
`mise run test-vendor` runs upstream's Node-side unit suite over them: 38 files, 559 checks. That
is Kit checking Kit, which is a different thing from Kit checking this -- it says the vendored copy
is intact, not that the compiler serves what Kit serves. The apps are not vendored yet, and what
of them to take is a stage-2 decision.

**A known hole waiting there.** The error page is not compiled: `+error.svelte` is not a route, and
a load that throws renders it under the route's own id, so the plugin still hands that render back
to Kit's root. Kit's specs exercise error pages. See [framework.md](framework.md).

## Stage 3: an application written for Kit, moved

Not started. press is the application: a real site whose components were written against
SvelteKit with no knowledge of this compiler, using `bits-ui`, `@tanstack`, paraglide and the rest
of an ordinary dependency tree.

**What it will prove that stage 2 cannot.** Kit's test apps were written to exercise Kit, so they
cover what Kit's authors thought to cover and they are small. An application is neither. The
measure is the one already used on it: every response the built site gives, held against the same
response from a Kit build of the same commit, byte for byte.

**Where it already stands, and what that is worth.** 603 of 603 responses byte-identical, with
every component entered. That is real and it is not stage 3 being done -- it was measured while
115 of Svelte's own samples were wrong, which is exactly the attribution problem at the top of this
file. It is evidence the approach works, not evidence the compiler is finished.

**What stage 3 adds beyond bytes.** The build has to be something somebody would run: the compile
time, the artifact size, and the parts of the Kit build that become unnecessary once nothing
renders per request. None of those are correctness and none of them gate stage 1 or 2.
