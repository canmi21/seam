# What has to pass, in what order, and what each stage proves

Three bodies of tests stand between this compiler and the claim it makes, and they are not
interchangeable. This file puts them in order, says what each one proves that the one before it
cannot, and fixes the condition for calling a stage done -- so that "it works" is a reading of a
number somebody else wrote rather than a judgement made here.

[suite.md](suite.md) is the machinery for the first. [roadmap.md](roadmap.md) ranks the individual
gaps. This file is only the order.

## The order, and why it is this one

**1. Svelte's own samples.** Every one of them, compared byte for byte against Svelte's own `render()`.
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

### What "all of them" means, because it is not every sample

Two of the outcomes are not failures and saying so once is what keeps the target honest. How
many samples each holds is the run's to say: `mise run vendor-baseline` prints them by reason. See the workspace's `spec/agent-protocol.md`, "A number a command prints is cited, not
copied".

**Upstream's own skips are out, per render.** Samples whose `_config.js` says `skip`, or a `mode`
that leaves that pass's server render out, or a `skip_mode` naming it, or `skip_no_async` and
`skip_async` for the render each keeps a sample out of, or an `error` the sample exists to produce
-- or a `runtime_error` that is what the render then threw, which is the same statement one word
along. Not our judgement. [suite.md](suite.md) has the two passes and what each reads.

**It was 554, and 342 of those were never anybody's judgement.** The shim that stands in for
upstream's un-vendored runner replaced `import { test } from '...'` and nothing else, and 276 of
upstream's configs write `import { ok, test }` or `import { test, ok }`, with the rest reaching for
`helpers`, `../../../suite` and `#client/constants`. Every one of those threw on an import nothing
resolves, and a config that will not evaluate was filed here -- in the one column [suite.md](suite.md)
requires to be upstream's own and nobody else's. Nobody skipped them. They were not measured, and
four of them are work. Reading the configs raised the skips upstream really does declare, since a
config that throws declares nothing: `mode` went from 160 to 182 and `skip` from 17 to 19.

**A sample Svelte's own render cannot produce bytes for is out.** When the list was first written
there were 18, and 14 of them were this harness rather than the oracle: 13 whose `props` are _built_ by `create_deferred()` and the rest of
upstream's helpers, so neither side can be handed the props the sample names, and one whose config
imports a sibling without naming its extension. Each is a sample nobody measured rather than a
sample that agrees, which is what the column is for and why a config this harness cannot read is
counted here rather than among the skips.

The other 4 were the oracle's own. It is asked even where this compiler refused, so a sample nobody
can render is not counted as our gap -- fifteen of them were, a quarter of what was being ranked as
work. That number was 17 once before, until the eight samples whose own `_config.js` says what the
render needs were read: a sample this harness did not ask properly is not a sample the oracle
cannot render, and all eight were out of the denominator without either side having answered.
[suite.md](suite.md) has the rule and the one exception to it.

**A refusal is never out.** It used to be: a refusal said to be blocked on request-time rendering
was taken out of the denominator, in eight shapes -- a value the render changes, a store or a
component in the props, a value that is not the same twice, a boundary whose body throws, a raw
snippet the request decides, a bare global, module state, an `await` of the request. Read against
the samples, not one needed Svelte's renderer run per request, and each reason belonged to another
layer or to this protocol's own rules. All of them are in and fail until done; [readings.md](readings.md),
**What the render computes per request, and what each item was**, holds each shape with the reason it was given and
why that reason does not hold, and [suite.md](suite.md) has the rule.

Out of the denominator goes only what somebody other than this compiler said: upstream, in the
sample's own config, or nobody, where neither side could answer.

**Everything is in, refusals included.** A gap is work nobody has done. Counting it out
because the compiler announces it is how a subset comes to be described as a boundary.

So the target is: **every sample that is not skipped passes**, which is byte-identical to Svelte's
own render. Nothing failing. Pass, skip and fail are the three states [suite.md](suite.md) sets,
and a skip is one the list names with its reason.

