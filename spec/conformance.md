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

**2. SvelteKit's own test apps.** Kit's `test/apps/*`, built through the fork and driven by Kit's
own specs. Proves: a page is what Kit would have served -- routing, the layout chain, the load
stage, the data script, hydration -- with the render replaced.

**3. An application written for Kit, moved.** `status`, whose components nobody wrote for this
compiler; press was the first, and has left (see **Stage 3**). Proves: the first two are not a description of a test corpus.

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
first two of milestone A's checks, and so part of the condition for the first release and for
starting B -- [roadmap.md](roadmap.md), "Four milestones, and what accepts each".

Not started before stage 1 was done, which it now is. **It targets SvelteKit 3, not 2.** Kit 3 is
on npm as `@sveltejs/kit@next` -- `3.0.0-next.29` the day this was decided, upstream's `main` --
with its `3.0` milestone closed, its migration guide written and a stable release announced as
near; a stage two built against 2.70.3 would be rebuilt against 3 within months, and the framework
layer's root is exactly what 3 changes. `vendor/kit` moves to that tag, and what the move costs is
in [framework.md](framework.md), "SvelteKit 3 is the target, and what it moves".

**Byte for byte with Kit, except where a difference is declared.** Every response is held to the
same response from Kit's own build of the same app, and any byte apart is a defect -- that is the
default, and it holds without being restated per route. A difference is allowed only where it is
written down here, by hand, under **Declared differences**: something this framework does on
purpose that Kit does not, each entry naming the routes it changes, what changes in the bytes, and
what those routes are held to instead. A difference nobody declared is never accepted by
explaining it; a difference that is declared is never a reason to stop comparing the rest of the
response, which stays byte for byte. The fork is what makes this rule necessary: replacing Kit
rather than running beside it means some of what Kit does is done differently here on purpose.

**Declared differences.**

1. **What a render left unsettled is streamed after the page**
   ([framework.md](framework.md), "What a render left unsettled is streamed after the page").
   - _The routes it changes:_ a page whose render started a query or a live query and did not
     await it, and Kit did not write it -- `async`'s `remote/live-ssr-value`, `remote/live-terminal`
     and `remote/query-loading-state` among them -- and, for the client, every page: the client
     runtime carries the call points, so each chunk holding it is a different file under another
     name.
   - _What changes in the bytes:_ in such a page, one declaration in the boot script, the entry
     missing from Kit's `data` where Kit wrote it, a script per entry after the page and the newline
     a streamed response opens with; on every page, the names of the chunks that carry the client
     runtime.
   - _What it is held to:_ the page with the declaration and the scripts taken out, and those
     entries taken out of Kit's `data` as well, is Kit's byte for byte (`withoutStreamed` in
     `@seam-js/stream/fold`); every client file of ours that does not carry the call points pairs
     with Kit's by content, and a page names the ones that do exactly where Kit's names its own.
     `mise run compare` counts such a page apart from the ones the same as they are.
   - _Kit's specs it fails on purpose:_ one, `async`'s `client.test.js` "remote query responses
     are not cacheable", which waits for the client to fetch a query this streams instead (see
     **Closed by a declared difference** below).

2. **What Svelte's `dev` writes about a misplaced element, under the dev server**
   ([build.md](build.md), "The dev server answers with Kit's render, and CTR is checked behind it").
   - _The routes it changes:_ a page with an element its ancestors may not hold, under `vite dev`
     alone, on the first request a process makes of it.
   - _What changes in the bytes:_ Kit's dev server writes one
     `<script>console.error("node_invalid_placement_ssr: ...")</script>` into the head, once a
     message a process; the program never writes it, and the compile prints the message to the
     terminal instead.
   - _What it is held to:_ the page with that script taken out of Kit's answer is Kit's byte for
     byte.

