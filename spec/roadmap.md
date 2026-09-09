# What is left, and what each item waits on

**Two different boundaries run through this specification and they are not the same boundary.**
The first decides whether a thing is in scope at all; the second decides which half of the work it
belongs to. Both have been called "the line", which is why they are named here and referred to by
name everywhere else.

## The scope line: what compile-time rendering is for

The line that decides what belongs here is one sentence. **Before hydration the page is an MPA
and has to be what SvelteKit's SSR would have served; after hydration it is a standard Svelte SPA
and there is nothing to decide.** CTR differs from SSR in one thing only: the UI is rendered at
compile time rather than per request. What is given up is SSR's ability to run the UI per request
-- a component whose bytes can only be known by executing its script against the request. Every
other way of writing Svelte is in scope, and a construct is refused only for as long as nobody has
written it, never because it is the wrong way to write Svelte. [refusals.md](refusals.md) says what
a refusal means; this file says what is still refused and why each is where it is.

## The layer line: protocol, and the framework around it

Nothing here is the framework layer. Routing, the layout chain, the load stage and where request
context sits are the meta-framework's, and this protocol is not yet the equivalent of SvelteKit;
[framework.md](framework.md) is where that layer is taken from Kit. What is listed under
**blocked** is blocked on that, and nothing else.

The two are independent, which is the reason for naming them apart. A construct can be in scope by
the scope line and still not be this protocol's by the layer line: the load stage is exactly that,
kept whole and Kit's. So "not here" and "not at all" are different answers, and an item's section
below says which one it got.

Every item below was read out of Svelte 5.57's source before it was written down, and the file
that decides it is named. That is the order of work for each: read the transform and the runtime,
form the rule, measure it with Node against Svelte's own output, then write ours, then the check
that holds the two together. See the workspace's `spec/agent-protocol.md`.

## Where this file sits

This is the list of what is left, ranked. The order the work is *proved* in is
[conformance.md](conformance.md): Svelte's own samples, then SvelteKit's own test apps, then an
application written for Kit and moved. Everything below belongs to the first of those.

## Wrong bytes, which is not a refusal and outranks everything below

A refusal stops a build and names a file. What follows here compiled and wrote bytes that are not
Svelte's, which nothing said. [suite.md](suite.md) has the measurement and
[conformance.md](conformance.md) why this ordering is not the obvious one. There were 115; the
first entry below took it to 42 and the anchor row to 39, and all of them are read out here rather
than counted -- the suite prints the first byte the two renders disagree on, which is what made
reading them a morning instead of a project.

**One is left**, and it is not a construct: `runtime-runes/props-equality` reads a declaration
inside a larger expression, so the array literal is built again per read and `items.includes(item)`
is false where Svelte's own render, which evaluates the declaration once, says true. It is the
identity half of the entry under Open below -- holding a declaration rather than substituting it --
and one derivation per expression, which landed with it, closes the half where the read is the
whole expression and not this one.

**A default on the entry's own props was dropped: done.** It was 78 of the 115. The default now
stands over the payload's key as one derivation computed before anything reads it, which is what
`$props()` destructuring does and what keeps a read of the prop the path it was. Rewriting each
read instead was written first and is what `Skeleton.defaults` records against: it is equally
correct and turned every read of every defaulted prop into a derivation of its own, which on Kit's
generated root -- `data_0 = null` per level -- is every read on every page.

Three samples moved from writing the wrong bytes to being refused, all of them a default that
reads a store: that is the store gap under **ready**, met one step earlier than usual, and the
message it gives is the derivation evaluator's rather than a refusal naming a file. One moved the
other way, `component-binding-parent-supercedes-child-c`, and it is counted below.

### Shared mutable state a function reaches: refused now, and not yet held

Found by probe rather than by the suite, and it was the worst shape there is: it compiled, nothing
was refused, and the bytes were wrong. It is a refusal now, which is where it stops being ranked
under wrong bytes and starts being ranked as a gap -- what is still missing is holding it.

```svelte
const log = [];
function next(x) { log.push(x); return x; }
{#each rows as row}<p>{next(row)}|{log.length}</p>{/each}
```

`log` is a declaration, so every read of it is substituted by its initialiser -- `([]).length` --
and a fresh empty array is what each read evaluates. Svelte's server evaluates the declaration
once and the function mutates that one array. Ours wrote `1|0`, `2|0` where Svelte wrote `1|1`,
`2|2`.

The rule that let it through read the wrong place. A name assigned after being declared, or an object
mutated after being declared, is refused where those statements are the script's own; a mutation
inside a function body reached from markup is neither, and there is no sample in Svelte's corpus
that writes one. **Substituting a name by its initialiser is only sound where the value is not
shared**, and "shared" has to mean reachable from anything the markup calls, not visible at the
top level. [derivation.md](derivation.md) has the rule that closes it and the two halves that keep
it off the ordinary component.

**Holding it, rather than refusing it, is the open half.** A name whose value is shared has to be
bound once per request rather than written out per read, which the derivation machinery could do --
a derivation is already evaluated once and cached. That is a change to what substitution is.

### A recursive component whose body is one block: done

The walk wraps a recursive component's body in a bare `{#if true}` so the fragment has anchors to
be found by, and each block is followed by a stamp naming it. Where the body is a single block --
`{#each}` filling the whole of it -- the wrapper and the block end at the same place and their
stamps landed together, the assembler reading only the first. Three of Svelte's samples were this,
and the guard above caught it as a marker left in the bytes rather than as bytes shipped.

