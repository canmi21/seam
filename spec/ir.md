# The intermediate representation

The IR is what the compiler produces and the route's program is written from. It is the
representation the whole rewrite exists to introduce: v1 had no shared typed representation, and
the thing that crossed between the two halves was a string. **It stops at the build**: what a
server runs is the program the build writes from it ("A route is one program", below).

## What it is

**A program that emits HTML, not a model of the document.** Walking it produces the response
bytes. It says what to concatenate and in what order, and nothing else.

`<article>` is not a node. It is part of a string. There is no element tree, no attribute map,
no tag nesting, because a runtime that only concatenates does not need them. That is what lets
a backend be dumb: resolve a path, escape a value, append. Three operations, no knowledge of
Svelte, no knowledge of HTML.

## What it replaces

v1 stored the skeleton as HTML text carrying `<!--seam:...-->` markers, and re-tokenized it on
every request. Three hand-written HTML parsers existed because of that decision: one to extract,
one to verify the extraction, one to inject. Measured on a 30KB page with 200 dynamic positions,
scanning that text cost 26.3us against 15.4us for walking a precompiled tree, and the scan grows
with the length of the skeleton while the walk grows with the number of nodes.

The speed is not the reason. Neither number is close to mattering against a budget of several
hundred microseconds. **The reason is that two of those three parsers stop existing**, and with
them the class of bug where the extractor and the injector disagree about what a marker means.

## A route is one program