**What they are.** At `3.0.0-next.29`, `packages/kit/test/apps` holds twelve whole SvelteKit
applications -- `basics`, `options`, `options-2`, `options-3`, `no-ssr`, `no-csr`, `embed`,
`hash-based-routing`, `writes`, `async`, `dev-only` and `prerendered-app-error-pages`; `amp` is
gone since 2.70.3 -- and `read-file-test`, a fixture of one file that a spec reads. Each app has its own `vite.config.js` and a `test/`
directory of Playwright specs. `apps/basics` carries `server.test.js`, `client.test.js` and
`test.js` under `test/playwright`. Beside them are `test/prerendering` and `test/build-errors`. **Ten of the twelve run
without `experimental.async`**; only `async`, `options-2` and one of `options`'s configs turn it on.
That is why the suite measures both renders: a stage two over these apps is mostly the synchronous
one.

**What running them means here.** Each app is built with the fork as its Kit -- its
`@sveltejs/kit` is `pkgs/framework`, as the alias would install it, and nothing in it is edited --
and Kit's own specs are run against the result, unedited. Kit's side of every comparison is the
same app with `vendor/kit` as its Kit. A package of the app's that imports Kit itself is given the
fork too: `test-redirect-importer` throws Kit's `redirect` from outside the app, and the one
`vendor/kit` makes is not the class the fork's runtime tests for, which no install would mix. `server.test.js` is the one that bears
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
is intact, not that the compiler serves what Kit serves. **The apps are taken whole**: all of
`test/apps`, with `test/prerendering` and `test/build-errors`, at the same tag as the rest
of `vendor/kit` and by the same rule ([vendor.md](../../../spec/vendor.md) in the workspace). A
subset chosen here would be one more column nobody checked, which is the mistake the skips were.

**The client specs run too, and what they measure is the bytes.** The client is Svelte's own,
hydrating what this compiler served; nothing this compiler ships runs there, and what the fork adds
to Kit's client is the streaming's call points, a declared difference. So a client spec
that fails is a byte that did not hydrate, which is exactly the check `server.test.js` cannot
make, and it is read as that rather than as anything about the client.

**The error page is compiled, both halves.** A component that throws while it renders is caught
by the level's boundary in the generated root and `+error.svelte` is written in its place, as Kit
3's root does it; a `load` that throws, and an error response, render one of the error trees Kit
renders them with, each compiled as a route is ([framework.md](framework.md), "The error page").
Kit's specs exercise both.

**How they are run.** `mise run apps -- --app=<name> --spec=<file>`: `pkgs/apps` stages the app
out of `vendor/kit/test/apps` into `.build-apps` in upstream's own layout, since the harness reaches
`../../../test-utils` by relative path, gives it this package's `node_modules` -- `pkgs/apps`
declares what upstream's workspace catalog gave the apps, with the fork as its `@sveltejs/kit` --
and writes one file beside the app without touching it: a Playwright config that is the app's own
with the build and the preview run through the app's own Vite config. Then Kit's `setup.js` and Kit's `playwright test`, over the app's own specs. `--plain`
builds the same app as Kit alone does, which is what a failure is read against: a spec failing
both ways is upstream's or this machine's. Playwright drives the system's Chrome, as Kit's own
config asks (`channel: 'chrome'`).

**`--kit-root=throw` is the check that no request ran SSR**, milestone A's third
([roadmap.md](roadmap.md)). Given to `mise run apps` or `mise run compare`, it builds ours with
`SEAM_KIT_ROOT=throw`, under which the dispatcher throws, and says so on stderr, wherever it would
have handed a render to Kit's own root (`KIT_ROOT_CHECK` in `pkgs/plugin`). Every such request then
answers differently from Kit's, and `compare` lists each from the server's log by route and status.
The plugin's own sample builds the fork this way every time.

**Where it stands: every app's specs, through the fork, under the check.** Run with
`--kit-root=throw`, so that no request is rendered by Kit's root, every spec of the twelve apps
`dev-only` aside passes in the build Kit's config runs it against, but one, the declared difference's
"remote query responses are not cacheable":

| app                                                                                        | passed | failed      |
| ------------------------------------------------------------------------------------------ | ------ | ----------- |
| `basics`: `server.test.js`, `client.test.js`, `test.js`                                    | 965    | 0           |
| `async`                                                                                    | 214    | 1, declared |
| `options`, `options-2`, `options-3`                                                        | 87     | 0           |
| `embed`, `hash-based-routing`, `no-csr`, `no-ssr`, `prerendered-app-error-pages`, `writes` | 29     | 0           |

