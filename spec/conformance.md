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

**Upstream's own skips are out.** 553 samples whose `_config.js` says `skip`, or a `mode` upstream
does not run on the server, or a `skip_mode` naming `server`, or an `error` the sample exists to
produce. Not our judgement.

**A sample Svelte's own render cannot produce bytes for is out.** 17. The oracle is asked even
where this compiler refused, so a sample nobody can render is not counted as our gap -- fifteen of
them were, a quarter of what was being ranked as work. [suite.md](suite.md) has the rule and the
one exception to it.

**A refusal by decision is out.** 264 samples, in four shapes the scope line settles, and the suite
counts them in a column of their own now rather than beside the gaps:

- **183 await** in markup or at the top of a script, which is async Svelte and the load stage's.
  Which samples those are is upstream's compiler to say: one that will not build without
  `experimental.async` is async Svelte whatever this compiler's own message says.
- **33 change a value** the markup reads while the bytes are written -- assigned after being
  declared, changed by a function this render calls, written into `$$props`, or a store the script
  writes -- which is a program per request. There were 68, and the rule was asked at the
  declaration; it is asked where the walk writes an expansion out now, since the render runs the
  instance script and has the value. [derivation.md](derivation.md) has the rule and
  [roadmap.md](roadmap.md) what came out of moving it.
- **9 want a function off the wire.** The payload carries data and no function, deliberately: see
  [payload.md](payload.md). Six subscribe to a store the request brings, `$x` reading whatever `x`
  holds while the bytes are written, so the store itself would have to be in the payload -- and a
  store is an object with a `subscribe` function. Three render a component the request sent, which
  is the same shape: a component is a function. Reading the value, or choosing the component, in
  the load stage is the same page.
- **4 read a value that is not the same twice**, `Math.random`, `Date()` and `Symbol()`, which a
  compile-time render freezes into bytes every request would then share.

[roadmap.md](roadmap.md) holds all four. Three of them do not move. The count itself moves as work
lands, and upward: a sample that used to be refused for a gap earlier in the walk reaches one of
these instead.

**Everything else is in, refusals included.** A gap is work nobody has done. Counting it out
because the compiler announces it is how a subset comes to be described as a boundary.

So the target is: **of the 1542 samples that are in, every one is byte-identical to Svelte's own
render.** Nothing differing, nothing refused as a gap.

### Where it stands

```
                        samples  identical  empty  differs   gap  decided  skipped  oracle
server-side-rendering       131         85      4        0     2       18       16       6
runtime-runes              1048        577     18        0     4      172      268       9
runtime-legacy             1209        870     22        0     8       38      269       2
total                      2388       1532     44        0    13      229      553      17
```

Against the target: **1545 of 1558**, with nothing differing and 13 refused as gaps. Seventeen fail
inside the oracle rather than inside either side and are counted apart. The gaps are sorted by who
has to answer them in [roadmap.md](roadmap.md).

### What is left, in the order it should be taken

**No sample writes bytes that are not Svelte's.** The last one was the identity question rather
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

**The 13 gaps, by what they are.**

| count | what it is |
| ----- | ---------- |
| 6 | a component binding sending a value back where the condition is the request's |
| 3 | a `{@render}` whose callee this compiler cannot follow to a `{#snippet}` |
| 1 | a context read in a value this compiler has to write itself |
| 1 | a value handed to a component and used for something other than being written out |
| 1 | a `<select>` around a component the walk could not enter |
| 1 | a choice over a name an each block binds, which cannot be enumerated for the page |

The first is a decision about block semantics and [roadmap.md](roadmap.md) has it. Every one of them
names a specification file, which is the whole of what a refusal owes. The three that used to fail
inside the derivation evaluator are counted as decisions now, being the rule about a value the
render changes reaching the walk through a spread, a generator and a computed key rather than by
name.

### When it is done

`mise run suite` reports 0 differing and 0 refused-as-gap. At that point the suite's failure
condition changes from "no sample writes the wrong bytes" to "no sample that passed stops
passing", which is a regression check, and it joins `verify`. See [suite.md](suite.md).

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