**The build writes each route's IR and derivations as one program, and a request runs it once.**
`@seam-js/program` lowers the tree into the statements that write it: a static run is a string
literal, a slot its value escaped, an `if` an `if`, an `each` a loop over what Svelte's
`ensure_array_like` makes of its source, a `call` a function of the fragment's parameters, a
title and an id the counters `set_title` and `props_id` keep. A derivation is a function of the
request computed when first read, or, where it reads what a block binds, a function of those names
called where the walk reads it. Every name an expression reads is resolved when the program is
written, to what it meant where the author wrote it ([derivation.md](derivation.md), "A name is
resolved when the program is written"); nothing is looked up by name while it runs.

It replaced a walk of this tree per request that called into the engine once a hole: each
derivation a `new Function` reading its names through nested `with` over a proxied scope stack, the
walk a generator stepping every node. On `status` that was about 91,000 evaluations and 540,000
proxy traps a request, and a request cost three times Kit's; the program costs what Kit's render
does ([conformance.md](conformance.md), "Stage 3"). What Svelte's bytes need of a runtime and are
rules rather than values -- escaping, `hydratable`'s script, stepping through what waits -- stays a
library the program is handed, `@seam-js/runtime`, so the program imports nothing.

The program is a script, sloppy as `new Function` makes it since the expressions are the author's
own and were evaluated so; it holds no `with`, reads nothing of Node's host, and the carried bundle
goes before it in the one file a route ships ([build.md](build.md), "A route is one script, and
every backend runs it"). The suite runs every corpus case's script in QuickJS and holds its bytes
to Node's.

## Node kinds

Five, and the tree bottoms out in strings. `body` and `head` are the two streams Svelte renders
and the two the program writes; `title` and `styles` are channels it keeps beside them. A component that
uses none of the three leaves `head` and `title` empty.

```json
{
	"component": "product",
	"head": [],
	"title": [],
	"body": [
		{ "t": "static", "s": "<!--[--><article class=\"card\"><h1>" },
		{ "t": "slot", "path": "data.name", "escape": "content" },
		{ "t": "static", "s": "</h1>" },

		{
			"t": "if",
			"branches": [
				{
					"test": "data.available",
					"body": [{ "t": "static", "s": "<!--[0--><button>Buy</button>" }]
				},
				{ "test": null, "body": [{ "t": "static", "s": "<!--[-1-->" }] }
			]
		},

		{ "t": "static", "s": "<!--]--><!--[-->" },

		{
			"t": "each",
			"source": "data.tags",
			"item": "t",
			"body": [
				{ "t": "static", "s": "<span>" },
				{ "t": "slot", "path": "t", "escape": "content" },
				{ "t": "static", "s": "</span>" }
			]
		},

		{ "t": "static", "s": "<!--]--></article><!--]-->" }
	]
}
```

- **`static`** -- an opaque string. Markup and Svelte's anchors sit in it indistinguishably; the
  runtime neither parses nor inspects it.
- **`slot`** -- a data path and an escape mode. Nothing else, but for one flag: `fresh` marks the
  anchor of a `$props.id()`, whose value the runtime counts out rather than reads -- `s1`, `s2`, in
  output order, which is the order Svelte's own server counts in -- and binds under the path in the
  innermost scope for every read that follows. The one value in the IR a backend makes rather than
  resolves, and it is a counter. See [refusals.md](refusals.md).
- **`if`** -- branches, each with a test and a body. The last branch may have `"test": null`,
  which is the else.
- **`each`** -- a source path, the name bound to each item, an optional `index`, and a body.
  `index` is the name the source binds to the counter, and it is absent rather than null when the
  source binds none. **The item is always a name**, including where `{#each xs}` binds none:
  `EachBlock.js` writes the `for` loop either way and only skips `let <context> = each_array[i]`
  when there is no context, so the block runs the same number of times and the name is the block's
  own, which nothing reads. **A destructuring context is not a name here**: `{#each m as [k, v]}` binds
  two and neither is the item, so the skeleton binds the item under a name of its own and every
  name the pattern binds is an expression over that one, which leaves this node one shape.
  See [derivation.md](derivation.md). **A key is not here at all**: Svelte's server transform never mentions one,
  and a keyed each renders byte for byte what an unkeyed one renders -- measured, on a full list
  and an empty one. `EachBlock.js` visits the expression, the context, the index, the body and the
  fallback, and not `node.key`. A key exists for the client's reconciliation, and the client
  compiles from the source, where it still is -- **and the render's copy stays keyed**, its
  expression replaced by a literal rather than the whole `(...)` removed. The expression has to go,
  because the render iterates one placeholder item the key would be evaluated against; the key
  cannot, because a keyed each is not the same markup as an unkeyed one. An `animate:` element must
  be the only child of a keyed each and `2-analyze/visitors/shared/element.js` asks `parent.key` for
  exactly that, so unkeying the copy made Svelte refuse to compile it, with `animation_missing_key`
  -- upstream's own message on upstream's own samples, which is the shape that says the fault is in
  what was handed to it. Replacing the expression rather than the parentheses also stops a key
  holding parentheses of its own from having the wrong pair cut out. **An `{:else}` is not here either**: an each with one is lowered as
  an `if` around the `each`, testing whether the list has anything in it, with the fallback as
  the else -- which is the shape Svelte's own server output has, and it needs no node of its own.
  See [refusals.md](refusals.md).
- **`attr`** -- one attribute of the element being opened, written between the static chunk
  that opens the tag and the one that closes it. It carries `parts`, which are `static` and
  `slot` nodes, and it is the only node that can decide to write nothing at all. One name carries
  a table with it: `translate`, whose value `true` is written `"yes"` and `false` `"no"`, because
  `translate="false"` would mean yes. It is the whole of Svelte's `replacements` in
  `internal/shared/attributes.js`, and a backend carries it under the name the way it carries the
  boolean list.
- Bodies are node arrays, so the shape recurses.

- **`call`** -- a fragment's name and what each of its parameters is bound to, a path or a
  derivation resolved where the call sits. The runtime opens a scope holding the parameters and
  walks the fragment's body there, the way an `each` opens one per item. The bodies live beside
  the streams in `fragments`, by name, and are absent where a component has none. This is
  recursion in structure -- a component rendering itself, a snippet rendering itself -- and nothing
  else: the body is fixed and the depth is the data's. See **Recursion is a fragment and a call**.

`{@html}` needs no node of its own. It is a `slot` with `escape: false` between two static
`<!---->` chunks, which is the anchor pair Svelte writes around raw HTML. Nothing checks what
those bytes are, which is the author's, and is written out in [refusals.md](refusals.md).

## Svelte's anchors are baked in, not emitted

The comments in the output are not Seam's protocol. They are **the calling convention of
Svelte's client-side hydration**, which reads `<!--[-->`, `<!--]-->`, `<!--[0-->` and `<!--[-1-->`
to find block boundaries and learn which branch was taken. Seam's own structure is carried by
the node kinds above and never appears in the output.

Every anchor is a constant, so every anchor is compiled into a `static` chunk -- including the
per-branch markers, which live inside the branch they belong to. **No backend ever emits one, so
no backend ever needs to know that Svelte exists.** That is what makes "any language that can
concatenate strings can serve this" true rather than aspirational, and it is why the branch
marker is inside the branch body rather than a field the runtime interprets.

The alternative was an invented vocabulary translated at request time. It was measured at about
4% over the baseline walk, so cost was not the objection. The objection is that it expresses the
same information twice and puts a Svelte-shaped obligation in every backend.

v1 could not do this. It aimed to support more than one UI framework, so it could not depend on
any one framework's ABI and had to define its own. v2 commits to Svelte, which is what makes
borrowing the ABI available.

## An attribute can disappear, which is why it is a node

`data-x={value}` is not `data-x="` plus a slot plus `"`. When the value is null or undefined
Svelte writes no attribute at all, and a slot inside a static chunk cannot take the surrounding
characters with it.

The rule is narrower than it looks, and was measured rather than assumed:

| written                                | result                                      |
| -------------------------------------- | ------------------------------------------- |
| a single expression, null or undefined | the attribute is absent                     |
| a single expression, empty string      | `name=""`                                   |
| a single expression, `false` or `0`    | `name="false"`, `name="0"`                  |
| several parts, one of them null        | the null becomes empty, the attribute stays |

So an `attr` node omits itself only when it has exactly one part, that part is a slot, and the
value resolves to null or undefined. Everything else is written.

**Except where the name decides otherwise, which it does in two ways.** An `attr` node carries a
`presence`:

|            |                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------- |
| `value`    | written unless the value is null or undefined                                               |
| `boolean`  | present or absent: `name=""` when the value is truthy or an empty string, nothing otherwise |
| `nonempty` | written unless the value comes out empty                                                    |

So `disabled={false}` produces nothing while `data-x={false}` produces `data-x="false"`, and
`class={""}` produces nothing while `title={""}` produces `title=""`. `hidden` is boolean for
every value but `until-found`, which the value decides rather than the name. All three are facts
about HTML rather than about Svelte, which is what makes carrying them into the runtime
affordable.

**This is the one rule the render cannot show, and the reason is worth recording.** Rewriting an
expression to a sentinel makes it a string literal, and Svelte folds a literal attribute into the
template rather than calling the helper that decides presence:

```
disabled={data.d}      $.attr('disabled', data.d, true)     the helper, with boolean semantics
disabled={"%%s0%%"}    <input disabled="%%s0%%"/>           folded, the semantics gone
```

The bytes collected are correct for the rewritten program and wrong for the written one. No other
rewrite helps: a boolean attribute's output is `name=""` or nothing, and **a sentinel can stand
where a value is substituted but not where presence is decided.** So the `attr` node carries a
`presence` field and the runtime carries the rule, and a backend still does not learn that Svelte
exists.

It was found by measuring rather than by reading, and the corpus missed it because the case that
covers attributes writes `disabled` as a static attribute. A static attribute cannot stand in for
a dynamic one, here or anywhere else: it takes a different path through the compiler. The general
form of both halves -- where a sentinel can stand, and why a static example measures the wrong
program -- is in [pipeline.md](pipeline.md).

## Escaping is Svelte's, and is not what you would guess

`escape` is a mode, not a boolean, because Svelte escapes two ways and neither is general HTML
escaping:

| mode      | characters replaced | left alone        |
| --------- | ------------------- | ----------------- |
| `content` | `&` `<`             | `>` `"`           |
| `attr`    | `&` `<` `"`         | `>`               |
| `false`   | none                | the raw HTML slot |

`>` is never escaped, in either. That is Svelte's `escape_html` in `src/escaping.js`, and it is
part of the ABI for the same reason the anchors are: the bytes have to match.

This was not deduced. The first run of the conformance diff described below disagreed with
Svelte on `<b>&x`, because the obvious implementation escapes `>` and Svelte does not. It cost
one run to find, and would have cost considerably more as a hydration mismatch reported by
somebody else.

## Composition inlines, and needs no node

A child is spliced into its parent at compile time, with its paths rewritten.
`<Badge label={data.name} />` lowers the child's `{label}` into a slot on `data.name`;
`<Badge tone="warm" />` lowers the child's
`{tone}` into **static text**, because a prop passed literally has nothing left to resolve. The
runtime has no notion of a component, and the injector did not change to gain one.

That works only because every prop value is already a path or a literal, which is the same
constraint the protocol places on everything else. A prop that mixes text and an expression was
refused, having no value to pass until something computed one; it is the template
`build_attribute_value` builds now (the struck row of [readings.md](readings.md)'s table for a
quoted attribute holding one expression).

The unit is still the component. A bundle carries the entry and everything reachable from it,
and lowering walks that graph -- so a cycle is an error rather than a hang, and a component the
bundle does not carry is named rather than skipped.

## A boundary that may throw is a block of its own, and a `try` in the program

`renderer.boundary` writes one of two shapes: `<!--[-->`, the children, `<!--]-->` where they do not
throw, and `<!--[?`, `transformError(error)` as JSON, `-->`, the `failed` snippet over that value,
`<!--]-->` where they do. Which one, and the JSON, are the request's: `transformError` is a render
option the server passes ([payload.md](payload.md), the render input), and whether the children
throw can turn on a prop. So a boundary with a `failed` snippet is a decision, and **the skeleton
records it as a block of kind `boundary`**: a test that the children did not throw, and the JSON.

**It is a kind of its own in the skeleton and not in the IR.** Its branches are the IR's `if`: the
first branch's opening anchor is Svelte's constant, copied as bytes like any branch marker, and the
second's is `<!--[?`, a slot holding the JSON unescaped -- Svelte's own serialisation already
escapes `<` and `>` in it -- and `-->`. The assembler is what knows that shape, because the JSON in
the render it reads is the build's, not the request's. No backend learns what a boundary is, which
is the rule under **Svelte's anchors are baked in, not emitted**.

**The children's values are computed per request, in the order the render computes them, inside
one catch.** That is the test and it is where the error comes from: the error an expression throws
is not data and cannot be carried from the build, so it is thrown again per request by the same
expressions, and handed to the request's `transformError`. The children are walked as any markup
is -- components entered, blocks recorded, the body rendered at the build as a skeleton -- and the
run is read off what the walk recorded: a hole's value, an `if`'s tests choosing the branch whose
values follow, an `each`'s source iterated with its body's values per item and its fallback where
it is empty, a component entered as a fragment as a function of its parameters that a call inside
it calls again. Everything is data: the run renders nothing, it computes what the skeleton's holes
and blocks would read, which is what a derivation is ([pipeline.md](pipeline.md)). The children's
own values are holes guarded against the throw, which cannot be written anyway: the branch that
holds them is the one taken when nothing threw. The `failed` snippet's parameter is bound to the
transformed value, so what it reads is the request's like any other hole, in whichever component
the snippet hands it to.

**Inside both branches every value is a hole, even one the request does not decide.** Whether it
throws is the request's question -- the run asks it of the children, the request's `transformError`
asks it of the snippet by choosing a branch -- and the render made at the build would throw it there
instead, for every request. A derivation is computed only where it is read, so a hole in a branch
no request takes throws for none. What may read a context stays the render's, having nowhere else
to be read: Svelte's context API by name, and anything imported from Svelte or from a component's
module script, which is where a `createContext` getter comes from.

**Three things the guard leaves as written, found by putting Kit's root inside it.** SvelteKit 3
renders every page under a `<svelte:boundary>` per level, so every component of every page is a
child of one ([framework.md](framework.md)). A literal, and a component the file imports -- what a
`<svelte:component this>` settles to, and a name Svelte has to be handed as a name. A context read,
for the reason above: guarded, it carried a helper, and an expression carrying a helper is asked to
be a derivation, which a context read cannot be, so the page was left to the render whole and its
data rendered empty. And the guard is not a maker: a prop expanding to a guarded value is the same
value the caller holds, and holding it again ([derivation.md](derivation.md), "A value that makes
something is held where it crosses into a child") wrote the hold into the render's own source.
**What is written into the render's source is unguarded**: an ask and a want are the render's
questions at the build, answered by a render that has no helper to call, so the guard is taken
off them (`Walk.untried`) while the key each is filed under keeps the guarded text, since the
pass that asks and the pass that reads the answer have to spell it the same.

**A guard around a script run's value is `async`.** `awaiting` leaves the run's own
`await $$run(...)` out, as not the author's await, and the guard used it to choose between
`$$tried(() => ...)` and `(await $$tried(async () => ...))`; a value read off a run inside a
boundary then sat in a function that is not `async`, where `await` is a plain name in sloppy mode
and the derivation is a syntax error. The guard counts the run's await too.

**A child's value goes into the run as a held reference under the child's own files.** The run is
one derivation, filed under the chain the boundary sits in, and a value inlined into it as text
resolved its names -- an import, the `$$run` of the file whose script runs per request -- in that
chain instead of its own: a page's run inside Kit's root, whose layout level is a boundary, made a
run of the layout, whose captured script then imported what only Kit's build provides. So each
value is written as `$$hold(n)` over the skeleton's held list, carrying the files it was recorded
under, and lowering resolves it through them ([derivation.md](derivation.md), the file chain).
Two kinds stay text: a value reading a name the run binds -- an each's item, a fragment's
parameter -- which is a value per iteration where a held reference is one per request; and a
value that awaits, since `derive` settles a derivation's async dependencies before it evaluates,
which would put the rejection outside the catch the run exists to put it inside. **A value that
awaits is still read through its own files**: written bare, a page's `await getCount()` inside the
layout's boundary looked `getCount` up in the layout, which never imported it. It goes to
`$$within(files, $scope, $request, { <what the run binds> }, "<source>")`, which `derive`
provides and which evaluates the source with names resolving as they would have in place: what the
run binds around it, the request's own, the data, the child's files, then the derivation's own
scopes. As source rather than inside a `with` written into the derivation, because TypeScript's
stripper refuses a `with` and gave up on the whole derivation, which kept its annotations and
stopped at the first colon -- Kit's `/remote`, written in TypeScript. The source has its types
taken off before it is quoted. **A value reading a name the run binds goes the same way**, an each's
item handed in among the run's own: a child's select spread inside an `{#each}`, whose `multiple`
test reads `form.for(value.id)`, looked the child's import up in the layout. Kit's
`remote/form/as-value`. `derive` evaluates the piece `async` only where it awaits. And the throw
reaches `transformError` as the author threw it: a held reference is a derivation, and `derive`
wraps what one throws in a `DerivationFailed` naming the source, which `caught` takes off by its
name -- by name, because it is carried into the bundle and shares no `Error` to test against.

### A component that throws whatever the request is a hole that throws

**A `throw` standing directly in a component's instance script runs every time the component
renders**, whatever it is handed, and Kit's `async` app tests exactly that: a page, a layout and a
nested page that throw from the top of their script, each caught by the boundary Kit's root puts
round its level, and a page whose own error page throws. The compile-time render met the throw and
refused, because what a boundary catches is the render's and not a list this compiler holds.

So such a component is not entered. Its call site becomes one hole whose value is
`$$rethrow(() => (<the thrown value>))`, which `derive` provides, guarded where the walk guards:
the branch written for nothing having thrown evaluates nothing, and the boundary's run reads the
hole inside its catch, so every request takes the `failed` branch with the request's
`transformError` of the same error, which is what Svelte's render does. An error page that throws
is the same hole in the `failed` branch, read only by a request that takes it.

The thrown value is evaluated at the call site, where the component's own names are not, so one
that reads them -- `throw new Error(message)` over a `message` the script declares -- is refused by
name. A `throw` inside an `if`, a function or a block is the request's question, and stays the
refusal above -- except an `if` on one of Kit's constants the compile knows, `dev` or `browser`, or
its negation, which is the branch it takes ([build.md](build.md), "How the dev server compiles a route"): Kit's `errors/serverside` throws `if (dev)`.

**A run reads its values bare of every guard, its own and the ones round it.** Kit's root puts a
boundary at every level, so a page's own `<svelte:boundary>` is always inside one, and the page's
values reached it already guarded by the outer boundary. Taking off only its own guard left the
outer `$$tried` in the run, which swallowed the throw the run exists to catch: a query rejecting
inside the page's boundary rendered the branch for nothing having thrown. Kit's `remote/batch-ssr`.

**A boundary inside the children is a catch of its own.** Every level of Kit's root below the
first with an error page is one, so the shape is every page of an app with two error pages. Its
children are computed when its own test, a held reference under its files, is read; the run reads
the test and, where it threw, computes the failed branch's values inside the outer catch, since
those are the values that boundary writes and one of them throwing is what the outer catch is for.

**A boundary whose branches write a head stands in the head stream.** An error page setting its
`<title>` under Kit's root is the common case. The block is mirrored as an if is, opened at the
start of each branch and closed at its stamp, and the assembler reads a bare boundary in the head
as it reads a bare if: no anchors of Svelte's to write, no JSON to open the failed branch with.
One thing is the boundary's own: Svelte's boundary discards everything the children pushed when
they throw, the head anchor with the rest, while the open's record of having opened survives, so
the failed branch's open is told to open again.

**What the run cannot follow still refuses**: an `{#await}`, a `<svelte:element>`, a call of a
fragment the run did not define. Each computes in an order of its own that the recorded holes and
blocks do not say.

### A boundary is a `try`

**The program writes a boundary as `renderer.boundary` renders one.** The lowering writes the block
as an `if` whose test is `!($$caught(...)).threw` and whose other branch is the `failed` snippet,
and the program knows that shape: the children are written into a buffer of their own inside a
`try`, kept where nothing threw, and otherwise thrown away for the request's `transformError` of
what did and the snippet over it, its JSON first. Every value is computed once, where it is
written, and what throws is what Svelte's render would have thrown at that point. **The run is not
evaluated**: what it was for -- learning whether the children throw before writing either branch --
is what the `try` is.

A guard inside one lets the throw through. `$$tried` is the program's own while a boundary's `try`
is open, and the carried helper's, which swallows, everywhere else; `$$caught` reads what the
nearest boundary of its key came to, which is how the `failed` snippet reads its value and its
JSON. Both fall back on the carried helpers, and so on the run, where the program finds no body
half to write a boundary from -- one whose children write only a head.

**The head half reads what the body half came to.** The body is written before the head, so the
head's copy of the block reads the outcome its body half recorded, by key, or in order for a
boundary computed per item. Where only the head half throws, the boundary failed, as it does in
Svelte, whose children write both halves into one renderer: the head writes the snippet, the
title channel is put back as it stood, and the body half is written again as the snippet, at the
place it was written. A per-item boundary whose head alone throws has no place kept, and the throw
leaves the page.

A rejection a boundary's children wait on reaches the `try` the same way: `drive` throws it back
into the program where it waited, rather than out of the render.

Measured on `status`, under Kit's root boundary at every level: the run computed every value of
the page inside its catch and the walk computed each item's again, 36 ms of a 43 ms render; as a
`try`, the render is the walk alone.

### A value is computed once, by the run, and the hole reads it

_This is how the run computed once what the holes would read, and it holds where the run is still
evaluated; the program computes a value once where it writes it, above._

Svelte computes each of a boundary's values once, inside its catch, and writes what it computed. The
run and the holes are two readers of that one computation, and each used to make it: the run to
learn whether it throws, the hole again to write it. A value with an effect told them apart -- a
counter wrote `2` where Svelte wrote `1` -- and one that waits held the page for twice as long, which
moved what had settled by the time Kit collected its queries (Kit's `remote/query-loading-state`).
The outcome was read three times over: the test, the JSON and the `failed` snippet's value each ran
the children again and called `transformError` again.

So **every guard carries a key**, the boundary's index, the guard's count in it and a digest of the
value's text -- a route joined out of several structures carries the derivations of each, and two
counting alike over different values must not meet. The run computes the value as
`$$kept($$request, key, () => value)`, which keeps it under the key in a table of the request's own,
and the hole's guard, `$$tried($$request, key, () => value)`, reads the kept value where there is
one and computes it only where there is not. A promise is kept as the promise, so the hole awaits
what the run awaited rather than calling again. `$$caught` keeps its outcome under the boundary's
key in the same table, so the run is made once per request whoever reads it. The table is keyed by
the object `derive` binds as `$$request`, one per request and shared by all of its derivations, and
lives exactly as long as that request.

What is asked of a value -- whether it is a literal, whether the author awaits, whether it reads
what the run binds -- is asked of it with its guards taken off, not of the kept form: there, the
author's `await` sits inside the function `$$kept` is handed, and only the kept form's own `await`
showed, so a value that awaited nothing but its script's run read as one the author awaits.

**A value computed once per item is not kept.** Inside an `{#each}` or a component entered as a
fragment and called again, the run computes it per item and so does the hole, and nothing the hole
can read says which of the run's items it is: an item's own value is not enough, since two items may
be equal. Such a guard has no key, and the value is computed again where the hole reads it, as it
was before; so is every value of a boundary that sits inside an each or a fragment, whose run is
itself made per item.

## Recursion is a fragment and a call

`<svelte:self>` is `build_inline_component(node, analysis.name)` in `SvelteSelf.js`, a component
calling itself; a component importing its own file is the same call; a snippet rendering itself is
its function calling itself, `RenderTag.js`. In all three the body is one fixed shape and the
depth is whatever the data has -- a tree, a thread of comments -- which is recursion in structure
and not in code, and the IR carries it as such: the body once, under a name in `fragments`, with
its parameters as names the body reads per call, and a `call` node wherever it is entered, the
first time from outside included. The runtime binds each parameter to the value at its path, in a
scope of its own, and walks the body; a `call` inside the body is met again with the next value,
and ends where the data does.

**A fragment is also where a node that several branches hold is kept.** A route with a declared
domain, or one whose walk met a choice it had to ask about, is compiled once per structure and the
structures are joined under an if -- and the branches are the same page compiled against different
values, so most of what they hold is the same. Measured on press's article, which joins fifty-four:
the bodies hold thirty-odd nodes each and ninety distinct ones between them, 4.29 MB of nodes that
are 0.67 MB of distinct nodes. So a node written the same way in more than one branch is held once
in `fragments` and called from each, and a node only one branch holds stays where it is, since a
call plus a fragment is bigger than the node.

Such a call is marked `shared`, and that is what says it **adds no scope of its own**. A frame is
what a fragment with parameters needs; one here would capture what a `fresh` slot writes into the
innermost scope for the reads of it further along, and the reads would find nothing once the call
returned. Measured: `id="bits-s1"` became `id="bits-"` on every page carrying a menu.

**How the body gets its region.** A component call has no boundary in the bytes, so the walk
gives the body one: it wraps the body in `{#if true}` in the render, marked `bare` so the anchors
the render carries stay out of the bytes, and the assembler finds the region by the block's stamp
as it finds any block's. Two things `clean_nodes` does to a fragment had to be written back: a
snippet's or component's body that opens with text gets `<!---->` ahead of it (`is_text_first`),
which an if's body does not, so the fragment carries `textFirst` and the assembler writes it; and
the body of a recursive component has to hold no `<svelte:head>`, which cannot sit in a block, so
one that does is left to the render. A rest gathered per call is left to the render as well.

**How the calls get their bytes.** Every call but the first renders a stand-in in place -- an
empty snippet rendered, an empty copy called -- and the stand-in writes the hole's marker itself,
from a `{@const}` in the snippet's init or from the copy's script, both of which run where the
call renders and hold nothing in the fragment. So Svelte writes around the render tag or the
component call exactly what it writes around the original, and the assembler reads the marker as
the `call`. The marker used to stand beside the stand-in as text, which held until a call stood
alone in an each: text first in the body is what `is_text_first` writes `<!---->` ahead of, and a
second node beside the call is what stops `is_standalone`, after which the call writes `<!---->`
after itself. Measured against Svelte's own recursion for the three spellings, a body opening with
text, a parameter default (`depth = 0`, taken where the argument is `undefined` as JavaScript
takes it), a second call from outside, and a call alone in an each. `pkgs/skeleton/src/walk.ts`,
`standIn` and `selfCall`; `marks()` in `sentinel.ts`.

**The three shapes that waited for a case are taken.** A recursive snippet whose parameter is a
pattern binds the names inside it, each reached from the argument the way a destructured
declaration is, and those names are the fragment's parameters; a default inside the pattern is
the runtime's per call, and the render, handed an empty object, is given `undefined` in its place.
The entry rendering itself through `<svelte:self>` is the fragment the way a child is, its props
the parameters and the payload's own paths what the first call binds them to. A cycle through a
second component -- `A` renders `B` renders `A` -- is read off the imports before the walk goes
in, `reachesItself`, so every component on the cycle is entered as a fragment and whichever of
them is met again while still on the stack is a call of the fragment it became. A pattern
defaulted whole, `({ a } = {})`, is the default wrapping the argument and the pattern taking that
apart, measured with the first call handed nothing. A rest is a parameter like the others, bound
per call to what the call wrote and the pattern did not name. A fragment whose component writes a
head is two fragments, a head half beside the body's, called from the head stream wherever the
body's is called; [refusals.md](refusals.md) has how the render is made to write its anchors.
Still refused, saying so: a head that reaches a fragment from a component inside its body.

## The anchors come from Svelte, not from us

Every anchor in a static chunk is Svelte's, and the compiler no longer works out where they go:
it renders the component with no data and splits the result. Reproducing that placement by hand
was tried first, cost four undocumented positional rules before the first real component, and was
still growing when it was replaced. See [pipeline.md](pipeline.md).

What survives here is the shape: a chunk is opaque, the runtime never inspects it, and no backend
emits an anchor of its own. That was the point of baking them in and it is unaffected by where
they now come from.

## The IR holds paths, and the program holds the expressions

**`test` and `path` are data paths. They are never expressions.** _Settled_: the expressions are
the program's ("A route is one program").

**Every backend has a JavaScript engine.** Rust serves with QuickJS, which is always in the
process, or with Node beside it; there is no Rust backend without an engine, and no route is ever
served by walking the IR alone ([roadmap.md](roadmap.md), "C: a Rust backend, CTR only, with
QuickJS"). This section used to say the opposite: that holding only paths let a backend serve a
component with no JavaScript engine, that a compiled backend chose whether to embed one from a
`cfg` flag, and that a manifest field `expressions` answered it. None of that was built, and it no
longer stands.

So the rule above is how the IR is, and its old reason is gone. What holds it in place now is that
the IR is the lowering's output and the program's input: a path names a derivation, and the
derivation is an expression the program writes once with its names resolved. Holding a path where
the author wrote an expression made every value a call out of a walk into the engine, one per
hole, and that was the request-time half's cost until the walk became the program.

`data.available` is legal. `price > 10` never reaches the IR: the compiler rewrites it into a
derived field and carries the expression separately, so what the IR tests is always a path and
what evaluates the predicate is the derivation, computed when the program first reads it. See
[pipeline.md](pipeline.md) for why, and [derivation.md](derivation.md) for what such an expression
is allowed to be a function of. Elements, enums and nullables are finite decisions and belong in
the protocol; predicates over open value spaces are not, which is the correction the second
article makes to the first.

Written as a field constraint rather than a convention because the failure mode is gradual: an
IR that accepts one comparison grows an expression evaluator, and an expression evaluator in the
runtime is a JavaScript runtime in the backend by another name. That is the thing being removed.

## Nothing this pass plants may reach the bytes

A stamp names a block for the assembler and a sentinel stands for a value. Both are written into
the render and both are meant to be consumed by reading them back out of it; either one left in a
static run means a block was not recognised where the render put it, and the artifact would write
the marker itself into a response.

It is checked at the end of assembly, over the body, the head and the title. Found on a component
rendering itself whose body is one `{#each}`: the bare block the walk wraps a fragment's body in
and the each end at the same place, so their stamps landed together and only the first was read.

That one is fixed, and the fix is about order rather than about stamps. `apply` writes back to
front, so among edits beginning at one offset the one pushed **first** ends up rightmost. The
wrapper's close is written after the body is walked, so it was pushed last and landed to the left
of the block's stamp -- `%%b0%%%%b1%%` where `%%b1%%%%b0%%` is what the two mean. It is merged into
the edit already at that offset now, which is the one place that says what order they belong in.

The check stays, because it is the guard rather than the bug: what it does not do is tell the two
causes apart.

## Scope

`each` binds `item` for the extent of its body, and `index` beside it rather than through it,
which is what the `for` loop Svelte compiles to does with its own variable. Path resolution walks
a scope stack: entering an `each` pushes the bindings, leaving it pops. In the program the stack is
the program's own nesting: an item is a `const` of the loop that binds it, and a name is the
innermost one in scope.

Chosen over v1's `$.` prefix convention because prefixes collide under nesting -- two nested
`each` blocks have no way to say which `$` they mean, while named bindings shadow in the ordinary
way.

## One IR per component

_Superseded by "A route is one program", above: the build writes one IR and one program per route,
the components composed into it at compile time. What follows is the first plan._

**The unit is the component, and page IR is composed from component IR.** A page-level flat tree
would be simpler today and impossible to fix later, because CTR's unit is the static component
graph rather than the file.

It read Svelte as wrapping every component render in `<!--[-->` and `<!--]-->`, so that the
composition seam and the output seam were the same place. A static call writes nothing around
itself; only a dynamic one does ([refusals.md](refusals.md), "`block_open` is written in five
places").

## The head is a second stream

`render()` returns a head as well as a body, so the IR carries both. Reading only the body is how
a `<title>` came to compile without complaint and then not exist -- present after hydration,
absent from the response, which is the failure this whole approach exists to avoid.

A head is assembled the way the body is, from the same string-splitting pass, and nothing about
the node kinds changed to allow it. The hole check does not reach this case on its own: a head
holding no expression produces no sentinel, so every count stays correct while the bytes go
missing. Reading the stream is what makes its content reachable at all.

The shape was measured rather than argued:

```
HEAD  <!--167snak--><!--[0--><meta name="a" content="%%s1%%"/><!--]--><!---->
      <!--eo1t1a--><meta name="child" content="c"/><!----><title>%%s0%%</title>
BODY  <!--[--><div>%%s2%%</div><b>child</b><!----><!--]-->
```

- Sentinels reach the head, and a sentinel carries its own index, so **holes need no positional
  correlation** and cross a stream boundary for free.
- Blocks render there with the same anchors as anywhere else.
- **A child's head is already merged into the parent's stream**, carrying its own hash anchor.
  The aggregation other frameworks moved out of the component tree is done here at compile time,
  by Svelte, because the component graph is static. Two `<svelte:head>` blocks in one component
  are a compile error, so there is no ordering left to invent.
- The hash is `hash(filename)` and not a hash of the source, so the sentinel rewrite does not move
  it. It does depend on the filename string, which is the same coupling the scoped style class
  has, and the same requirement: one filename, spelled identically wherever the component is
  compiled.

## The title is a channel, not markup

It reads as an element and behaves as nothing of the sort. Svelte keeps it out of both streams:

```js
// internal/server/renderer.js, #close_render
let head = content.head + renderer.global.get_title();
for (const { hash, code } of renderer.global.css) {
	head += `<style id="${hash}">${code}</style>`;
}
```

**Three parts, and the third is `styles`.** `css: 'injected'` puts a component's stylesheet in the
head, and that line appends one after the title. They are constant bytes -- the hash and the code
come out of the compile -- and they sit after both of the others, so they are a stream of their own
rather than part of either. The head the program writes is the blocks, then the title, then these.
The split is on `<style id="svelte-`, the id Svelte writes, rather than on `<style` alone: an
author may put a `<style>` in a `<svelte:head>` of their own, and where a component has no title
the two would otherwise be indistinguishable.

`head()` writes `<!--hash-->`, its content, then an empty comment. Every head block ends that way,
and the title is appended after all of them, so **the last empty comment is where the head ends
and the title begins**. That split is Svelte's own line rather than a position worked out here,
and what follows it is checked to be a whole `<title>` so that a release appending something else
fails rather than being misread.

The client agrees, and more strongly. It compiles a title to `document.title = value` in an
effect, with **no DOM node and no hydration**, so the title's bytes are outside the ABI entirely.
That is why `{#if a}<title>T</title>{/if}` renders as an empty block with the title outside it:
neither side treats it as content.

**Which title wins is Svelte's rule, and it is derivable.** An earlier draft here said it was not,
and refused a title inside a block and more than one title on a page. Read rather than measured,
`set_title(value, path)` in `internal/server/renderer.js` keeps the title whose render path
compares later -- lexicographically, a longer path winning on an equal prefix -- where a path is
the chain of `#out` indexes from the root renderer down to the one the title was set on. Two
facts of the transform decide what that means in practice. `SvelteHead.js` pushes `$.head` into
the template, and `clean_nodes` hoists a `<svelte:head>` ahead of everything else in its fragment,
so a component's head block runs before any child component it calls and gets a smaller index
than any of them. And `TitleElement.js` pushes `$$renderer.title` into the _init_ of the block it
sits in, so a title at the top level of a head block runs before one inside an `{#if}` there, and
every title in one head block shares that block's path. Together: **the last head block executed
wins, and inside it the first title executed** -- a child's title beats its parent's whichever
order they are written in, a later sibling beats an earlier one, the last iteration of an each
beats the rest, and within one block a top-level title beats a nested one and an earlier one beats
a later one of its kind. Measured against Svelte for each of those.

So the walk leaves the title where Svelte executed it. In the render, `<title>` becomes a
stand-in element, `<seam-title-top>` or `<seam-title-nested>` by where it sits in its head block,
and every head block holding one opens with `<seam-title-open>`, so the title's bytes stay in the
head stream inside whatever block they were written in and the assembler reads them as a `title`
node with that role. The injector walks the head, counts a head block at each `open`, and keeps a
candidate when its block is later than the winner's, or the same block and top-level where the
winner was nested; what it keeps is appended after the head, wrapped as `<title>`, where Svelte
appends its own. The client compiles a title to `document.title = value` in an effect, with no DOM
node and no hydration, so nothing about the stand-in reaches it.

The `title` field beside `body` and `head` stays for the one case the render still decides: a
title written by a component the walk did not enter goes through Svelte's channel and comes out
after the head, and it is the winner as Svelte decided it over everything in that render.

**A body block a head sits inside stands in the head stream too.** `$.head` runs where the
component does, so a headed component inside an `{#if}` writes its head block on the branch that
holds it and none on the others, and one inside an `{#each}` writes one per item -- and the head
Svelte returns is a flat run of head blocks with nothing around the ones a block produced. So the
head IR carries the same `if` or `each` the body does, with the child's head block as its body,
and the runtime decides and repeats it there as it does below. How the render is made to write
anchors for it without touching the body's bytes is in [refusals.md](refusals.md). A head inside
an `{#await}` or inside a recursive fragment stands in the head now; [readings.md](readings.md)
has both, under "Ready, and not done".

## What is not in it

|                                    | Where it goes instead                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS                                | **Undecided.** The rule that was here is wrong; see below.                                                                                                    |
| Client behaviour, events, `$state` | Svelte's own client bundle already carries it.                                                                                                                |
| The document head                  | Nothing: it is in the IR, as a second sequence of nodes. See above.                                                                                           |
| Scalar types                       | Declared where the payload is produced. The IR enumerates paths, which is what a page requires rather than what its values are. See [payload.md](payload.md). |
| The element tree                   | Nowhere. Nothing needs it.                                                                                                                                    |

**The CSS row used to say that the artifact is separate and its consumer is the bundler rather
than the server. That is not true and it is left here as a question rather than an answer**,
because a wrong rule is worse than a missing one. A component carrying a `<style>` puts a scoped
class **into the bytes the IR holds**:

```
<div class="card %%s0%% svelte-1w6kyzv"><span class="svelte-1w6kyzv">%%s1%%</span></div>
```

Two things follow. The class lands on elements that had no `class` attribute at all, so it
interacts with the rule about when an attribute disappears. And the hash is taken over the
filename, so the compiler and the bundler have to spell one identically -- the same coupling the
head block's hash has. Injected styles are appended to the head stream as well, which is what the
check after the last head block is really watching for.

So CSS is not in the IR today and something about it is, and which of the two that is depends on
deciding who owns it. Recorded in the list below.

Client behaviour is the measured case. A component with `$state` and an `onclick` handler
compiles to **the same SSR bytes** as one without, so it cannot belong in an artifact the server
reads. Adding the handler to the conformance component changed none of the five expected
outputs, which is the proof rather than the claim.

The draft in the article bundled these into one `ComponentIR` struct. They are grouped by having
come from one compilation, not by having one consumer, and there are four consumers between them.
The server should have to understand one artifact, and this is that artifact.

## Open

Recorded rather than decided, because guessing now would be worse than deciding later.

- **Who owns CSS.** Decided in [build.md](build.md), and no longer blocking the row above. The
  scoped class stays in the response bytes and the stylesheet is the client build's, which is not
  the clean split the table used to claim but is a split. Two things had to be settled first and
  both now are: what happens to a component the compiler refuses, in
  [refusals.md](refusals.md), and how a hashed asset reaches the document, which is a string the
  compiler writes into the manifest. The hash is taken over a filename Svelte makes relative to
  `rootDir`, whose default is the working directory, so **both halves of the build pass the project
  root** -- three directories otherwise give three different classes for one file. It is no longer refused: the plugin
  runs the client build that emits the stylesheet, and a check holds the class in the bytes against
  the class in that stylesheet, since neither half can be wrong alone. It used to compile without
  either: the class went into the bytes, the stylesheet reached no artifact, and the page rendered
  unstyled with an exit status of zero.
- **`translate={true}`.** _Settled._ Svelte maps it through a table of value replacements, and
  the injector carries that table: `true` is written `"yes"` and `false` `"no"`, because
  `translate="false"` would mean yes. It used to be refused when the value was not plain text,
  waiting on a second entry to make the table worth carrying; the table is two lines, and a
  refusal was the more expensive of the two. See [refusals.md](refusals.md).
- **`class:` and `style:` directives.** _Settled._ Both are decision positions over outcomes, and
  both are enumerated: `class:` over which names are present, `style:` over which declarations
  are, with the value written inside the outcome. The way an element is found in a render, which
  this entry called the cost, is a marker riding in an attribute of its own, written last, that the
  decision owns. Nothing of `to_class` or `to_style` is reproduced: each outcome's bytes are
  Svelte's own. See [refusals.md](refusals.md).
- **Empty values.** `{data.name}` with an empty string produced `<h1></h1>` in Svelte's SSR, with
  no text node. Whether hydration requires one to exist is not yet known, and it decides whether a
  `slot` must always emit something.
- **Per-item derivation.** _Settled_ in [derivation.md](derivation.md): a derivation reading a
  name an each block binds is called per item, at the point of use, rather than once per request.
- **Snippets and children.** _Settled._ The walk descends into a child and carries the markup it
  was given, so a component with a body is entered rather than refused, and a `{@render}` of a
  snippet declared beside it is inlined. What stays refused is in [refusals.md](refusals.md): a
  render of a snippet that arrived as a prop, and a passed snippet that reads a parameter as a
  value where the component writes it.
- **Which title wins across a route and its layout.** Within a page it is Svelte's rule, derived
  ("Which title wins is Svelte's rule, and it is derivable", above); across a route and its layout
  it is the same question one level up, and depends on routing.
- **A linear form.** A flat opcode buffer walks faster and deserializes cheaper than a nested
  tree. The tree comes first because it can be written by hand, which the first milestone needs.
  Any linear form must be a lowering of it, not a replacement.

## One bundle a route, where one a build would do

The code a route's expressions call is bundled per route. Measured on press: seven bundles, 2.0 MB
between them, and six of the seven share more than seven thousand nine hundred lines -- the same
message tables, the same helpers -- while the largest wholly contains one of the others. A bundle a
build rather than a bundle a route would be most of that back.

**This is recorded rather than designed.** What a bundle holds is decided by what the expressions
of that route read, and one bundle for every route means naming every route's imports at once,
which is a different question from the one `carriedBy` answers today. Whether the artifacts should
then name a bundle they share, or whether a build should emit one file every route loads, is the
same deployment question the rest of this file defers: it is a change to what a backend reads, and
it waits on nothing else being decided. See [build.md](build.md).