Neither of the two fixes guessed at here was the one. It was about **order**: `apply` writes back
to front, so among edits beginning at one offset the one pushed first ends up rightmost, and the
wrapper's close is written after the body is walked. It is merged into the edit already at that
offset now, which is the one place that says which of the two closes first. See [ir.md](ir.md).

### The render's module instances are not the artifact's

Found by probe, and it wrote the wrong bytes silently. An expression the walk judges inert goes
back to the render, which imports each module afresh; a derivation evaluates in the carried bundle,
which imported it once. A module holding no state makes the two the same and that is what the whole
inert path rests on. A module holding state makes them two.

It is refused now for a **relative** module, whose source can be read, and only for the bindings
something in that module changes. **A package's module is the hole.** `paraglide`'s language tag, a
store created at module scope, a client cached in a module -- each is state the render has a second
copy of, and reading one where the value has to reach the bytes is the same fault. Reading a
package's source to find out is what closes it, and `carry` already resolves the file.

### Context carries a value the walk does not follow

Found by probe, and it wrote the wrong bytes with nothing to say so:

```svelte
setContext('k', { v });          <!-- v is a prop -->
...
const held = getContext('k');    <!-- in a child -->
<b>{held.v}</b>
```

Neither `getContext` nor the key is a name the request decides, so the read looked inert and was
handed to the render -- which holds the literal standing in for `v`. It rendered empty where Svelte
wrote the value. It is refused now, at the reader, and only where something in the same walk set a
context from a value the request decides; a context set from constants is the ordinary way a
package's component talks to its children and still works.

**Following it is the work.** The setter's argument is an expression in the setter's scope and the
reader wants exactly that, which is the substitution a prop already gets -- one `setContext` per
key in scope makes it exact, and more than one is a decision. It is the one channel between
components the walk does not follow, and every component library uses it.

### The 42 that remain, by cause

| | | |
| --- | --- | --- |
| 4 | **a component `bind:` the server writes back** | Half done: the caller no longer keeps the first pass silently. See below. |
| 1 | ~~a later attribute has to beat a spread's, and `value` has to reach a child's `<option>`~~ | Four of the five were three different things. See below. |
| 6 | **a name that holds client state is read as though the server had it** | `$state` mutated by an effect or a callback, a reactive block that runs again, an each key compared by identity. The server writes the value before any of that, and these say we write a different one. Each needs reading on its own; they are one group only in that none is markup. |
| ~~3~~ | ~~**entry props the walk cannot name**~~ | Two refused, one fixed. The payload's keys are the props rather than the names the entry destructured them into, which is a substitution; a name that is not an identifier and a rest are refused, since neither can be written as an expression. |
| ~~2~~ | ~~**a quoted attribute holding one expression is passed as text**~~ | Done, and it was the other half of `build_attribute_value` that was missing: several chunks are a template, and having no second shape made one mixed value keep the walk out of the whole component. |
| ~~2~~ | ~~**`{#each}` over a string**~~ | Done. `ensure_array_like` asks the value for a `length` and hands back the value itself where it has one; the loop then reads `array[i]`, so a string iterates its characters and so does any array-like. Ours asked whether the source was an object first. Read by index rather than through `Array.from`, because an astral character has a `length` of two and the loop sees both halves. |
| ~~2~~ | ~~**`style:` in its shorthand form**~~ | Done. `build_attr_style` writes `b.id(directive.name)` where a written value would have been built, so `style:color` is the variable `color`; the name is read from just past `style:` in the source. |
| ~~2~~ | ~~**a doubled space after a block**~~ | Done, and the case it was short of is an `{expression}`: `clean_nodes` asks `next?.type !== 'ExpressionTag'` before collapsing a text node's trailing whitespace, so an expression tag holds it as written where a block or an element collapses it to one space. |
| 2 | **a default with a side effect is evaluated a different number of times** | a snippet parameter default that increments a counter, a child's defaults evaluated lazily. The value is right and the count of evaluations is not, which the bytes show because the counter is rendered. |
| 2 | **Svelte writes a snippet that was never rendered** | `snippet-children-without-render-tag`: children given with no `{@render}` reach the output as the function's own source. Whether that is worth reproducing is a question rather than a gap. |
| ~~3~~ | ~~**the wrong branch, or a missing anchor**~~ | Done, and it was two faults rather than one. See below. |
| 1 | **a namespaced component** | `<Components.Foo />` gets a block anchor pair Svelte does not write. |
| ~~1~~ | ~~**attribute order beside a directive**~~ | Done, and the rule is in `2-analyze/index.js` rather than the transform: an element carrying a directive and no attribute of that name has one appended to `node.attributes`, class first, then style. |
| ~~1~~ | ~~**a prop default a global shadows**~~ | Done, and the guard was the wrong question. `$props()` destructures, so the default is taken where the payload's property is `undefined`; asking `typeof Math === 'undefined'` asks what the name resolves to, and `with` falls through to the global. The expression is the default alone now and the test is on the property. |
| 2 | **two of their own** | an `<option disabled>` on the wrong item, and a `--css-var` custom property that is not written. |

**The three anchor cases were read first** even though they were not the largest group. Every
other row is a construct the compiler does not handle; those three were the compiler handling one
and getting it wrong, which is the failure this whole arrangement exists to catch. They were two
faults:

**Two were a marker standing where a value decides.** `{#if visible}` inside a component the walk
could not enter -- `<slot>` stopped it -- with `visible` handed in as a marker. Every marker is a
non-empty string, so the branch was taken and the whole component came back as static bytes with
no block and no hole. What let that through was `dead()`, whose probe put a second marker in the
value's place and asked whether the bytes changed: that asks whether the component *writes* the
value and cannot ask whether it *decides* on it, two non-empty strings being the same truth. The
probe now also puts the empty string there, which differs in truthiness, in length and as a
number. Both are refused now, and a third sample that had been passing --
`component-yield-nested-if` -- was a false pass the same probe had been relaxing.

**One was `<svelte:self>`, which Svelte anchors unlike a component.** `is_standalone` in
`3-transform/utils.js` wants the fragment's one trimmed node to be a `Component`, and
`<svelte:self>` is a `SvelteSelf`, so it never qualifies and always gets the `<!---->` that
`shared/component.js` pushes after a component. The stand-in the walk writes is a component tag,
so it qualified and the anchor went missing, once per level of a recursion. The stand-in writes it
itself now, where the fragment is one Svelte reads the flag for -- which is every block's, and not
an element's or a `<title>`'s, because `RegularElement.js` and `TitleElement.js` take `trimmed` off
`clean_nodes` and call `process_children` without going through `Fragment.js` at all.

### A component `bind:` is expressible, and here is the reading that says so

Two guesses were made about this before the source was read to the bottom, and both were measured
and wrong. What follows is what `bind_props`, `transform-server.js` and three probes actually say.

**What fires.** `bind_props(props_parent, props_now)` assigns up only where the caller's value is
`undefined`, the child's is not, and the caller's props object has a setter for the key. The
assignment is monotone: `undefined` becomes a value and never goes back, so the loop settles.

**What is in `props_now`.** `transform-server.js` builds it from the child's `bindable_prop`
bindings and its `analysis.exports`, and nothing else. In legacy mode every `export let` is
bindable; in runes mode only a `$bindable()` is, and Svelte's own comment beside the call says the
rest have "no effect in runes mode other than throwing an error". **A `bind:` on a runes prop with
a plain default sends nothing back at all**, which was refused here and is not refused any more.

**What re-renders.** Only `template.body` is wrapped in the `do { ... } while (!$$settled)`; the
instance script sits above it and runs once. Measured: `let x; const y = 'y:' + x;` beside
`<Child bind:x/>` renders `before=42 after=42 y=y:undefined`. So the settled value belongs to the
**template's** reads of the name, and every declaration computed from it keeps the value it had
before the child sent anything.

**So it is a value, not a structure and not a second render.** For the template's reads, the
settled name is

```
expr === undefined ? <what the child sends> : expr
```

one ternary per bound prop, chaining where one binding decides whether another component renders.
A ternary is a value, and a value the request decides is what a marker already stands for; where
the name goes on to decide a branch, the choice machinery takes it from there as it does for any
request-decided value. Nothing here needs the UI run per request, which is the only thing the scope
line gives up.

**Both halves of that are built.** The settled name is a channel of its own, `sent`, read where the
expression itself reads the name and never inside a declaration this pass expands on the way, so a
`const y = 'y:' + x` keeps `y:undefined` exactly as Svelte does. And because the walk meets the tag
half way through a template Svelte re-renders whole, the pass that finds a binding does not use it:
it records what the binding settles and the walk runs again told, the way it already runs again
told what the render answered.

**What stays refused is a binding written inside a block.** Which child sends back is then the
block's answer rather than the file's -- `{#if a}<Foo bind:x/>{:else}<Bar bind:x/>{/if}` settles
`x` to one default or the other, and the read outside the block sees whichever branch ran. One
ternary per file cannot say that; the block's test would have to be inside the ternary, which is
the next step and not this one. Written as the file's answer it is bytes rather than a refusal,
measured on two samples.

**Neither of the guesses, recorded so they are not made again.** Leaving the component to Svelte
does not work: the render settles correctly, but the caller's name is substituted from the walk's
own model rather than read back out of those bytes, and two samples wrote nothing where Svelte
wrote `42`. Enumerating two structures works and is more than is needed, since the fixed point has
a closed form.

### The mechanism, read rather than inferred

The largest of the rows above, and the mechanism is Svelte's, read rather than inferred:

1. Any `bind:x` on a component, `x` not `this`, sets `analysis.uses_component_bindings` on the
   **parent** (`2-analyze/visitors/shared/component.js`).
2. That wraps the parent's whole template in `do { $$settled = true; ... } while (!$$settled)`,
   with `$$renderer.subsume` taking the last pass (`transform-server.js`).
3. The binding becomes `get x() { ... }` and `set x($$value) { expr = $$value; $$settled = false }`
   in the child's props, both pushed last so a spread cannot overwrite them
   (`3-transform/server/visitors/shared/component.js`).
4. The child ends its render with `$.bind_props($$props, { ...its bindable props })`, and
   `bind_props` in `internal/server` assigns each back **where the parent passed `undefined` and
   the parent's props object has a setter for that key**. So a child's default flows up into the
   parent, and the parent renders again with it.
5. Which props are in that object is `binding.kind === 'bindable_prop'`: in legacy mode every
   `export let`, in runes mode only a `$bindable()` one.

**Step 5 is where this compiler lost it, and it was our own rewrite.** `runed()` turns
`export let x = 1` into `let { x = 1 } = $props()`, which is a plain prop, so the child compiled to
no `$.bind_props` call at all and the propagation disappeared. It now writes
`let { x = $bindable(1) } = $props()`, which produces the same call Svelte's own output has --
with a default, without one, and for several props at once. There is a check that asks Svelte for
both and compares.