The skipped are the specs each project skips by design -- most of them the one with JavaScript or
the one without -- and `dev-only`'s are `vite dev`'s, which milestone A does not cover. What getting
here found, beyond what the comparison had: Kit's `devalue` was this repository's own another major,
since the apps were staged without `packages/kit/node_modules` and what Kit's server build leaves
external was found by walking up past Kit; every page serializing a custom type answered 500 in both
builds, which the comparison had counted the same. And three things of `options`' -- the build's
`--mode`, `import.meta.env` in markup, a `.svelte.md` page's staged copy -- which its comparison had
not asked for ([derivation.md](derivation.md), "`import.meta.env` is the build's").

**The server specs barely look at a page, so every page is compared instead.** Most of
`server.test.js` asks for an endpoint, a static file, a redirect or a status, and few specs render a
page.
`mise run compare -- --app=basics` builds the app as Kit alone does and with the plugin, serves the
first twice and the second once, and asks all three for every page route Kit's own manifest lists
and every path the app's specs name, once each and in the same order, so a counter several routes
share stands at the same value on all three. What two builds differ in by construction -- the
version, the client's file hashes, the port -- and what a `load` reads of the clock or of
`Math.random()` are written out first; an answer whose two Kit servers still disagree is unstable
and not compared.

**Kit's client file names are matched, not masked.** Kit's build reads Kit from `vendor/kit` and
ours from `pkgs/framework`, and the bundler hashes where a module sits into a chunk's name, so the
same chunk comes out under two names and every page naming it differs by that -- which no install
has, since either Kit lands in `node_modules/@sveltejs/kit`. So every file of our client build is
paired with the one of Kit's whose content is the same once the hashes in both are written out, and
the location of Kit's source with them, which an unminified build names in its `//#region`
comments; ours is then written under Kit's name before the pages are compared. A file with no pair
is a difference of its own, reported apart. The same move reorders a list of chunks Kit emits in
the bundler's order -- `/service-worker.js`, a build manifest a page prints -- so a run of entries
with nothing but the list between them is sorted on both sides; the chunks a page preloads keep
their order.

**A body that names its own digest is held to the digest.** `/endpoint-output/stream`, a `+server.js`
of `basics`, answers 256 KB of `randomBytes` per request with a `digest: sha-256=<base64url>`
header, so no two of its answers are the same bytes, Kit's own two included, and it stood as
unstable. Its spec, `server.spec.js`'s "body can be a binary ReadableStream", asks one thing of it:
that the body hashes to the digest. So a response carrying such a header is compared by that and by
its status and type -- `digested()` in `pkgs/apps/src/compare.ts` -- rather than by the bytes, and
the endpoint is not made to answer the same bytes twice: fixing its randomness would be editing
`vendor/kit` or the program under test.

At `3.0.0`, over 607 URLs, the first run found **602 the same bytes, 4 different, 1 unstable**
(`/endpoint-output/stream`, an endpoint writing random bytes). The four were three causes:

- **Closed.** `$app/paths`'s `resolve` wrote an absolute path where Kit writes a relative one
  (`/data-sveltekit/preload-data/repeat` and its `target`): the compile-time render answered it
  with no request. [derivation.md](derivation.md), "Kit's `$app/paths` reads the request".
- **Closed.** A store imported from a relative module and read as `$store` was neither expanded
  nor refused (`/load/invalidation/multiple/redirect`), and the request threw `ReferenceError`.
  [derivation.md](derivation.md), "A store read is the store's value, where the store is a
  declaration".
- **Closed.** A component a `load` returns (`/load/dynamic-import-styles`:
  `<svelte:component this={data.Thing} />`, `Thing` from `import('./_/Thing.svelte')` in
  `+page.js`). No name in the component's source reaches it, so the request threw the
  unnamed-component error. The `load` module names it statically, and the page now holds bytes for
  each component a universal `load` imports and names the one it was handed by identity:
  [framework.md](framework.md), "A component a `load` returns". It was held to need the fork, and
  did not.

