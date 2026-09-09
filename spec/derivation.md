# Derivation

A derivation is what a component's expression becomes once the runtime is not allowed to evaluate
it. `{#if price > 10}` compiles against `{#if __d0}`, and `__d0 = (price > 10)` is carried
alongside. See [pipeline.md](pipeline.md) for why that rewrite is what makes branch forcing
possible at all.

This file answers the question that rewrite leaves open: **what is a derivation allowed to be a
function of?**

## Three stages, and the protocol governs two

```
load     ->  payload      the backend's own capability
derive   ->  payload'     a function of the payload
inject   ->  bytes        concatenation
```

**Where the data came from is not the protocol's business.** A backend may read a database, call a
network service, or open a file, in whatever language and by whatever means. That is the load
stage, and nothing here constrains it.

This is the distinction that dissolves the question of whether a derivation may use `fetch`. It
may not, and not because the network is dangerous: because fetching is a capability of the stage
before this one. A derivation does not acquire values. It decides things about values that have
already been determined.

So the rule is not a list of permitted APIs. It is a property:

> **A derivation is a pure, deterministic function of the payload.**

Everything below follows from that sentence, and the sections are the two ways to violate it:
ambient input and side effect. A third was counted once and struck; see the end.

## Every identifier resolves, or it is refused

The compiler previously decided by shape alone: an expression matching a dotted identifier was a
data path, and anything else became a derivation carried verbatim. Nothing ever asked where the
names in it came from. Three failure modes were measured, and all three are the same missing pass:

| written | what happened |
| --- | --- |
| `{#if p.price > LIMIT}`, `LIMIT` a script const | compiled; `ReferenceError` at request time |
| `<script>const total = p.price * 2</script>{total}` | the baseline render threw Svelte's own `TypeError` |
| `{total}` on its own | matched the path shape, resolved against the payload, rendered empty |

The last is the worst of the three, because it is silent. A local variable and a payload key are
indistinguishable by shape, so a shape test cannot tell them apart, and the wrong answer is an
empty string rather than an error.

**Every identifier appearing in markup resolves to exactly one of these, or the component is
refused and the name is reported:**

| binding | comes from |
| --- | --- |
| a prop | the `$props()` destructuring, resolved against the data. See [payload.md](payload.md) |
| an each binding | `{#each xs as t}` |
| a carried constant | see below |
| request context | see below |
| anything else | refused, by name, at compile time |

This is one pass over the expression's ESTree, collecting `Identifier` nodes and subtracting the
locally bound ones. The AST is already in hand: the compiler reads the expression's source span
off a node it has already parsed, so nothing new is parsed and no dependency is added. It is
`pkgs/ast/src/bindings.ts`, and `bundle` refuses before it reads anything out of the markup.

**An expression the client owns is not this pass's business.** An event handler, a `use:`, a
`transition:` or an `animate:` reads whatever the component's own scope holds and writes no bytes,
so `onclick={() => n += 1}` is left alone where `{n}` would be refused. That is the same line the
compiler already draws elsewhere and it was measured rather than assumed.

An imported name is not reported here. It resolves, and what it resolves to is bundled: see the
next section, and `pkgs/carry`.

## Carrying is declared, never inferred

A constant the author wrote is not illegal to reference. It is a determined value like any other,
and refusing it would be arbitrary. The question is only how it gets into scope.

**The compiler does not analyse purity.** Purity analysis fails on the interesting cases, and the
frameworks that have taken this problem seriously all avoid it: Qwik decides what its optimizer
may capture by requiring `const` and by requiring module-level symbols to be imported or exported,
and Bun's macros decide what may be evaluated at build time by requiring the input to be
statically known and the result to be serializable. Neither proves anything about the code. Both
require a shape the author declares.

| where it is written | what happens |
| --- | --- |
| either `<script>`, not reading props | substituted into the expression, where it is a constant |
| either `<script>`, reading props | substituted into the expression, where it is **a derivation** |
| a function or a class | substituted as the expression form of itself |
| a name taken out of a destructuring | substituted as the initialiser with the way in after it |
| imported, with its source reachable | bundled with the expression that calls it |

**A declaration is substituted, not evaluated**, and the two rows are one mechanism rather than
two. `TAX` becomes `(0.2)` and `total` becomes `(data.price * (1 + (0.2)))`; the first is a
constant because a module script has no props to read, and the second is a derivation for exactly
the reason any other expression over the data is one. Nothing runs at build time, nothing has to
be serialisable, and neither block needs a rule the other does not.

`const total = p.price * 2` **is a derivation the author wrote outside the markup**: its free
variables are props, and its shape is the same as the expression inside `{#if p.price > 10}`.
Substituting it costs no new mechanism, and it turns the loudest failure the compiler had into
the most ordinary feature.

A chain, `const a = p.x * 2; const b = a + 1`, is substituted through into `((p.x * 2) + 1)`
rather than emitted as two derivations. That keeps derivations independent of one another, which
the section below relies on, at the cost of computing a shared subexpression once per use. Cost is
not what this file governs.

An earlier draft had the module block evaluated at build time and inlined as a serialisable
literal, and required an `export` to make the author's intent explicit. Substitution needs
neither: there is no boundary being crossed, the declaration sitting in the same file as the
markup that reads it, and asking for a keyword to permit that would be ceremony over nothing.

A function or a class is substituted as the expression form of itself, so `fmt(x)` becomes
`(function fmt(v) {...})(x)`. One that calls itself still reaches itself, a named function
expression carrying its own name, which is worth saying because a function is the one shape here
that can. Declaring either evaluates nothing, so neither is neutralised for the render.

A destructuring is the same substitution with the way in written after it: `a` out of
`const { a, b: c } = data.t` expands to `((data.t).a)` and `c` to `((data.t).b)`, and `x` out of
`const [x] = data.t` to `((data.t)[0])`. A default and a rest are neither a member nor an index
and are left out, which reports the name rather than guessing at it.

A render is given no data, so a declaration reading a prop is handed something harmless in the
source the compiler renders -- `null`, or `{}` and `[]` where it was destructured, since a
destructuring needs something it can be taken apart from. One place in the source is written over
once however many names it declares.

A first attempt wrote over it once per name, which took the file apart and was reported by
Svelte's compiler as an undefined variable naming nothing anybody could act on. **Rewriting a
source file is a list of replacements, and two of them over the same characters is not a case to
resolve but a mistake upstream**, so applying them refuses instead of writing the second into the
middle of the first. Both passes that rewrite a component go through the same applier, and both
get the check. It has already been substituted into every expression that used it, which
leaves it dead there. That is what a component doing this used to crash on, inside Svelte's own
renderer, with a `TypeError` naming nothing an author could act on.