That alone changed nothing and the suite said so -- 1125 identical before and after -- because the
setter it needs never existed: `unbind.ts` rewrote the parent's `bind:x={e}` to `x={e}` on the
strength of a claim reading "only the getter runs while the bytes are written", which
`transform-server.js` shows is false. **That claim is gone.** A component's binding is left as
written, `descend()` reads both halves of it, and the caller's tag is written out as the plain
attribute once the child has been read -- which is where the setter turns out not to be needed.

**What decides it is the child's declaration, and it is readable.** `bind_props` skips a value that
is `undefined`, and a prop the child assigns after declaring is refused where it is declared, so
**only a default can travel**:

- The child's bound prop has **no default**: nothing can come back, and the binding is its getter,
  which is a value. Compiles, and there is a case for it.
- The child's bound prop **has one**: refused. Whether it travels is `initial_value === undefined`,
  which is the request's answer wherever the caller binds one of its own props -- `<Foo bind:x/>`
  in a component whose `x` is a prop writes the child's default for a request that sent nothing and
  the request's value for one that did. Two structures, not a value a marker can stand for.
- A child the walk **could not enter** is one whose declarations it has not read, so nothing is
  refused there and the binding is written as the plain attribute it always was. Both answers are
  in the corpus -- `component-binding-private-state` binds a child whose `x` is a local rather than
  a prop and `dynamic-component-bindings-recreated` one whose prop has no default, so neither sends
  anything back; `parent-supercedes-child-c` binds one that does, and is still wrong.

The refusal is thrown past `descend`'s catch, which otherwise turns a refusal into "left to the
render" -- and left to the render is exactly the wrong first pass this is about.

Four samples left, and they are the two halves not built: reading a child through a
`<svelte:component>`, and the caller that binds a **local**, where whether it is `undefined` is
known at compile time and the fixed point is a compile-time render rather than a refusal.

### The select row was three things, and only one of them was about `<select>`

`renderer.select` in `internal/server/renderer.js` destructures `{ value, defaultValue }` off the
**merged** attributes, writes neither, and sets `select_value = value === undefined ? defaultValue
: value` on a child renderer scope, which every `<option>` under it reads -- including one a
component renders, since the scope is the renderer's rather than the markup's.

**Three were a spread on the `<select>`, and are refused.** Taking `value` and `defaultValue` off
the tag is what stops Svelte doing the comparison a second time, and a spread's copy cannot be
taken off without rewriting the object it sits in. Half-removed, both comparisons ran:
`<select {...{ defaultValue: 'b' }} defaultValue="a">` marked option `a` from the attribute and
option `b` from what was left in the spread. Merging the spread's keys in attribute order and
rewriting the object is the work; refusing is where it stands.

**One was `bind:` after all** -- `bind-and-spread-precedence` -- and half of it is done: a
binding's prop is pushed last now, as `push_prop(..., true)` does. What is left is inside the
child, which takes a rest and spreads it onto an element.

**One is not a `<select>` problem.** `select-value-component` puts its `<option>` in a component
whose script is `let props = $props()` -- an identifier rather than a pattern, which `propsOf`
cannot read -- and whose body is `{@render props.children?.()}`. It is blocked behind a render of
a snippet that arrived as a prop, which is its own row in [refusals.md](refusals.md).

### The legacy rewrite changes the file's mode, and that is the largest item left

`runed()` turns `export let` into `let { ... } = $props()` so every pass below it knows one shape
of prop. `$props()` puts the file in **runes mode**, and `analysis.runes` is not a detail about
props -- it is a flag the rest of the compiler reads. Three divergences measured, one class:

- **63 refusals are Svelte's own errors**, raised against a file the author wrote as valid legacy
  Svelte: `beforeUpdate` and `afterUpdate` are refused in runes mode, `$:` is not allowed, a store
  read is `$state is not defined`, `bind:value={entry}` on an each argument is rejected outright.
  None of these is a construct this compiler turned away; every one is a mode it imposed.
- **A namespaced component gains anchors.** `2-analyze/visitors/Component.js` sets
  `metadata.dynamic = analysis.runes && ...`, so `<Components.Foo />` is dynamic in runes mode and
  not in legacy, and the server writes `<!--[-->` and `<!--]-->` around a dynamic one. Measured
  both ways on the same tag.
- **`legacy.ts` says the rewrite is byte for byte**, and it is -- for the props. The claim was
  measured against `$props()` with the same defaults and holds; what it does not cover is
  everything else `analysis.runes` decides.

**The fix is that the walk reads `export let` rather than rewriting it away**, leaving the render
Svelte's own render of the author's component. Removing `runed()` with nothing in its place takes
the corpus from 20 differences to 208, because `propsOf` cannot read `export let` at all and every
legacy entry loses its payload; the work is `propsOf` and `locals` learning the spelling.

**Done, and `runed()` is gone.** `propsOf` reads `export let` and both export-list spellings --
`export { a }` and `export { a as b }`, whose exported name is the prop and whose local is what the
markup uses, the default being the local's own initialiser wherever it was declared. `locals` is
told which names those are so it leaves them free instead of substituting their initialisers, by
name rather than by statement, since `let a, b; export { a }` declares one of each. Every
component now keeps the mode its author wrote, and `component-namespaced` is right.

**The export forms are props in legacy mode only.** In runes mode `export let` is an error and
`export { a }` is a readonly export of whatever the name holds -- `export { count }` over a
`let count = $state(0)` is exactly that -- so `propsOf` asks first whether anything in the scripts
references a rune, which is how `2-analyze/index.js` decides. Taking that for a prop substituted
`$state(0)` into the markup and Svelte refused the result.