With the three closed and the endpoint held to its digest: **607 the same**.

**Every other app, compared the same way**, each built with its own config, mode and preview
environment as its own scripts give them. Measured again with the fork as each app's Kit, every
figure here and above came out the same as it had with the plugin beside Kit's own:

| app                                                                                                     | URLs         | result                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------- |
| `embed`, `hash-based-routing`, `no-csr`, `no-ssr`, `options-3`, `prerendered-app-error-pages`, `writes` | 2 to 17 each | all the same                                               |
| `options`                                                                                               | 51           | all the same                                               |
| `options-2`                                                                                             | 22           | all the same; it calls remote functions                    |
| `async`                                                                                                 | 104          | 101 the same, 3 declared, below                            |
| `dev-only`                                                                                              | --           | Kit's own build fails by design: the app is for `vite dev` |

**Under the check build, the same figures, and what they had hidden.** Built with
`--kit-root=throw`, so that no answer could match Kit's by being Kit's root's, every app above comes
out as the table says, with no request reaching Kit's root. Getting there found that the figures had
been partly Kit's own render, which matched Kit by being it:

- **Every error page**, in every app: a `load` that threw, a route nothing matched. Compiled now, as
  the trees Kit renders them with ([framework.md](framework.md), "The error page").
- **Every page of `options`.** The app is built with `-c vite.custom.config.js`, and its routes were
  read through a `vite.config.*` that was not there: none was compiled. With them read through the
  config the build was given, three were refused, and are compiled now -- a page under an
  extension the config adds, `.jesuslivesineveryone` and `.svelte.md`, and a page's own
  `hydratable` ([derivation.md](derivation.md), "`hydratable` is the request's").
- **Two `async` pages whose remote module the compile could not stand in for**: one imported
  `./touched.remote.js` for a `.ts`, one exported `_delete as delete` ([derivation.md](derivation.md),
  "A remote function runs where Kit's server runs it").
- **`basics`' `no-ssr/ssr-page-config/layout/overwrite`**, whose module the compile cannot evaluate,
  and which Kit renders to its level's error page ([framework.md](framework.md), "A module that
  cannot be evaluated on the server").