**An imported function is carried, on one condition: its source has to be reachable at compile
time**, so that it can be bundled with the expression that calls it. It usually is, being a module
the author already depends on.

**What is carried is gathered from every file whose expressions became derivations, not from the
entry alone.** Composition walks into a child, and the child's own markup becomes derivations in
the *entry's* artifact -- so a child writing `{shout(word)}` around a function it imported itself
compiled cleanly and threw `ReferenceError: shout is not defined` at request time. Nothing at
compile time could say so, because a render never evaluates a derivation: the expression is
collected as source and first runs when a request arrives. A component the walk did not enter is
rendered by Svelte and contributes no derivation, so it is not gathered from.

**And it is gathered from what the expressions read, not from what the markup names.** The
markup's own identifiers were the list once, and press's home route showed it wrong in both
directions. `const src = imgsrc(...)` read as `{src}` is a derivation calling `imgsrc`, which the
markup never names, so the bundle held nothing and the first derivation stopped at a name that was
not defined. And `<Provider client={queryClient}>` names a package the render evaluates and no
derivation ever calls; bundling it pulled a component library into the bundler, which then had no loader
for `.svelte`. So the skeleton hands over every expression it planted -- each hole's, each
decision's tests, each block's source and tests -- and an import is carried when one of them
reads it. That is the same set the evaluator will look up, by construction.

**And a name means what the file that wrote it imported.** Derivations were evaluated in one
scope per route, so two components carrying one local name for different modules was refused --
and press does exactly that with paraglide's messages, `import * as m` in one file and `import {
m }` in another, which JavaScript allows because each module has its own scope. So does this,
now. Every hole and block records the files its expression was written across, innermost first:
the component it sits in, then each caller up to the entry. The chain rather than the one file
because substitution moves a prop's expression from the call site into the child's, so a child's
expression reads names the caller bound. The bundle exports one object per file holding that
file's imports under the names the file wrote, and the evaluator opens the chain as nested
scopes, the entry outermost, the component the expression sits in shadowing its callers, the
data innermost of all. The rendered copy gets the same treatment: what a substituted expression
reads of the caller's imports is imported into the copy, its specifier resolved against the
caller and written relative to the child, because a copy resolves its own from where its
original sits. A name the child binds to the same module is its own; to another is a collision
JavaScript would not have had, and is refused by name.

A specifier is resolved against the file that wrote it, since two components in different
directories spell `./helper.ts` differently and the bundle is written from one place.

**A path is a path only where it is rooted.** `URLS.external.fonts` spells like one and is not:
`URLS` is a constant a file imported, and resolving it against the payload found nothing and
dropped the attribute. The skeleton carries the payload's keys, and the lowering keeps a path as a
path only when its first name is one of them, a name a block binds, or an id the runtime makes;
anything else, `undefined` and `true` included, is an expression the evaluator computes in the
scope of the files that wrote it.

**A type is not a read.** `T[p as keyof typeof T]` reads `p` and `T`, and names `T` a second time
in a position only the type checker looks at. Substitution wrote the object literal there too,
and `keyof typeof ({ ... })` is not TypeScript, so the expression stopped parsing and a component
that chose an icon by it was refused as choosing per request. The scan that finds what an
expression reads, and the one that finds the fixed paths in it, now step through the wrappers --
`as`, `satisfies`, `!` -- to the expression inside and into no other TypeScript node.

**Every derivation is JavaScript by the time it is evaluated.** A component written with `<script
lang="ts">` writes its expressions with annotations and `as` in them, and the walk copies them as
written, because a derivation is the author's source recorded rather than rewritten. Svelte strips
the types on its own way to the render; nothing did on the way to the IR, and `new Function`
stopped at the first colon. They are stripped at the one point every derivation passes through
between the skeleton and the IR, in the lowering wrapper, with the same stripper Node loads a
`.ts` file with -- types become whitespace and nothing else moves -- and the test a route's
structures are chosen by goes through the same function, being source text a `?:` was written
with.

A draft refused a call through a value -- `handlers[k](x)` -- for having no name to follow.
Bundling makes that unnecessary: `handlers` is the name, it is imported, the whole of it is
bundled, and which entry the call reaches is decided at request time inside the bundle like any
other lookup. What is refused is what was always refused, a name that resolves to nothing.

**It is bundled, not analysed**, and a draft that said otherwise was wrong on measurement. The two
functions the whole question is about do not survive an analysis: `clsx` is shipped minified and
its core recurses into itself, and `tailwind-merge` keeps a module-level LRU cache, which is a
mutation that is nonetheless deterministic. A transitive purity check rejects both, and they are
the ecosystem the carrying was for. Nor is a module the right granularity: the file exporting the
clean `cn` measured above also exports `typeof document !== 'undefined'` and holds a module-level
`Date.now()`, neither of which the function anybody wants touches.

There is a reason not to analyse beyond its being impractical. **The client runs the same function
during hydration**, out of the same module, so a library reading a clock produces the ordinary SSR
mismatch that SvelteKit, Next and Remix all have and none prevent. Analysing library code would
make this stricter than Svelte itself, at the cost of the library. What is genuinely ours to
govern is what the author writes in the markup, and that is exactly what the pass above reads.

## Ambient input is data, not capability

`fetch` is the obvious violation and the least dangerous, because nobody writes it by accident.
The dangerous ones arrive through APIs that look pure. Measured, on one payload, with no clock and
no randomness anywhere in the expression:

```
                                    TZ=UTC          TZ=Asia/Tokyo