**Taking the rewrite off children looked like a loss and was a bug of ours.** It measured 1155
identical against 1163, which read as a reason not to do it; the cause was `exportedBy` reporting
every `ExportNamedDeclaration` as a readonly export, so a child's plain `export let` prop was one
and every `bind:` to it was refused. Only `const`, `function` and `class` are readonly. With that
fixed the same change is a gain.

## Newly refused, found by the same run

Constructs the walk had never met, each a gap. `DeclarationTag` -- `{const x = 0}` and
`{let x = $derived(...)}` -- is in Svelte's public AST union and was in neither the switch nor
`REFUSED`, so it reached the default arm. `css: 'injected'` puts the stylesheet in the head, which
the head assembly does not recognise as either a block or a stamp. `$state.eager` is a rune
nothing reads. And a `<svelte:boundary>` whose body throws is caught by Svelte and rendered as
`failed`; here the throw escapes the compile -- which is a decision where the throw depends on the
request and a gap where it does not, and the two have not been told apart yet.

## The gaps, sorted by who has to answer

The refusals are the ones taken by decision plus the gaps; [conformance.md](conformance.md) has the
arithmetic. Sorting the gaps by their message is misleading, and the way it misleads is worth
recording before the list: the largest message group used to be "a name the data does not carry",
and that is a symptom rather than a cause. It says only that the markup read a name nothing
recorded, and there are six unrelated reasons a name goes unrecorded. **A group has to be shown to
be single-cause before it is ranked by size.**

A message can also point away from us. Five samples were refused with Svelte's own error, that an
`animate:` element must be the only child of a keyed `{#each}`. Every one of them is Svelte's own
test, so Svelte cannot be failing it: the rewrite dropped the key, and Svelte then reported a
consequence rather than the cause. Where a message is upstream's and the sample is upstream's too,
the fault is in what was handed to it.

Sorted that way the gaps were **76 mechanical**, **68 waiting on a decision**, **15 where the
compile-time render threw and nobody has told the reasons apart**, and one refused correctly. Of
those fifteen, eight turned out to throw inside Svelte's own render too.

### The 76 that needed nobody: 59 done

Each was a construct whose answer is in Svelte's source and could be read forward, or a fault of
ours with a probe that shows it. Nineteen changes closed 59 of them, and what they were is recorded
where each rule lives -- [refusals.md](refusals.md), [derivation.md](derivation.md),
[ir.md](ir.md). Three findings outlived their own item:

- **Undoing a refusal uncovers what it was hiding.** Teaching `{@const}` its hoisting made one
  sample compile and write `1,2,3` where Svelte writes `3,6,9`, because a block was not a scope and
  a substitution reached past an inner `const` to the script's. Teaching a rest made another write
  `false` for `true`, because `Symbol()` was substituted at two reads and made two symbols. Neither
  was a new fault. **Every refusal removed needs the failing set diffed again, not only the total.**
- **The same half-condition tends to be written more than once.** `from.endsWith('.svelte')` stood
  for "this is a component" in three passes; a named import of a component is its `<script module>`,
  and only the default export is the component. Two of the three reported a name that resolves fine;
  the third let module state through unchecked, which one render cannot show.
- **"Cannot express it" and "should not express it" read the same in a comment.** A default in a
  pattern was left out because the template was raw source with nothing to expand names inside it.
  That was true, and it was a missing slot rather than a boundary.

**The 17 left are not one list.** Five are refusals that are now correct and want moving rather than
building: `process.env` is an environment, `Symbol()` does not read the same twice, two read a global
nothing binds, and one names a spread whose keys the request decides. The rest are
`{@const}` inside an element carrying `slot=`, a `<svelte:head>` a block holds in a component the
walk could not enter, four `deriving ... failed` that each surface a different gap with a message
naming no file, a rune shadowed by a parameter of the same name, a child binding `$props()` to a
name, and an `<option>` whose implicit value is a rendered snippet.

**A child binding `$props()` to a name was tried and reverted.** The entry's is the payload and is
done. A child's is the object its call site passed, and reading it as a rest with nothing named
beside it -- which is what it is -- cost two sets of bytes and a sample. It wants the object built
the way `merged()` builds a prop, and that is the shape it waits on.

### The 62 that wait on a decision

Each of these can be built. What none of them can be is built without answering a question that
outlives it, and the questions are not the same question.

**A component `bind:`, 16.** The mechanism is read out above and it is not in doubt. What is in
doubt is the IR: the parent's template becomes two passes with the last one subsuming the first,
and either the IR gains a node that says "take the last pass" or the shape stays refused. That is
a change to [ir.md](ir.md), not to a visitor.

**A snippet arriving as a value, 12.** A snippet rendered by a file that does not declare it: passed
as a prop, hoisted into a module script, held in a store, chosen from a nullish test. The walk
enumerates snippets by their declaration, and following one as a value means the payload carries
something callable. Whether it does is a question for [payload.md](payload.md), and it is asked
once for all twelve.

**A child's `$$props`, `$$restProps` and `$$slots`, 9.** The entry's are done -- the payload is
bound under `GIVEN` -- and a child's is the object its call site passed, which has to be folded out
of the attributes and the spreads at the tag the way a rest already is. This was tried once and the
fold was put at the wrong moment, before `order` and `bindings` were known, and reverted rather
than shipped. The decision is whether the fold belongs at the tag or whether a child gets a slice
of the payload of its own.