What this found and closed: the `?worker&url` of `no-csr`, `compilerOptions` read off Kit's plugin
for `async`, and remote functions for `async` and `options-2` ([derivation.md](derivation.md), "A
remote function runs where Kit's server runs it").

**Closed by a declared difference: what has settled when the render ends.** Kit writes a query
the render only started -- read for `.loading`, `.ready` or `.current`, never awaited -- into the
page only where its promise has settled by the time the render ends, racing it against one
microtask (`collect_remote_data`, "the implicit 'still loading' heuristic"), and leaves the rest
for the client to fetch. So the bytes depended on how far a render had got, and two pages landed on
the other side of it: `remote/live-ssr-value` and `remote/live-terminal`, a live query's first
value, which a page injected in one synchronous pass ended too early to keep. The fork streams what
is left after the page instead ([framework.md](framework.md), "What a render left unsettled is
streamed after the page"), so the three pages that start a query and do not await it --
`remote/query-loading-state` the third -- are the same as Kit's once what they streamed is taken
out of both, and `mise run compare` counts them so.

**Kit's specs over them, built through the fork.** `test.js`'s "query rendered in its loading state
during SSR is fetched on the client" and "SSR data for query.live is reused on hydration" pass, with
JavaScript and without; so do `client.test.js`'s two over `remote/live-terminal`. One fails by
design: `client.test.js`'s "remote query responses are not cacheable" loads
`remote/query-loading-state` to make the client fetch its query, and waits for that request to read
the response's `cache-control`; streamed, the request is never made. It passes on Kit's own build.
What it checks, the header on a remote function's response, is Kit's code, unchanged.

**Closed: a value a boundary computed twice.** `remote/query-loading-state` is a one-second query
beside a half-second `{await}`, and the `{await}` was computed by the boundary's run and again by
its hole: the render took a second, the query had settled, and an entry Kit does not write was
written. The hole now reads what the run computed. [ir.md](ir.md), "A value is computed once, by the
run, and the hole reads it".

**Closed: a component that throws while it renders, whatever the request.** The four `async` routes
the remote work left were Kit's tests of exactly that: `server-error-boundary` and its two children
throw from the top of a component's script, and `remote/form/throwing-error-page`'s `+error.svelte`
throws as well. [ir.md](ir.md), "A component that throws whatever the request is a hole that
throws".

**Under the dev server, every page compared the same way.** `mise run compare-dev -- --app=<name>`
stages the app twice as `compare` does and serves each under `vite dev` rather than building it --
Kit's own, and the fork's, which compiles a route as a request asks for it -- asking Kit's server
for each URL, then ours, then Kit's again. Two dev servers of one app differ in more than two builds
do, and it is written out before comparing: where each one's files and Kit sit, which the boot
script imports by path; the port; the version Kit names a server by, the time its config was read
unless the app names one, and with it the anchor of a `{@html}` block holding a page that names it,
rewritten only where it is the hash of that block's content; and the `?v=` stamp Vite's optimizer
gives a dependency. Kit names a remote function from an optimized dependency by a hash of a path
that carries that stamp, so a page the same once those ids are written out is counted apart, and
a page Kit's own two answers disagree on is checked to differ from Kit's first only in numbers and
CSP nonces.

**All twelve apps, every page the same.** Of 810 URLs, 748 are the same, one -- `async`'s
`remote-lib` -- the same but for a dependency's remote id, and 61 unstable in Kit's own answers,
of which ours is one of Kit's for 16 and differs from Kit's first in numbers and nonces alone for
the other 45: clocks, randoms, a counter Kit's server was asked twice for, a nonce per request. None
different. Under `--kit-root=throw` the same, but for a page a `load` fetches from its own app --
`embed`'s two, `options-2`'s `fetch-prerendered` -- on its first request, which the middleware never
sees ([build.md](build.md), "The dev server answers with Kit's render, and CTR is checked behind it").

The referee is on throughout ([build.md](build.md), "How it keeps itself right"), and across the
twelve apps it disagreed with Kit's render nowhere; `compare-dev` counts what it said, and a
disagreement fails the run as a different page does, since the page it answers with is Kit's.

What it closed on the way: a `{@html}` anchor written as a hash of a marker; a carried run whose
copy of Svelte was not the render's; a route `reroute` names; a path decoded otherwise than Kit's
`decode_pathname` decodes it, and one taken for a static file because a directory had its name; a
throw under `if (dev)`; a module that throws as it is evaluated, answered as an overlay instead of
Kit's error page; and an
`<option>`'s ` selected=""` written before the scoping class every element carries under the dev
server, which a build gets wrong too wherever a stylesheet selects an option.

## Stage 3: an application written for Kit, moved

**The application is `status`**, the status page in `repos/web/apps/status`: SvelteKit 3, written
with no knowledge of this compiler, its page rendered per request from what its server `load`
reads, beside an endpoint, and built with the plugins an ordinary project carries -- Tailwind,
StyleX, Sentry's, Vercel's adapter -- and packages of the author's own workspace. It is milestone
A's fourth check ([roadmap.md](roadmap.md)), taken once Kit's apps give the confidence to.

**What it will prove that stage 2 cannot.** Kit's test apps were written to exercise Kit, so they
cover what Kit's authors thought to cover and they are small. An application is neither: its own
dependency tree, other plugins in the same Vite build, and data decided per request that a static
build could not have baked and a client-rendered page would not have served.

**How it is measured.** The way stage 2 measures an app: built twice from a copy, never in place,
once with Kit and once through the fork, and every response held to Kit's byte for byte but where a
difference is declared. Its data is live -- Supabase, and the marks it fetches from `symlink.si` --
and its `load` reads the clock, so both servers start with one module loaded ahead of the app that
fixes the clock at one instant and answers those requests from generated data, and refuses every
other request out; the page is rendered per request from that data, and hydrates. The data is
generated from the row types of `@monoflake/probe`, at the size of a middling production, by a
seeded generator: nothing is read from or written to the platform. The copy may be changed where
measuring it needs, and every change is listed beside it; the application itself is not changed.

**And what a response costs is held too, to one bar: CTR is not slower than SSR.** `status` is not
a benchmark and not something to show: its page writes little markup and does a great deal of
work over its data, which CTR leaves where it was, so no gain is expected of it. What is checked is
that CTR costs no more. Kit and the fork serve the same bytes, so the client does the same after
them and what differs is what a response costs the server: Kit's (SSR), the fork's (CTR) and the
same HTML as a file (SSG) are each asked the same page, with the data answered at once and after a
fixed delay, and their CPU time per request compared.

**Where it stands.** Every one of its twelve URLs is Kit's byte for byte, built with the check that
no request reaches Kit's root. Getting there found, in order: a placeholder of the walk's leaking
into a child's script (`@lucide/svelte`'s `Icon`); a staged copy's bare imports rewritten to files,
which StyleX does not recognise, so every page threw; a module script's StyleX recipes written into
derivations ([derivation.md](derivation.md), "A module script's binding is read from the module");
a child's locals and defaults that read a context through a package ("What a package computes in a
child's script is asked of the render"); a spread's keys hidden by the boundary's guard; the
server's environment read through a module ("The environment a server starts with is read per
request"); a package component's head anchor hashed by its link rather than its real path
([build.md](build.md), "A filename is an input to the bytes"); and a `style:` directive's value
read through no file.

**The cost is Kit's, within two percent.** A request took about 640 ms of CPU through the fork
against 65 ms through Kit, then 230 ms once an instance and a computing `{@const}` were made once
([derivation.md](derivation.md), "An instance is made once"); what was left was how a derivation
was evaluated, and the request-time half became one program per route ([ir.md](ir.md), "A route is
one program"). Measured on the same machine, the page 5.1 MB:

|                                     | through Kit | through the fork |
| ----------------------------------- | ----------- | ---------------- |
| eight at a time, p50                | 467 ms      | 417 ms           |
| eight at a time, 20 ms a query, p50 | 828 ms      | 774 ms           |
| one at a time, wall                 | 72.9 ms     | 74.2 ms          |
| one at a time, CPU                  | 80.5 ms     | 82.3 ms          |

Under load the fork answers sooner; one request at a time it takes about 1.3 ms longer, which is
inside what two runs of the same server differ by and is not less than nothing. The render alone
is about 34 ms against Kit's 32, of which 25 ms is the page's own `dailyOf` and `historyOf`, run as
often as Kit runs them. Measured by the harness in `.local/status`, which builds, compares and times
both.

**Under `vite dev` as well.** `.local/status/dev.ts` serves both copies under the dev server over
the same data and clock: `/`, `/?range=hours`, `/?range=minutes` and a page that is not there are
Kit's byte for byte, none reaching Kit's root, and a warm request of `/` is 86 ms under either. What
the dev server costs is the compile, which [build.md](build.md), "What it costs, on `status`",
records. The copy installs the fork as the alias would rather than linking it whole, with its peers
the application's: linked whole it reached its own Vite, and Kit's dev server, which asks whether
the server environment is runnable by `instanceof`, refused to start.

**The harness is local.** It lives in an ignored directory of this repository, since the
application is the author's own and the data is made up for it; what it found goes here.

**press was the first, and has left.** A site of the author's on Kit 2, measured byte-identical on
603 of 603 responses with every component entered while 115 of Svelte's own samples were wrong --
evidence that the approach worked rather than that the compiler was finished, which is the
attribution problem at the top of this file. It has left this workspace and is not a
measurement any more; what it found is in [refusals.md](refusals.md) and [build.md](build.md),
which keep its figures.

**What stage 3 adds beyond bytes.** The build has to be something somebody would run: the compile
time, the artifact size, and the parts of the Kit build that become unnecessary once nothing
renders per request. None of those are correctness and none of them gate stage 1 or 2.