new Date(p.d).getHours()            22              7
new Date(p.d).toLocaleDateString()  "11/14/2023"    "11/15/2023"
```

The value came entirely from the payload. The reading of it did not. Time zone and locale are
ambient inputs that no list of forbidden function names would catch, and they are reported
elsewhere as the most common silent hydration mismatch in server-rendered React.

So ambient access is refused in its bare form -- `Date.now()`, `new Date()` with no argument,
`Math.random()`, `toLocale*`, `Intl.*` without an explicit `timeZone` or `locale` -- and the
determined values are provided instead, resolved once during load and carried in the payload:

```
$.now      $.tz      $.locale
```

**The client agrees by construction.** Hydration re-evaluates the same expression in the browser,
so this would otherwise be the ordinary SSR mismatch that every framework has. Next's own guidance
is to pin the time zone into `Intl.DateTimeFormat`'s arguments so both sides use one value; it can
only be guidance there, because React cannot analyse component code. Here the browser has no
second source to read: the field it reads is the field the server wrote. The failure class is not
mitigated, it is absent.

A weaker rule was considered and rejected: grading strictness by where the derivation lands.
Svelte's own behaviour does distinguish them -- `set_text` compares and silently overwrites, while
a mismatched anchor throws `HYDRATION_ERROR` -- so a wrong slot costs one frame and a wrong branch
costs the whole hydration. But grading only pays when strictness costs the author something, and
once the determined value is available it costs nothing. The distinction survives as the wording
of the diagnostic, not as two sets of rules.

## The payload is frozen

`(p.price = 999)` evaluated successfully, changed the payload in place, and was visible to every
derivation after it. That is not a matter of taste; a function does not modify its argument. The
payload is frozen before the derive stage runs.

## Derivations do not see each other

Each derivation is a function of the payload alone and cannot read another's result. That they
currently can is an artefact of accumulating into one object, not a decision.

Independence keeps **evaluation order out of the protocol**, so two backends cannot disagree by
evaluating in different orders. Recomputation is the cost and it is not worth avoiding; the
compile-time substitution above already removes the case where sharing would have mattered.

## A rune is an ordinary declaration

The compiler used to skip any declaration whose initialiser called a name beginning with `$`, on
the grounds that "a rune holds client state rather than a value the markup can be given". That is
false, and one line of Svelte's server transform says so:

```js
const value = args.length > 0 ? visit(args[0]) : void0;   // the rune's first argument
...
if (declarator.id.type === 'Identifier') {
  declarations.push(b.declarator(declarator.id, value));  // $state(0)  ->  let n = 0
}
```

**On the server there is no reactivity**, so nothing a rune marks can change after the render.
`$state(x)` is a declaration whose value is `x`; `$derived(e)` is one whose value is `e`, wrapped
in a lazy cell that memoises it; `$derived.by(fn)` is `fn()`. `$effect` is not a declaration and
does not run at all -- measured, on a component whose effect assigns `9` to a `$state(0)` read from
the markup: Svelte's server renders `0`.

So a rune declaration is substituted like any other, using the rune's argument as the initialiser.
What made them look different is that they say something about the value's *future*, and the
compiler read that as a statement about its present.

Four are substituted, and the list is short on purpose:

| | |
| --- | --- |
| `$state(x)`, `$state.raw(x)` | the value is `x` |
| `$derived(e)` | the value is `e` |
| `$derived.by(fn)` | the value is `fn()`, so what reaches it is a call |

`$props()` is the payload and is read elsewhere. `$effect` declares nothing and does not run.
`$props.id()` is not substituted either, and for the opposite reason to the one this file used to
give: an earlier draft called it a value the server and the client each generate, which would be
ambient, and Svelte's source says otherwise. The server writes the id into a `<!--$id-->` anchor
from a counter it keeps per render, and the client's `props_id` reads it back off that anchor when
it hydrates, so the value is the server's and is decided per component instance when the bytes are
written. The name stands for a binding the runtime makes at the anchor; see
[refusals.md](refusals.md). Anything else is left unresolved and reported by name.

**An event handler is exempt, and it had to be said twice.** Substituting into one turns an
assignment target into the value it was declared to be: `n += 1` became `(0) += 1`, which is not
JavaScript. The pass that resolves names already exempted handlers; the pass that reduces markup
did not, because Svelte 4 spelled a handler `on:click` and that was a directive carried across
whole, while Svelte 5 spells it `onclick`, an ordinary attribute. Nothing had noticed for as long
as no substituted name was ever assigned to.

The memoisation is worth one line. `$derived(e)` evaluates `e` once however many times it is read,
where substituting it evaluates `e` per use. That is observable only if `e` has side effects, which
[the rule above](#every-identifier-resolves-or-it-is-refused) already excludes.

## What the compile-time render needs from the script, which is nothing

The render that produces the byte skeleton does not read the script. Measured, on the source the
sentinel pass actually hands to Svelte:

```html
<script>let { data } = $props(); let x = 1; x = 2</script><p>{"%%s0%%"}</p>{#if true}<b>y</b>{/if}
```

Every markup expression is already a sentinel and every branch is already a constant, so no name
the script declares is referenced and neither is `data`. Rendering the same markup three ways --
script intact, script reduced to its `$props()`, and no script at all -- gives **byte-identical
output**.

**So the script cannot influence the compile-time bytes, and the only way it can break that render
is by executing.** A script that reads `data` throws inside Svelte's own renderer, because the
render is given no data. That is a reason to stop executing it, not a reason the component cannot
be compiled: what the compiler needs from a component at compile time is its structure, and
structure comes from the AST and from forcing each branch.

**What the runtime needs is not a value either.** A slot needs something it can evaluate to a
value; a branch needs something it can evaluate to a choice. Neither is a value known at compile
time, which is the whole reason this stage exists.

## `{@const}` and `{let}` are the same substitution, one scope in

Svelte's server compiles `{@const x = e}` to `const x = e` in the block it sits in, so it is a
declaration whose scope is that block rather than the script. It substitutes like any other: the
name stands for its initialiser wherever the block's markup reads it, chained where one const reads
another, and taken apart where it destructures -- the same function a snippet's parameter uses,
so a default inside the pattern is the choice JavaScript makes, `(v.b === undefined ? 'd' : v.b)`,
expanded against what the earlier consts bound. Measured inside a snippet with parameters: a
destructuring, a default in it, a const reading another and reading two parameters, and one inside
an each inside the snippet.

The render is handed something in the initialiser's place, for the reason a declaration reading a
prop already is: by then every read of it is a marker, and evaluating it would reach for data the
render is not given. What stands in has to come apart the way the name does.

**Where it binds is the whole fragment, not the rest of it.** `clean_nodes` in
`3-transform/utils.js` lifts every one of these out of the fragment's nodes into `hoisted`, and the
visitor pushes what it declares into the block's `init`, which is written ahead of the template. So
a `{@const}` written below the markup that reads it still binds for it. In **legacy mode** a second
rule follows: `sort_const_tags`, guarded by `!state.analysis.runes`, puts them in topological order,
so `{@const a = b}` above `{@const b = 1}` reads the 1. In runes mode there is no sort and reading a
later one is JavaScript's own temporal dead zone, which Svelte raises from the same source. Whether
a file is legacy is `2-analyze/index.js`'s one line: `<svelte:options runes={...}>` first, then
whether anything in the scripts is a rune.

A group handed to a component is a fragment of the caller's and Svelte cleans it the same way, so
the same hoisting holds inside a `<slot>`'s markup.

**`{const}` and `{let}` are the same tag with a wider declaration.** `DeclarationTag.js` pushes the
whole `VariableDeclaration` into `init` unchanged, so one tag may declare several at once and a
later one reads what an earlier bound. Because the declaration is pushed rather than rewritten, its
initialiser reaches the same `CallExpression` visitor a script's does, and a rune is compiled away
the same way: the value is the rune's first argument, `$derived.by`'s is that argument called, and a
rune given nothing holds `undefined`. It is runes mode only, which `declaration_tag_no_legacy_mode`
enforces, so it and the sort above cannot meet in one file.

**A block is a scope, and reaching past one writes the wrong bytes.** Substitution replaces a name
with what it was declared to be, so it has to stop where something nearer declares the same name.
Only a function's parameters did. `array.map((item) => { const foo = (i) => i * 2; return foo(item)
})` beside a `const foo = (i) => i` in the script wrote the script's function into the loop, which
is a value rather than a refusal -- the sample that found it renders `1,2,3` where Svelte renders
`3,6,9`. What a block declares now shadows for every statement in it, the ones above the declaration
included, and a loop's head and a `catch` parameter bind the same way.

## Every way in a pattern has, where the markup binds one

`{#snippet}`'s parameter, `{@const}`, `{#await}`'s value and `{#each}`'s context all bind names by
taking a value apart, and all four go through one function. What it writes for each name is read forward out of Svelte's
own `_extract_paths` in `compiler/utils/ast.js`, which answers the same question for the client
transform:

| written | the way in |
| ------------------------- | -------------------------------------------------- |
| `{ a }` | `(v).a` |
| `{ 'a-b': c }`, `{ 0: c }` | `(v)['a-b']`, `(v)[0]` -- a literal key is an index |
| `{ [k]: c }` | `(v)[k]`, with `k` expanded where it stands |
| `{ a: { b } }` | `((v).a).b` -- one way in written after another |
| `{ a, ...rest }` | `$$exclude_from_object((v), ["a"])` |
| `[a, b]` | `$$to_array((v))[0]`, `$$to_array((v))[1]` |
| `[a, ...rest]` | `$$to_array((v)).slice(1)` |
| `{ a = d }` | `((v).a === undefined ? (d) : (v).a)` |

There is a way in to every name a pattern binds. **It is not always a member**, and the rule this
replaces -- a rest or a nesting is neither a member nor an index, so it has no way in to write down
-- was a description of the shape of the answer mistaken for an answer. The two calls are Svelte's
own, carried the way `attributes` is, so the key emptying, the symbol handling and the iterable
handling are upstream's rather than reproduced here.

### A script's own pattern is the same question, answered twice

A declaration in a script binds names the same way, and it was answered separately and worse: a
member for a plain key, an **index** for an array, and nothing at all for a nesting, a rest or a
default. Two of those three are now the table above.

The index was not a smaller answer but a wrong one. Destructuring uses the iterator protocol, and
`let [a, b] = src` over a `Set` wrote nothing where Svelte writes its two members -- silently,
because the suite has no sample of that shape. `$$to_array` is the same call the markup's patterns
already made, with **the count `_extract_paths` passes** where the pattern has no rest: it caps an
unbounded iterable rather than exhausting it, and `let [one, two] = infinite()` is a declaration a
real component writes. What that count costs is a primitive: `to_array` reaches the capped branch
through `Symbol.iterator in value`, which throws on a string, so `let [a, b] = 'hi'` is a build
error naming the call rather than bytes. Svelte's own server destructures it, so this is a gap.

**What a name reaches its value by is a template, not a suffix.** A member follows the value and
`exclude_from_object` wraps it, and a pattern may alternate the two -- `[{ a, ...r }]` is a wrap
inside an index inside a wrap -- so the record holds an expression with the initialiser's place
marked in it. It is written unparenthesised where the declaration named the value directly, because
`export (function f() {})` is not JavaScript.

**A default and a computed key go in a slot.** Both are expressions in the declaration's own scope
rather than a way into the value, and the template is raw source that nothing expands names inside.
So the template carries a slot where each belongs and the node beside it, and the caller expands
that node the way it expands the initialiser -- which is what lets `const { a = n } = t` read the
`n` declared above it. The markup's patterns write them inline instead, because they are given the
expansion already. The default is JavaScript's own choice, which `build_fallback` writes the same
way: the member where it is not `undefined`, and the default where it is, so `null` is not
defaulted. A computed key is evaluated a second time to name it for a rest, which is what
`_extract_paths` does.

**What the render is handed has to come apart at every level.** `{}` is enough for `{ a }` and not
for `{ o: { x } }`, whose second level then destructures `undefined` and throws. The stand-in is
built from the pattern instead: an object per object, an array per array, `null` at the leaves.

### A substituted value has to read the same twice

A declaration is substituted at every read, so a value that is not the same twice is a different
value at each of them. `Math.random` was already refused where the markup wrote it. What nothing
looked at was the declaration behind a name the markup read: `const s = Symbol()` beside `s in obj`
made two symbols and wrote `false` where Svelte writes `true`, which is bytes rather than a
refusal. The declarations the markup reaches are followed now, transitively, and checked for the
same thing -- only for that, never for a name it cannot resolve, since a script may say whatever it
likes as long as what it leaves behind reads the same twice.

A computed key is expanded against what the pattern has bound before it: JavaScript binds a pattern
left to right, and `{ length, [length - 1]: last }` reads the one from the other.

**An array pattern goes through `to_array` and never by index**, because it destructures by the
iterator protocol -- the server writes `let [a, b] = each_array[i]` and lets the engine do it.
Reading `(v)[0]` is the same answer for an array and no answer at all for anything else:
`{#each rows as [a, b]}` over a list of sets wrote `-` where Svelte wrote `x-y`. This is the one
place where `_extract_paths` is followed only partway. It passes a count -- `to_array(value, n)`,
`n` being the element count where no rest follows -- which caps an unbounded iterator, and reaches
that branch through `Symbol.iterator in value`, which throws on a primitive: `{@const [first] =
'ab'}` destructures on the server and threw here. The call is made without it, so the behaviour is
the branch below -- arrays unchanged, everything else through `Array.from` -- which is the engine's
answer for every source but an endless one, and a render does not end on an endless one either way.

The cost is that an array pattern's names are derivations rather than paths, one call per name per
item. An object pattern's stay paths, `$$item0.a` resolving per item as binding the name directly
used to, and an object pattern is what an each destructures nearly always.

**What a block binds shadows a declaration of the same name.** Svelte's server writes
`let a = each_array[i]` inside the loop, which is block-scoped and shadows the `let a` in the
instance script the way any declaration does, so `{#each a as a}` reads the item and not the array.
The name stands for itself in the body, which is what the walk carries down; without it every read
of `a` was written as the array's own initialiser.

An each block's context is the one of the four whose value is not an expression this pass holds: it
is the element, bound per item by the runtime. So the block binds the element under a name of its
own -- `$$item` and the block's number, `$$` being Svelte's reserved prefix and the number keeping
two nested blocks apart -- and every name the pattern binds is an expression over that one. A
member of it is still a path the injector resolves per item, and costs what binding the name
directly used to; everything else is a derivation over the binding, which is what a derivation
reading an each's name already is. The IR node is one shape either way, which is what
[ir.md](ir.md) records.

**A declaration in the script still takes only a member or an index.** `const { a, ...rest } = t`
there is reported by name, and the entry under Open below is that gap. The difference is where the
value comes from: a markup binding takes it apart from an expression this pass writes and holds,
and a declaration takes it apart from an initialiser another pass substitutes by span.

### The pattern the render sees

The pattern stays in the source the compiler renders, taking apart the placeholder that stands in
for the value, and by then every read of what it binds is a marker. So nothing in it may evaluate:
a default's value and a computed key become `undefined`, and a nested pattern becomes a name.
`{ a: { b } }` over `{}` destructures `undefined` and throws inside Svelte's own output, which is
the placeholder failing rather than anything the author wrote. The name carries `$$`, which Svelte
reserves, and the position it stands at, which no two nestings in one file share.

### A carried name is never handed back to the render

An expression reading nothing the request decides is written back into the markup for Svelte to
evaluate, which is what keeps those bytes upstream's. One naming a carried function cannot be:
Svelte's compiler refuses a `$`-prefixed variable in markup outright -- `$$exclude_from_object` came
back as "is an illegal variable name" -- so such an expression stays a marker and the derivation
calls the function where the carried bundle has it. Tested by name rather than by the prefix, since
`$$props`, `$$restProps` and `$$slots` wear it too and those are the render's own to evaluate.

## A prop's default is a question about the payload, not about the name

`$props()` destructures, so Svelte's answer is JavaScript's: the default is taken where the
**property** is `undefined`, which covers a key the request left out and a key it sent as
`undefined`, and does not cover `null`.

The derivation that stands over the payload's key used to carry the test in its expression,
`typeof x === 'undefined' ? (d) : x`. That is a different question. An expression reads its scope
through `with`, which asks the payload whether it has the name and falls through to the globals
where it does not -- so `export let Math = { min: ... }` resolved `Math` to the global, `typeof`
said `object`, and the default was never taken. Svelte wrote `potato`; this wrote `5`.

The expression is the default alone now, and the test is on the property, made by the evaluator
that applies it. See `Derivation.prop`.

**Every prop the entry declares stands over its key, default or not.** The one with no default
holds `undefined` and compiles no expression; its whole job is that the name is in scope. An
expression reads its scope through `with`, which asks the payload whether it has the name and falls
through to the globals for a key it has not got -- so `class:unused` over a prop the request did
not send threw `unused is not defined` per request, where Svelte's `$props()` destructuring makes
it `undefined` and writes no class. Nine of Svelte's samples were that, and a missing prop is the
ordinary case rather than an exotic one.

## One derivation per expression, not per read of it

A declaration is written out wherever the markup reads it, so `{#each items as item}` and the
`{items}` handed to a child are the same text twice. Evaluated twice they are two arrays, and the
elements of one are not the elements of the other: `items.includes(item)` came out false where
Svelte's own render, which evaluates the declaration once, says true.

The assembler gives one name to each expression it has already seen, keyed by everything that
decides what it evaluates to -- the text, the file chain each name in it resolves through, and
whether it is computed here or where it is used. Sharing the name shares the value, since a
derivation is computed once per request and held. It is also smaller: a route joined out of several
structures writes the same expression once for every place it was read.

**It is not the whole of the identity question.** Where the declaration is read inside a larger
expression -- `items.includes(item)` is one derivation with the array literal inside it -- there is
nothing to share, and the array is built again. Holding a declaration rather than substituting it
is what closes that, and it is the open item under Substitution below.

## Which names the request decides, in both spellings of a prop

A declaration reading a prop is neutralised for the render, which is given no data: holding one is
how a component used to crash inside Svelte's own renderer rather than being refused.

Whether a declaration reads a prop is decided by the list of names the request brings, and that
list read `$props()` destructuring only. Svelte 4's spellings -- `export let x`, `export var x`,
`export { x as y }` over a `let` -- were not in it, so `export let n; const twice = n.v * 2` kept
its initialiser and the render evaluated `undefined.v`: a `TypeError` naming nothing, which is the
crash the neutralisation exists to prevent. `export const` stays out, being a readonly export that
`transform-server.js` sends **up** to a caller rather than takes from one.

Found by probe rather than by the corpus, which shows four of these -- they read as
`Cannot read properties of undefined`, and only where the initialiser dereferences: `n * 2` over a
missing prop is `NaN` and nothing reads it, so it passed.

## The payload itself has a name, for the expressions that need the object

`$$props` is the object a component was called with, `$$restProps` what its declared props left of
that object, and `$$slots` which slots it was given. `transform-server.js` builds each from
`$$props`: `sanitize_props($$props)`, `rest_props($$sanitized_props, [named])`,
`sanitize_slots($$props)` -- each Svelte's own function over the object.

An expression reads its scope through `with`, which binds the payload's **keys** and not the
object, so all three had nothing to be built from. The evaluator binds the payload under `GIVEN`
now, a `$$` name nothing an author writes can shadow and Svelte's compiler refuses in markup, which
is what keeps an expression naming it from being handed back to the render. The three names expand
to Svelte's own functions over it, which is why the emptying, the symbol handling and the `children`
and `$$slots` keys are upstream's rather than reproduced.

**The entry only.** A child's `$$props` is what its call site passed, which is a different object --
the attributes and spreads at the tag, folded the way a rest is -- and building it is the open half.
Reading one in a child stands as the name it was, which the pass that resolves every name reports.

## A `$:` that assigns a name is a declaration

`LabeledStatement.js` collects a `$:` and `transform-server.js` puts it at the end of the instance
body in **topological order**, declaring `let x` above for the name it assigns. So `$: doubled = n
* 2` is a declaration whose initialiser is the right-hand side, and it substitutes like any other:
one reading another chains the way two declarations do, the ordering being what substitution does
anyway.

**Legacy mode only**, which is the mode `LabeledStatement.js` answers in -- in runes mode it calls
`context.next()` and the label is an ordinary one, which Svelte's own analysis then refuses.

Three shapes are not declarations, and each is left to the rule that already covers it:

- **A name a `let` already declares.** `let n = 1; $: n = a * 2` is an assignment to that `let`, and
  the value the markup reads is not the initialiser: refused, as an assignment after a declaration.
- **A store write.** `$: $count = n` sets the store. `transform-server.js` declares a `let` only for
  a binding whose kind is `legacy_reactive`, and a subscription's is `store_sub`.
- **A bare statement.** `$: console.log(x)` writes no bytes and is neutralised for the render, which
  is what it already was.

**A pattern on the left declares every name in it.** `transform-server.js` takes
`extract_identifiers(node.body.expression.left)` and declares each identifier whose binding is
`legacy_reactive`, so `$: ({ store } = container)` and `$: [x, y] = coords` are declarations of
what they destructure, and each name reaches the right the way any pattern does. What the render
is handed in place of the right-hand side has to come apart the way the left does, at every level.

The statement that declares a name is also the assignment to it, which three rules had to be told
about: the one that refuses an assignment after a declaration, the one that refuses a value changed
by something the render runs, and the one that leaves a store the script writes to the render.
None of them reads a declaration's own initialiser as a change. The third was found by the pattern
case: `$: ({ store } = container)` binds a name rather than setting a store, and read as a write it
left the whole subscription to the render, which is given no props and wrote nothing.

**What a render is handed in place of an initialiser is the initialiser's own expansion**, not the
name's. One initialiser stands for every name a destructuring binds and each of those reaches a
different part of it, so writing one name's value there is wrong; for a declaration that named the
value directly the two are the same text. That is what lets a destructured declaration be left as
written where nothing it reads varies, the way a plain one already was.

## A rune in an expression is written as what the server answers it with

A rune is compiled away by Svelte and exists nowhere at run time, so an expression holding one
cannot be evaluated as it is written. `CallExpression.js` gives each an answer where it stands, and
they are copied into `ANSWERED` in `locals.ts`:

| written | the server |
| --------------------- | ----------------------- |
| `$effect.tracking()` | `false` |
| `$effect.pending()` | `0` |
| `$effect.root(f)` | `() => {}` |
| `$effect(f)`, `$effect.pre(f)`, `$host()`, `$inspect(...)` | `undefined` |
| `$state(v)`, `$state.raw(v)`, `$state.eager(v)` | `v` |

The last three keep the argument and lose the call, so the names inside it are still rewritten
where they stand; the rest replace the whole call, and nothing inside one is looked at again.

What is not here needs a helper or a declaration to stand in -- `$derived` and `$state.snapshot`
call into Svelte's runtime, and `$props` and `$bindable` are a declaration's business. One of those
left in an expression is refused, in [refusals.md](refusals.md), rather than reaching the evaluator
as `$derived is not defined`.

**They are not names the data has to carry either.** The pass that resolves every name in markup
reported `$effect` in `$effect.pending()` as one, which is how they were being found.

## The globals an expression may read

A short list, in `bindings.ts`: names that resolve to the same value everywhere, so an expression
using one cannot make the server and the browser disagree. Anything that reads a clock, a locale or
an environment is not on it, and `Math.random` is named apart from `Math`.

**A name can be on the list and one of its uses off it.** `Date` reads the same everywhere wherever
it is given something -- `Date.parse(s)`, `new Date(s)`, `x instanceof Date` -- and is a clock when
it is given nothing. So the name is a global, `Date.now` is named apart from it the way
`Math.random` is, and a `Date` built from no arguments is named apart too. `Promise` and
`structuredClone` need no such split.

`Symbol()` is the other shape: not a clock but not the same value twice either, so substituting it
at two reads makes two different symbols. It is reported wherever it is found, and the declarations
the markup reaches are followed to find it -- see the section on a substituted value reading the
same twice.

**A name read only under `typeof` needs no binding at all.** `typeof x` on a name nothing declares
is defined behaviour and reads the same everywhere: `"undefined"`. It is how a file asks whether a
global exists, Svelte compiles it unchanged, and the render evaluates the same expression, so the
bytes agree. Only where every read of the name is guarded that way -- `{typeof b} {b}` still has to
resolve, and the count of the other reads is deliberately loose, a member's property name and an
object key landing in it too. Being counted means being reported, which is the safe direction.

`console` is on it. It reads the same everywhere -- `undefined` -- and what it does instead of
returning is not bytes; both the render and the artifact call it, so a line is written twice, which
is a log rather than a difference in what is served. Eight of Svelte's samples log from markup and
were refused for reading a name the data does not carry.

## `$props()` bound to a name is the payload itself

`let { a, b } = $props()` destructures the object a caller passed and each name is a payload path.
`let props = $props()` binds the object, and `transform-server.js` says what that object is:
`$$sanitized_props = sanitize_props($$props)`, which is what the call returns. For the entry that
is the payload, bound under `GIVEN` -- the same object a bare `$$props` read already stands for.

The render keeps the call as written, because Svelte compiles it to that same expression and a
render given no props gets an empty object. What is neutralised is the declaration, for the reason
one reading a prop is: `GIVEN` is not a name the render has, and Svelte refuses a `$$` name
outright. So it joins the set of names that decide whether a declaration is handed something
harmless.

**A child's is a different object.** What its call site passed is bound prop by prop, so a child
binding `$props()` to a name stays unrecorded and the name is reported where it is read.

## A store read is the store's value, where the store is a declaration

`$foo` is a subscription: Svelte compiles it to `store_get($$store_subs, '$foo', foo)`, which
subscribes, keeps the value, and unsubscribes when the render tears down. Where `foo` is a
declaration this pass substitutes, the read is that value -- `get` from `svelte/store`, carried like
the other helpers, which subscribes, takes the value and unsubscribes at once. Svelte's own is not
usable here: it hangs the subscription on a teardown a derivation has not got.

Where `foo` is what the request brought, this does not apply and the subscription stays refused: a
store is an object with a `subscribe` function and the payload carries data.

**And where the script itself writes the store, the read is left as written.** `$count += 1` in the
instance script sets the store before the template runs, so the value the markup reads is the one
those statements left. The render runs the script and has it; a derivation does not, and would read
what the store was declared with. So the expansion is made only for a store nothing in the script
assigns to -- which is what the render was already answering correctly.

## A name is only its initialiser while nothing changes what it holds

`transform-server.js` puts the instance script's statements at the top of the component function
and the template after them, so a declaration is evaluated **once** and every reference is that one
binding -- a function written beside it closes over the same value. Substitution writes the
initialiser at each read instead, which is the same answer only where evaluating it again is.

Two rules stand on that, and for a long time only the first did:

**Assigned after being declared.** `let x = 1; x = 2` and `const o = { a: 1 }; o.a = 2`, in the
script's own statements. Both compiled and wrote the wrong bytes before they were refused. **A prop
is under the same rule**, though it is not a declaration: `let { options = 'foo' } = $props();
options = 'bar'` is one statement of the instance script and Svelte runs it before the template, so
the name holds `bar` while the bytes are written where the substitution stood for the payload's key
and wrote `foo`. The entry's props arrive here as a set of names and a child's as the names its
call site bound, a `$props()` destructuring being read elsewhere rather than declared.

**Changed by a function this render calls.** The first rule's exemption said a function body does
not run while the bytes are written, and that is true of a handler and false of anything the markup
calls:

```svelte
const log = [];
function next(x) { log.push(x); return x; }
{#each rows as row}<p>{next(row)}|{log.length}</p>{/each}
```

`log` expands to `([])` at every read, so each read builds its own array and the pushes go nowhere:
`1|0`, `2|0` against Svelte's `1|1`, `2|2`. Nothing said so, which is what made it worse than a
refusal. It was found by probe -- no sample in Svelte's corpus writes the shape -- and it is not
about destructuring or blocks; the same script with `{#each rows as row}<p>{next(row)}|{log.length}
</p>{/each}` and no pattern anywhere diverges the same way.

**Both halves have to hold**, and that is what keeps the rule off the ordinary component:

- *Something the render runs changes it.* What the render runs is the closure of calls: a name
  called by the instance script's own statements, which Svelte puts ahead of the template; a name
  called in the markup; and a name called inside a declaration the markup reads, since reading one
  writes its initialiser out where the render evaluates it. The first is the rule that refuses a
  direct assignment, one level in -- `let promise; ... new_promise()` left `{#await promise}`
  taking the branch a resolved value takes. A function **handed** to `run` or `untrack` runs too:
  `legacy-server.js` is one line, `fn()`, and `index-server.js` exports `run as untrack`, so a
  migrated `$:` written `run(() => count++)` changes what it names while the bytes are written.
  By those two names and no rule, because there is no rule: `onMount` and `$effect` take a
  function the server never calls and `sleep(10).then(fn)` calls it later, and nothing in the shape
  of a call says which.
- *And the markup reads it outside a function.* A handler is written nowhere on the server, so a
  name the markup only names inside one -- `onclick={() => queued.shift()?.()}` -- is not a name a
  change can be seen through, and holding it against one is a refusal nobody could act on. **Reading a function is not running
  it** -- `onclick={go}` and `on:change={() => handler(bar)}` both name a call and make none -- and
  the walk stops at every function it meets except the one it is asking about, so an arrow returned
  from a called function is not counted either.
- *By a route that does not pass through the function doing the changing.* A
  function reading back what it just wrote is one evaluation and holds:
  `export function compute() { return value.toUpperCase() }` with `{compute()}` is the whole of
  `value`'s life.

An assignment says what the new value is; a method call does not, and `log.push(x)` changes the
array all the same, so a callee reaching a declared name through a member counts too. That half is
the conservative one -- `xs.map(f)` changes nothing and is in it -- with one exception that is not
a guess: a name standing for `undefined` has no value to change, so `let button = $state()` with
`button?.click()` is left alone.

Across Svelte's 2388 samples the rule refuses two, both of them already failing, and moves none
that were passing. What it does not see is a function handed to something else that calls it --
`xs.map(fmt)` -- and that is the hole left in it.

The fix rather than the refusal is to stop substituting such a name and bind it once per request,
which the derivation machinery could hold since a derivation is already evaluated once and cached.
That is a change to what substitution is, not a patch to this rule, and it is not made here.

## Substitution maps a name to an expression, and a program is not an expression

Every name the markup reads becomes one self-contained expression. `const t = data.a + 1` becomes
`(data.a + 1)`, and nothing else is needed. The limit is exact and it is not about runes:

```
let x = 1; x = 2                Svelte renders 2; substitution sees the initialiser, 1
const o = { a: 1 }; o.a = 2     Svelte renders 2; substitution sees 1
let s = ''; for (...) s += c    there is no expression to substitute at all
```

The first two **compiled and produced the wrong bytes with nothing to say so**, which is the same
shape as every other defect this specification records: a model narrower than its input, and no
error at the boundary.

Running the script instead is not blocked by anything measured. Its inputs are `$$props` and the
module scope, and there is no third: Svelte's compiled component is a function of exactly those,
with no DOM, no lifecycle and no request. What it would cost is written under Open.

## Termination is not one of the three

An earlier draft counted it as the third way to violate the sentence at the top, and claimed it
came free: a derivation is an expression, there is no `while` and no named recursion to write, and
what remains terminates. Imported functions were refused to protect that.

**The guarantee was never there.** Measured, with no carried function, no import and no loop
keyword -- an expression, exactly what this file permits:

```
[...Array(N)].map((_, i) => i).filter((i) => i % 7 === 0).length

N = 1e5      2ms
N = 1e6     11ms
N = 1e7    128ms
```

`N` is a literal the author typed. Two more zeroes and the request never returns.

The languages built for this say the same thing about themselves. CEL is non-Turing-complete and
evaluates in linear time; Starlark forbids recursion and unbounded loops; both are the right prior
art and neither was consulted the first time. But Starlark's own issue tracker puts it plainly:
prohibiting recursion **helps achieve finite execution in theory, while in practice it is easy to
write a five-line program which will not finish**. Syntactic totality buys *finite*, and a request
needs *bounded*.

So the third violation is struck. **This file governs divergence, not cost.** Ambient input,
mutation and non-determinism each make one side wrong -- the server and the browser disagreeing,
or two backends disagreeing about the bytes. A slow derivation is slow everywhere, which is not a
disagreement about anything.

Cost is the same question the load stage raises and it has the same answer: it is the author's,
running the author's code over the author's data in the author's process, and an expression that
will not finish is the same failure as a loader that will not return. The protocol declines both.

The asymmetry that was supposed to follow runs the other way, which is worth recording because it
was assumed rather than checked. **QuickJS can bound execution and Node cannot.** Its
`JS_SetInterruptHandler` is called throughout evaluation and raises an uncatchable exception, and
`rquickjs` exposes it; Node has no way to preempt synchronous code at all. A backend may set a
budget, and that is a deployment choice rather than a rule here.

## Open

- **A default or a rest inside a destructuring.** `const { a = 1 } = t` and
  `const { a, ...rest } = t` both leave a name that is not a member of anything, and a default
  fires only on `undefined` where `??` would also catch `null`, so writing one as the other would
  be wrong rather than partial. Both are reported by name.

  It is the largest thing standing between the compiler and components people have already
  published. The way a modern Svelte library writes a conditional class is `class={cn(...)}` or
  `class={tv({...})}` -- a call, producing a string, in a substitution position the pipeline
  already handles. Measured across 1107 `.svelte` files in eleven published libraries, 267 carry
  such a call. Almost every one of them imports the function it calls.
- **A script that substitution cannot reach, reading the request.** A reassignment, a mutation or
  a loop leaves a name with no single expression standing for it. **It is refused, and this is
  decided rather than deferred.** Where the statements read nothing the request decides, the
  render evaluates them and the walk bakes the result -- `wants` in `walk.ts`, see
  [refusals.md](refusals.md) -- so what is refused is exactly a statement sequence whose inputs
  arrive with the request. That is a program run per request, which is the one thing CTR gives up
  by definition: the UI is rendered at compile time, and a component whose bytes can only be known
  by executing its script against the request is SSR's to render, not this protocol's. See
  [roadmap.md](roadmap.md) for the scope line, stated once.

  The measurement that made the decision cheap still stands. Across 4323 real components, 15
  assign to a declared name outside a function, and **not one of them is refused by that alone**
  -- every one is also turned away by a spread, a binding or something else -- and press has none.

  **If the scope line were ever moved**, three questions would have to be answered rather than one:
  `<script module>` runs once where an instance script runs per render, so a preamble that merged
  them would rebuild module state per request; the script's imports are a superset of the names
  `carry` bundles today, which follow expressions only; and a backend needs a JavaScript engine
  exactly when a component has a derivation -- 10 of the 14 components in the corpus have none, and
  that survives only if substitution stays the thing that turns a name into a path wherever it can,
  with the script reached for only where it cannot. See [ir.md](ir.md).
- **Per-item derivation.** *Settled.* A derivation reading a name an each block binds is computed
  where it is used, once per item, rather than once before injection.

  It was refused twice over, and the second refusal was right about the fault and wrong about the
  reason. First it was not refused at all: a component writing `{x > 2}` inside an each compiled and
  threw at request time with `deriving \`x > 2\` failed`, because the pass deciding between a path
  and an expression did not know what the block it sat in had bound. Teaching it turned that into a
  compile-time refusal naming the binding -- an improvement, and still a refusal.

  What was wrong is the premise. **"Computed once per request" was read as a rule about derivations
  and is a consequence of what their inputs are.** A derivation is a pure function of what is in
  scope; where that is the payload alone it can be computed once, and where it also reads a loop
  variable the same function is called per item. Nothing else changes: no component runs, no
  markup is rendered, and the expression is the author's own, unrewritten, as every other one is.

  So a scoped derivation is carried into the scope as a function of the scope stack rather than as
  a value, tagged so the injector calls it at the point of use instead of writing it out. A path
  rooted at an each binding is unaffected -- `{x.name}` was always resolved per item by the
  runtime, and the two now differ only in whether a function is called on the way.

  The cost is real and worth naming: an expression inside an each is evaluated once per item rather
  than once per request, so a list of a thousand is a thousand calls. That is what the author wrote,
  and it is what Svelte would have done with it.

  The written-bytes pass still refuses this, and stays refusing. It is an oracle with a limited
  life -- see [pipeline.md](pipeline.md) -- and the agreement test simply does not cover a case the
  render pass takes and it does not.
- **The shape of request context.** `$.now`, `$.tz` and `$.locale` are named here, and the wire
  carrying them is settled -- see [payload.md](payload.md), which means they can hold real values
  rather than numbers the author has to reconstitute. Where they sit within the data, and whether
  the load stage must supply them, is not decided.

## A derivation is computed when it is read, and not before

**A derivation is a pure expression, so *when* it is computed cannot change what it is. Whether it
is computed at all can.** They used to be evaluated up front, all of them, as the payload was
built. `{#if boxes.length === 2}{@const box2 = boxes[1]}` is a derivation that only makes sense
inside its branch -- Svelte evaluates a `{@const}` in the branch's own init -- and computing it for
a request that took another branch threw. The artifact had already been written by then, so the
refusal arrived per request rather than at the build, which is the one thing
[refusals.md](refusals.md) says a refusal must not do.

Each is a getter on the scope now, computed once on first read. A route also stops paying for the
branches it did not take, which on a page joined out of several structures is most of them.

**A prop's default is the exception and is marked `prop`.** It stands *over* a payload key rather
than beside it -- `typeof x === 'undefined' ? ... : x` under the name `x` -- so it has to be
computed in order, while the name still holds what the request brought; as a lazy read it would
resolve `x` to itself and recurse. Asking instead whether the key is already there does not work:
the request omitting it is exactly when the default matters.

## The helpers are carried under a name nothing can shadow

`attributes`, `attr_class`, `clsx` and `stringify` are Svelte's own, carried into the bundle so
that both backends run its implementation rather than agreeing about a rule. Svelte's own output
calls them through `$.`; ours had them bare, and a component with `export let attributes` -- an
ordinary name for a prop -- put an object where the helper's name was, so the derivation called it.
They are carried under `$$attributes` and the rest, which nothing the author writes can shadow
because Svelte reserves the `$$` prefix for its own.