**A value handed to a component that did not come back, 7.** The probe writes a marker in the
value's place and asks whether the bytes carry it; these are the cases where it does not come back
and the walk cannot say why. Widening the probe and refusing are both defensible, and which one is
right depends on how much a false pass costs, which is the question `dead()` already answered once
in the other direction.

**A component chosen from a request value: decided, built, and out of this list.** The question
was what bounds the candidate set, and the payload answers it: a component is a function, the wire
is devalue, and devalue serialises data. **So the payload cannot carry a component**, and the only
value `this` can take that renders anything is the one the source already names. The set is
bounded to one candidate and nothing, which is an `{#if}` with an empty else, and Svelte's server
compiles the tag to exactly that. The tag stays and only `this` is a choice, because the anchors
here are `BLOCK_OPEN` and `BLOCK_OPEN_ELSE` rather than the numbered pair an `{#if}` writes.
[refusals.md](refusals.md) holds the rule and [derivation.md](derivation.md) the one thing a
component is worth to a derivation.

Three of the six write Svelte's bytes now: `await-in-dynamic-component`, whose `&&` makes the
truthy side exactly the import, and `dynamic-component-in-if` and `dynamic-component-nulled-out`,
whose candidate is the prop's default. The other three are decisions rather than gaps and are
counted in [conformance.md](conformance.md) as such. `await-with-update` and `await-with-update-2`
name no component in the source at all -- the one the page renders is the one the request sent,
which is the same reading that puts the `$store` samples below under decided, and the two have to
stay consistent. `dynamic-component-dirty` is a call that pushes into a prop array while the bytes
are written, which is the by-decision rule about a value the render changes; the message it wears
is the candidate one, since the compiler reads the call as a value the request decides rather than
as a mutation.

**What is given up is a page that cannot work either way.** A request that sends a truthy value
that is not a component renders nothing: Svelte calls it and throws, and there are no bytes to
reproduce, so the artifact renders the candidate.

**A store the request brings: decided, and moved.** The question was where it belongs, and the
answer is the scope line. `$x` reads whatever `x` holds while the bytes are written, so the store
itself would have to be in the payload; the wire is devalue, which serialises data, and a store is
an object with a `subscribe` function. A function is not data. Reading the value in the load stage
and putting *that* in the data is the same page, which is what the refusal already tells the author.
The six are counted under **decided** in [conformance.md](conformance.md) now, not as gaps.

**`createRawSnippet`, 5.** Abandoned, and recorded here so it is not derived again. Reproducing it
means standing in for Svelte's renderer contract -- a snippet that is handed a renderer and pushes
its own trimmed string -- and [refusals.md](refusals.md) says the two backends run Svelte's
implementation rather than agree on a rule. Reopening it is reopening that.

**A `<svelte:boundary>` whose `failed` body calls over a request value, 4.** The section above says
a boundary whose body throws is a decision where the throw depends on the request and a gap where
it does not, and that the two have not been told apart. These four are the request-dependent side,
and they are here rather than under **decided** because the telling apart has not been written
down.

**A module script that exports, 3.** `<script module>` exporting a name the template reads. It sits
against the item above about the render's module instances not being the artifact's, and the
decision is the same one: what a module-scope binding means when there are two module graphs.

### The 25 that remain, and what closed the rest

Of the twenty-five ranked as needing nobody, nineteen are green, one turned out to be a decision
rather than a gap, and five want one thing more. The rules that closed them are each written where
they live:

- **A test the source has already decided is folded before the walk goes into either branch**, and
  a name read only in the branch that is dropped is not a name the data has to carry. A chain is
  decided by its first not-false test, and its tests are asked one at a time in source order.
  [derivation.md](derivation.md).
- **A `{@render}`'s callee the request decides is the snippet the source names**, written `(0, x)`
  so the tag stays the dynamic one it was. [refusals.md](refusals.md).
- **Markup handed to a component hoists its `{@const}`s**, and a `let:` may take a pattern apart --
  spelled as an expression, which is how Svelte spells one. [refusals.md](refusals.md).
- **A `this` settled to nothing is bytes**: `build_inline_component` builds the props inside the
  `if`. [refusals.md](refusals.md).
- **The payload object is nameable**, so a rest in the entry's `$props()` and a prop whose name is
  not an identifier are both read off it. [derivation.md](derivation.md).
- **The end of the instance script is not the end of the instance body**, so a test the render
  answers is labelled `$:` where the script writes one; and a `$:` that reads the name it assigns
  reads `undefined`. [derivation.md](derivation.md).

**Four of the thirteen left were never mechanical.** `block-expression-member-access`,
`spread-component-side-effects`, `destructure-state-iterable` and `binding-input-group-each-8` each
change a value while the bytes are written -- through a getter, a spread, or a generator -- which
is the by-decision rule wearing the derivation evaluator's message. The rule asks whether the
changed name is read *by name* in the markup, and none of these is. [conformance.md](conformance.md)
counts them where they belong.

**Two of the four snippet cases are built and two are not.** A `{#snippet}` written **inside** a
component's tag is a group of the caller's now, its body what the component renders and its
parameters bound to the arguments the component calls it with. What is left is a snippet written at
the **top level** and handed over by name -- `<Kid {foo} />`. It is the same group, and the reading
is the same, but the declaration is still walked where it stands: which of the two paths it takes
depends on whether the child can be entered, and that is not known when the declaration is met.
`snippet-reactive-args` waits on the same thing, its `?:` between two of them.