### Where it stands

**`mise run vendor-baseline` is where it stands**, and nothing here copies its table. What this file
can say without going stale is what `verify` already enforces: a failing sample fails the run, so
the target holds in both renders [suite.md](suite.md) measures, the synchronous one and Svelte's
async one, exactly while `verify` passes, and `verify`'s colour is where stage one stands: green,
with nothing failing in either pass and no harness skip in the list. The async render began at 953 of 985 with 32 owed; what closed them is in
[readings.md](readings.md) and [derivation.md](derivation.md), the last 3 being the script
`hydratable` writes at the head, now written per request from the request's own table -- a value a
prop decides, or a render option's CSP nonce. One sample left the synchronous pass's passes for
its skips on the way, having passed only for the one prop value the suite sends
(`inline-style-directive-update-object-property`); it passes in the synchronous pass again now
that there is one.

**The denominator is the measurement, and it is the half that gets audited last.** Every number
in the run's table once moved by 302 samples without a line of the compiler changing, because a column nobody
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

**What is still refused, ranked, is [roadmap.md](roadmap.md)'s.** The four that came out of the
upstream skips are done. None of them had ever been refused
or measured; they were in a column that said upstream had spoken. Each was taken the way this file
ranks work, the difference first, and none of the four was the construct its symptom named:

|                                               | what it was                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime-runes/bind-getter-setter`            | **differed.** A `bind:` given a getter and a setter is the getter _called_, and the call was carried on a synthetic node's `name` where an expansion is sliced out of the source by span. The child was handed the function.                                        |
| `runtime-legacy/binding-contenteditable-html` | **a gap**, for a tag this compiler could not read, and the tag was readable: what it could not do was put content inside an element the author closed in one piece. `unbind.ts` had already answered that and the arm planting the content carried its own reading. |
| `runtime-legacy/transition-css-iframe`        | **a gap**, for a name the data does not carry, over a `Foo` two lines above it in an `import`. A component import resolves; what it cannot do is reach a derivation, and that is asked over the finished expressions now.                                           |
| `runtime-runes/bindable-prop-and-export`      | **a gap**, for a binding the child sends back, over one that sends nothing: `bind_props` assigns up only where the caller passed `undefined`, and the half of `descend()` reading readonly exports was not asking.                                                  |

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

**Of the gaps that were being measured, the three left were filed as the scope line, and are gaps.**
Eight are a `<svelte:boundary>` whose body throws while the bytes are being written: what the
`failed` snippet is handed is `transformError(error)`, a render option a server passes and an
artifact has nowhere to hold, so which of the two shapes a request gets is not one this compiler
can write. Two are a raw snippet whose `render` reads the request and calls `svelte/server`'s own
`render()` inside itself, which is an artifact running Svelte's renderer per request. One is a bare
global the harness sets before rendering, which is a value only a JavaScript host holds and the
second backend has none. Those were the reasons, and none holds at this layer: a render option the
injector can take, the author's own function called per request, and a global a JavaScript host
has. [readings.md](readings.md) holds all three under "What the render computes per request, and what each item was".

**The eight that were work are done, and reading them one at a time is what said which was which.**
Each was measured against Svelte's own render of the sample before anything was written, and three
of the eight were a rule already stated for one construct and not asked by another:

| what it was                                                                              | where the rule now lives       |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| a `{@render}` callee asked of the expansion rather than of the author's text             | [derivation.md](derivation.md) |
| a `class:` run enumerated whatever it read, where a `style:` run is not                  | [refusals.md](refusals.md)     |
| an ask filed under the expression alone, so two copies of one component shared an answer | [derivation.md](derivation.md) |
| a component binding inside a block, and inside a block another binding settles           | [readings.md](readings.md)     |
| a bound value the render is the one to know is not `undefined`                           | [readings.md](readings.md)     |
| an inert binding written out expanded, and its refusal rolling back the wrong component  | [readings.md](readings.md)     |

**The two the order mattered for were the last two.** `runtime-legacy/context-api` was one refusal
standing in front of a difference: with the `class:` directive that turned it away taken off, the
file compiled and wrote bytes that are not Svelte's. Taking the refusal first would have traded the
only column that matters, so the difference was found first and the refusal lifted after.

The three that used to fail inside the derivation evaluator were counted as decisions, and are gaps
again, being the
rule about a value the render changes reaching the walk through a spread, a generator and a computed
key rather than by name.

### It was called done twice, and what each time was worth

`mise run vendor-baseline` reported nothing failing, which is the condition this section sets, and
both times the denominator under it was short. The second time the blocked skips were the gap: a
column of refusals counted out as boundaries, which were work. The first time it reported that over a corpus 342 samples smaller than the one this file names,
and the audit that found those samples said the same thing both times would: the work that had
reached zero stood, 276 of the recovered samples agreed with no change to the
compiler, and four were work. **A target is only as good as the denominator under it**, and the
denominator is the half nothing was checking.

**So the gate is a list of names, not a count.** Two counts stayed at zero while 342 samples sat
outside them, and a count cannot see a sample move from a pass into a skip or out of the corpus.
Every sample is named in `pkgs/suite/baseline.json` with the state it has to come out as, and one
that moves fails the run. See [suite.md](suite.md).

## Stage 2: SvelteKit's own test apps

**This is the stage that decides whether the version is usable, and it is the one being worked.**
Stage 1 proved the render; this proves the framework around it the way Kit's own authors exercise
it, with nothing of this repository's own standing in for an application. Green here is the
condition for the version, and for starting the second mode --
[roadmap.md](roadmap.md), "The second mode waits on the first".

Not started before stage 1 was done, which it now is. **It targets SvelteKit 3, not 2.** Kit 3 is
on npm as `@sveltejs/kit@next` -- `3.0.0-next.29` the day this was decided, upstream's `main` --
with its `3.0` milestone closed, its migration guide written and a stable release announced as
near; a stage two built against 2.70.3 would be rebuilt against 3 within months, and the framework
layer's root is exactly what 3 changes. `vendor/kit` moves to that tag, and what the move costs is
in [framework.md](framework.md), "SvelteKit 3 is the target, and what it moves".

**What they are.** At `3.0.0-next.29`, `packages/kit/test/apps` holds thirteen whole SvelteKit
applications -- `basics`, `options`, `options-2`, `options-3`, `no-ssr`, `no-csr`, `embed`,
`hash-based-routing`, `writes`, `async`, `dev-only`, `prerendered-app-error-pages` and
`read-file-test`; `amp` is gone since 2.70.3 -- each with its own `vite.config.js` and a `test/`
directory of Playwright specs. `apps/basics` carries `server.test.js`, `client.test.js` and
`test.js`. Beside them are `test/prerendering` and `test/build-errors`. **Ten of the thirteen run
without `experimental.async`**; only `async`, `options-2` and one of `options`'s configs turn it on.
That is why the suite measures both renders: a stage two over these apps is mostly the synchronous
one.

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
`mise run test-vendor` runs upstream's Node-side unit suite over them, and prints its counts. That
is Kit checking Kit, which is a different thing from Kit checking this -- it says the vendored copy
is intact, not that the compiler serves what Kit serves. **The apps are taken whole**: all thirteen
under `test/apps`, with `test/prerendering` and `test/build-errors`, at the same tag as the rest
of `vendor/kit` and by the same rule ([vendor.md](../../../spec/vendor.md) in the workspace). A
subset chosen here would be one more column nobody checked, which is the mistake the skips were.

**The client specs run too, and what they measure is the bytes.** The client is Svelte's own,
hydrating what this compiler served; nothing this compiler ships runs there. So a client spec
that fails is a byte that did not hydrate, which is exactly the check `server.test.js` cannot
make, and it is read as that rather than as anything about the client.

**A known hole waiting there.** Half of the error page is compiled: a component that throws while
it renders is caught by the level's boundary in the generated root and `+error.svelte` is written
in its place, as Kit 3's root does it. The other half is not: a `load` that throws has Kit render
the branch again with the error page as its leaf, under the route's own id, and the plugin still
hands that render back to Kit's root. Kit's specs exercise both. See [framework.md](framework.md).

**How they are run.** `mise run apps -- --app=<name> --spec=<file>`: `pkgs/apps` stages the app
out of `vendor/kit/test/apps` into `.build-apps` in upstream's own layout, since the harness reaches
`../../../test-utils` by relative path, gives it this package's `node_modules` -- `pkgs/apps`
declares what upstream's workspace catalog gave the apps -- and writes two files beside the app
without touching it: a Vite config that is the app's own with `seam()` after `sveltekit()`, and a
Playwright config that is the app's own with the build and the preview run through that Vite
config. Then Kit's `setup.js` and Kit's `playwright test`, over the app's own specs. `--plain`
builds the same app as Kit alone does, which is what a failure is read against: a spec failing
both ways is upstream's or this machine's. Playwright drives the system's Chrome, as Kit's own
config asks (`channel: 'chrome'`).

**Where it stands.** `basics`, `server.test.js`, at `3.0.0`: Kit alone passes 15 and skips 15 (the
project with JavaScript on skips every server spec by design); with the plugin, the same 15 pass. The last to
close was an imported image, whose URL Kit's build decides and is now handed in. Getting there
compiled every one of the app's routes, which is what found the compiler work
[framework.md](framework.md)'s step four records. `client.test.js` and `test.js` are next, then
the other twelve apps.

**The server specs barely look at a page, so every page is compared instead.** Of `server.test.js`'s
fifteen, eleven ask for an endpoint, a static file, a redirect or a status, and four render a page.
`mise run compare -- --app=basics` builds the app as Kit alone does and with the plugin, serves the
first twice and the second once, and asks all three for every page route Kit's own manifest lists
and every path the app's specs name, once each and in the same order, so a counter several routes
share stands at the same value on all three. What two builds differ in by construction -- the
version, the client's file hashes, the port -- and what a `load` reads of the clock or of
`Math.random()` are written out first; an answer whose two Kit servers still disagree is unstable
and not compared.

At `3.0.0`, over 607 URLs: **602 the same bytes, 4 different, 1 unstable** (`/endpoint-output/stream`,
an endpoint writing random bytes). The four are three causes, each owed:

- **`$app/paths`'s `resolve` writes an absolute path where Kit writes a relative one**
  (`/data-sveltekit/preload-data/repeat` and its `target`). Kit's server `resolve` reads the request
  out of its request store and, with `paths.relative` on, which is the default, prefixes `..` per
  segment of the URL being answered; the carried stand-in writes `base` and has no request.
- **A store imported from a relative module and read as `$store` is neither compiled nor refused**
  (`/load/invalidation/multiple/redirect`). The page reads `$redirect_state` from `../state.js`; the
  compile wrote the name into a derivation unbound, and the request throws `ReferenceError`. It
  breaks "Every identifier resolves, or it is refused" in [derivation.md](derivation.md).
- **A component a `load` returns** (`/load/dynamic-import-styles`: `<svelte:component this={data.Thing} />`,
  `Thing` from `import('./_/Thing.svelte')` in `+page.js`). No name in the component's source
  reaches it, and handing a value to Svelte's renderer per request is the one thing compile-time
  rendering does not do, so the request throws the unnamed-component error. The `load` module does
  name it, statically; whether the compile reads the load stage's imports to find it, or the page
  waits for the second mode, is not decided.

## Stage 3: an application written for Kit, moved

Not started, and not scheduled. press is the application: a real site whose components were
written against SvelteKit with no knowledge of this compiler, using `bits-ui`, `@tanstack`,
paraglide and the rest of an ordinary dependency tree. **It is on Kit 2 and being rebuilt around
its CMS**, so it is not a measurement anybody can take today; it comes back when it is on Kit 3,
after stage 2 is green, and nothing here waits on it.

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