**The last five each want one reading that is not yet done.** `const-tag-component` needs the
literal the render is handed for a prop it models to survive a member read. `bindings-before-onmount`
needs "the caller's markup never reads this name", which is a reachability question rather than a
mention. `select-value-implicit-value-complex` needs an `<option>`'s implicit value read off the
render rather than off the source. `await-mutate-array` and
`if-block-compound-outro-no-dependencies` both need a test folded where there is no payload to ask
against. And `globals-accessible-directly-process` is a decision after all: the rule that would let
a derivation read `process.env` is that a server's globals are the same at build and at request,
which is true of the *value* and not of when it is read -- an expression judged inert is handed to
the render, which bakes the build's environment.

### The 7 where the render threw, and what told the other eight apart

The compile-time render runs the instance script with nothing the request brings. Fifteen threw
while it did, and the question was which of them were the sample throwing on purpose and which were
neutralisation not reaching far enough. **Nothing in the list distinguished the two, so the count
was not evidence of anything** -- and what settled it was not reading them one at a time. It was
asking Svelte's own render the same question. Eight of the fifteen throw there too, so the throw is
the sample's rather than ours; [conformance.md](conformance.md) counts them apart now, and
[suite.md](suite.md) has the rule.

| sample | what escaped |
| --- | --- |
| `runtime-runes/error-recovery` | NonExistent is not defined |
| `runtime-runes/effect-order-6` | Cannot read properties of undefined, reading 'boolean' |
| `runtime-runes/effect-order-7` | Cannot read properties of undefined, reading 'boolean' |
| `runtime-legacy/await-mutate-array` | Promise.resolve(...).filter is not a function |
| `runtime-legacy/binding-indirect-fn` | Cannot read properties of undefined, reading 'filter' |
| `runtime-legacy/component-namespace` | LazyWidget.Tooltip is not a function |
| `runtime-legacy/context-api` | Cannot destructure 'registerTab' of `getContext(...)` |

**Three of the seven are one cause.** `error-recovery`, `effect-order-6` and `effect-order-7` each
put an expression inside a branch that nothing renders -- `{#if object}` over a `$state()` holding
`undefined`, and `object.boolean` inside it. The test is a constant once the walk has substituted
it, so the branch is dead and Svelte never evaluates what is in it; this walks every branch, which
is what makes a block re-materialisable per render, and evaluated it. Folding a test that is
already a literal is what closes them, and `await-mutate-array` is the same shape one construct
along: the `{#await}` writes its pending branch and the then branch's expressions were evaluated
against the promise.

`context-api` is context that a component sets and a descendant destructures, which the context
item above already owns. `component-namespace` is `<Components.Foo />` over a module script's
export, which is the module-graph item. `binding-indirect-fn` is a `$:` declaration substituted
into `items.filter(fn)` and is its own fault.

## Ready, and not done

**The walk enters a package's component.** Done; [refusals.md](refusals.md) has what it took --
resolution through `exports` under the `svelte` condition and the package's re-exports, a rest as
the caller's other attributes, a prop-reading declaration neutralised only where the prop varies,
an id as a marker the component computes with, an inert spread as bytes, modules left at their
real paths. On press every route is byte-identical with every component entered, `bits-ui` and
`@tanstack` included, and nothing left to the render. The one shape that would still have been
left to it -- a component spread with an object the request hands it whole -- is bound by what the
child declares, [refusals.md](refusals.md) has how. The residual risk noted in
[pipeline.md](pipeline.md) -- a marker outside a function's domain -- now applies only to a
component the walk could not enter for a reason it names.

**The title rule is done.** It is Svelte's own and it was derivable; [ir.md](ir.md) has it.

**A body block a head sits inside stands in the head stream: done.** A headed component inside an
`{#each}` used to be refused and one inside an `{#if}` used to compile wrong, its head block in
the head whichever branch the request took -- and the surface checks compared the body alone, so
nothing said so. Both streams are compared now, the block is mirrored into the head, and
[refusals.md](refusals.md) has how. An `{#await}` stands in the head too, opened around its
expression since its pending branch is the one place a `{@const}` cannot go. A recursive component
that writes a head stands in it as a fragment of its own, called per level. What stays refused is
a head that reaches a fragment from a component inside its body, found after the calls were
written; [refusals.md](refusals.md) has the shape it waits on.

**The small ones are done.** Thirteen constructs, each a mechanism that already existed used once
more, each read out of the visitor that writes it, measured with Node, written, checked and
committed on its own: an each pattern's default, a getter binding, a select's `defaultValue`, a
content binding with children, a boundary's snippets by attribute, extra render arguments, a
class expression beside a directive, directives and mixed text beside a spread, a spread on
`<svelte:element>`, `{@attach}`, a component chosen through a table, an each over a `Map` or a
`Set`, and `{@const}` shapes inside a parameterised snippet. Each is recorded where its rule is,
in [refusals.md](refusals.md) or [derivation.md](derivation.md).

**Recursion in structure is done.** A snippet or component that renders itself is a fragment the
runtime calls, with `call` nodes where it is entered; [ir.md](ir.md) has the node and how the body
gets its region. The three shapes that waited for a case are in: a pattern as a recursive
snippet's parameter, `<svelte:self>` in the entry, and a cycle through a second component. Taking
them found that a call standing alone in an each changed the bytes around it, and the stand-in
now writes its marker itself. A rest is a parameter bound per call, and a component's own head
has the fragment stand in the head stream; what stays refused is a head a component inside the
body writes.

**Close, not build.** [ir.md](ir.md) asks whether hydration needs an empty text node to exist
where a value is empty. The bytes are Svelte's own server bytes, byte for byte, and hydration is
Svelte's client against them. The question is Svelte's and is answered by the oracle.

**A prop written as `export let` is done.** Svelte 4's spelling, which Svelte 5 still compiles;
measured byte for byte against `$props()` with the same defaults, so the file is rewritten to
that before anything reads it (`runed()` in `legacy.ts`). `export const` and `export function`
are readonly exports and are refused by name.

**A store read in markup: done.** `$x` is a subscription to the store `x`, and it resolves exactly
where `x` does -- `2-analyze/index.js` declares a `store_sub` binding for a `$`-prefixed reference
that is not a rune and whose store is declared, and `build_getter` writes
`$.store_get($$store_subs ??= {}, '$x', x)`, which subscribes, takes the value and memoises it for
the render. Where the store is the component's own the read decides nothing per request, so it is
inert and the render evaluates Svelte's own call; 32 of the corpus's samples were waiting on that
and nothing else.

Two things had to go with it. `$x` is the only use an imported store may have, and the pass that
drops unused imports counted it as a use of `$x` rather than of `x`, so the import went and Svelte
refused the read as an illegal variable name. And a store the **request** brings is refused: a
store is an object with a `subscribe` function where the payload carries data, so `store_get` handed
a marker reads nothing -- which used to fail at injection rather than at build, with
`deriving \`$b\` failed`. Three are left, each its own shape: a store write inside an exported
function, a store deciding a `<svelte:element>` tag, and one still failing in a derivation.

## Decided, and not built

**A script that substitution cannot reach, reading the request.** A name reassigned or an object
mutated after its declaration, where the statements read request data, is a program per request.
That is the one thing the scope line gives up, by definition, and it stays refused by decision
rather than by omission: building it would be carrying SSR's per-request rendering back in under
another name. Where the statements read nothing the request decides, the render already evaluates
them and the walk bakes the result (`wants` in `walk.ts`). Zero in press.
[derivation.md](derivation.md)
holds the reasons and the three questions that would have to be answered if the scope line were
moved.

**Async Svelte.** `await` in markup or at the top of a script, and the async server render that
goes with it, await a real promise per request while the bytes are written. That is loading data,
the load stage's by definition, and it is refused by decision: the walk turns an `AwaitExpression`
away by name, since Svelte itself compiles one only under `experimental.async`. Non-async SSR
writes the pending branch and awaits nothing, which is what `{#await}` compiles to here and is
kept.

**Several hydration roots on one page.** Out of scope by the scope line: after
hydration the page is one Svelte SPA, and Svelte hydrates one root against one payload. Astro's
islands are a different arrangement, and [build.md](build.md) records that this artifact does not
express it and is not going to.

## Not yet the time

**Slots: done.** `<slot>`, `let:` and `<svelte:fragment>`. The plan had been to rewrite them into
snippets, and the note here said the bytes differ so a slot would need a block of its own with the
fallback as an alternate. It needed neither, and the reason is the same one that makes composition
work at all: **the caller's tag still holds its children**, so the copy the walk renders is handed
them exactly as the original would have been, and Svelte's own `$.slot` writes the anchors, picks
the fill or the fallback, and passes the props. What the walk had to do was stop refusing and walk
whichever of the two actually renders, in the scope it was written in.

Three rules, each read out of `SlotElement.js` and `build_inline_component`:

- The caller's children are grouped by a literal `slot="x"`, everything else to the default group,
  which `hands()` now does the way `handedTo()` already did for the probe.
- A `<svelte:fragment>` writes nothing of its own; it carries a `slot=` and its `let:` directives.
- A `let:` name is bound by the slot rather than read from the caller's scope, so it shadows a
  declaration of the same name there -- and it reads **the expression the `<slot>` passed under
  that prop**, expanded in the child's scope. That last part is what makes
  `<slot {thing}/>` inside an `{#each}` bind per iteration: bound to itself instead, the compile
  time render's one iteration was baked and every row wrote the same value.

The family went from 71 refusals to 8. What is left is a `let:` taking a pattern apart, a spread on
a `<slot>` (both refused by name, since the props a `let:` pairs against cannot then be listed),
and three that compile and are wrong: a named slot with a `let:`, a spread on the component, and a
component that renders itself through one.

`$:` is not a legacy question: on the server it is a plain statement run once, and one that
assigns a declared name from request data is the per-request script decided against above.
`$store` is not one either; see the store item under **ready**.

## Blocked, and on what

Nothing, now. The two that were are the framework layer's first step, done: see
[framework.md](framework.md).

**The root is a layout chain around a page: done.** `pkgs/routes` reads `src/routes` with Kit's
own `create_manifest_data`, generates one root per route in the shape Kit's `write_root` generates
-- the page nested in its layouts as dynamic components, sized to the project's depth, measured
byte for byte against Kit's root rendered with the props Kit gives it -- and the compiler takes
that root as the entry, with `data_0` .. `data_n`, `page` and `form` as its payload. On press
every route compiles from its real root, layout and all, and matches Svelte's render of it; the
context press's layout sets reaches the page because the two are one walk. Held against Kit
itself too: the body a production build of press answers a request with, from its own `load`
functions, is byte for byte what the compiled root injected with that request's data gives, on
every route. The scope line at the top of this file is measured, not claimed.

**Where request context sits: settled, and served.** In the root's props, the `page` Kit builds
per request and `form`, with `params` passed down as `page.params` the way Kit's root passes it; a
derivation reads them as props and never reaches for the request. The load stage is Kit's own,
running inside Kit's own server with only the render replaced: framework.md's second step, done.
