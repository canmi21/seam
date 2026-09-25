# To do

What the suite fails on, sorted by what closing each takes. The live list is
`mise run vendor-baseline`; this file is the plan, not the count.

## Doable now, decided

- [ ] **B. Script state over props.** Decided and built: where substitution cannot follow, the
      script runs as Svelte compiled it, the entry's and a child copy's (spec/derivation.md, "Where
      substitution cannot follow, the script runs as Svelte compiled it"). Left: binding-backflow (a
      bound prop the child changes, which renders the caller's template again).
- [ ] **An `await` written into a legacy-mode component.** With `experimental.async` on, this
      compiler writes an `await` into a component compiled without runes, and Svelte refuses it with
      `legacy_await_invalid`; upstream never compiles a legacy component with the flag, so nothing
      says what shape is right. The one sample the synchronous pass had passing that the one render
      does not (spec/suite.md, "One render: Svelte's with `experimental.async` on"). props-reactive.

## Work, with design questions to answer first

- [ ] **A branch the build knows is not taken is rendered anyway, and awaits inside it.** The first
      render forces every `{#if}` to its first branch so the branch has its say, after the walk has
      already asked the test and been answered (`__seam_asked["(0) > 0"]`); the forced branch awaits
      a promise the sample never resolves and the build never settles. Either the first render takes
      the answered branch where the test reads nothing the request decides, or an `await` in a forced
      branch is given a deadline and left to the render. async-state-new-branch-3,
      async-state-new-branch-fork-2, -fork-3, -fork-5.
- [ ] **A value with identity is re-spelled from its source.** `promise={a.promise}` over
      `const a = Promise.withResolvers()` reaches the copy as `await (Promise.withResolvers()).promise`,
      a fresh promise the script's `tick().then(() => a.resolve(true))` never resolves. Where
      substitution cannot follow, the script runs as Svelte compiled it (spec/derivation.md, "Where
      substitution cannot follow, the script runs as Svelte compiled it"); a promise, or any value
      made by a call and resolved by a side effect elsewhere, is one substitution cannot follow.
      async-head-multiple-title-order-preserved.

## Waiting on a decision

- [ ] **A component value the source does not name, rendered per request.** Svelte calls whatever
      `this` holds with the renderer: a `new Proxy(Sub, {})` and a function wrapping `Sub` both
      write `Sub`, measured, and neither can be told apart from outside by any means. Matching that
      means a derivation handing the value to Svelte's renderer per request, which spec/pipeline.md
      says a derivation does not do. Recording a proxy's target reaches the empty-handler proxy and
      nothing else. component-not-constructor2; C's unnamed component would follow the same answer.

## Also open

- [ ] Refusal messages still carry the withdrawn scope reasons ("an artifact has nowhere to
      hold", "the payload carries data"); each changes with the gap it names.

## Done

- Template changes, 2 samples: the rule refusing what the markup changes while the bytes are
  written is withdrawn, and the entry's run answers it with live bindings, each read where the
  render reads it (await-then-destruct-computed-props, spread-component-side-effects).
  spec/derivation.md, "What the markup changes while the bytes are written is changed in the run".
  A child's run still refuses it.

- B, 1 sample: the entry's run makes its `hydratable` calls into the request's record, and is the
  entry's one eager call (hydratable-error-on-missing). spec/derivation.md, "The entry's run makes
  its `hydratable` calls into the request's record".

- G, 2 samples: a raw snippet is a raw hole over the author's `render`, and what it computes that
  reads nothing the request decides -- `render(Child).body` included -- is a literal the build's
  render answers (snippet-raw-component, snippet-raw-component-ssr-dev). spec/derivation.md, "A
  value the request does not decide is the build's, however it is computed".

- B, 3 samples: the build's render no longer runs a statement that calls into what it was given
  nothing for, and the run answers it; a statement reaches what the functions, getters and `$props()`
  defaults it calls read and change (reactive-values-uninitialised,
  reactive-values-function-dependency, props-default-value-lazy-accessors). spec/derivation.md,
  "The build's render runs only what the run does not answer".

- D, 3 samples: a boundary's children are computed per request in the order the render computes
  them -- ifs, eaches, components and fragments included -- and every value inside both branches is a
  hole the request asks (error-boundary-27, async-error-boundary-2, async-error-boundary-3).
  spec/ir.md, "A boundary that may throw is a block of its own, lowered to an `if`".

- C, 3 samples: a component the request hands in that the source names none of compiles as Svelte's
  does -- nothing for nothing, a throw per request otherwise -- or is refused at the build under
  `refuseUnnamedComponents` (await-with-update, await-with-update-2, dynamic-component-dirty).

- E and F, 6 samples: a derivation reads a clock, randomness, a fresh symbol, a host's global and a
  module's state per request, as the server render does, and the build never reads one in its
  place (random, props-derived, state-snapshot-date, derived-rest-includes-symbol,
  globals-deconflicted, reactive-import-statement). spec/derivation.md, "Ambient input is read at
  request time, never at the build". Module state the render itself changes stays refused.

- D, 8 samples: a boundary with a `failed` snippet over markup and expressions is a block
  (boundary-error-failed-prop, boundary-error-with-onerror, the four boundary-error-html-comment
  escapes, error-boundary-26, async-error-boundary).

- B, 15 samples: the entry's script runs where a read cannot be substituted
  (ownership-invalid-mutation-use-transform, assignment-to-computed-property,
  binding-select-from-let-2, immutable-option, immutable-svelte-meta, immutable-svelte-meta-false,
  inline-style-directive-update-object-property, key-block-post-hydrate, reactive-compound-operator,
  reactive-update-expression, reactive-values-second-order, reactive-values-self-dependency,
  reactive-values-self-dependency-b, reactive-values-subscript-assignment,
  store-assignment-updates-reactive).

- C, stores in props (prop-exports, prop-subscribable, store-assignment-updates,
  store-auto-subscribe, store-auto-subscribe-implicit,
  store-auto-subscribe-in-reactive-declaration, store-auto-subscribe-nullish,
  store-auto-subscribe-removed-store, store-resubscribe-export,
  transition-js-if-outro-unrelated-component-store-update): `$x` over a prop is the store's value
  read per request. store-assignment-updates-reactive moved to B: its script assigns local stores
  from the request's.

- A, the 17 samples whose page no request can change (binding-circular, binding-indirect-value,
  binding-input-group-each-8, block-expression-fn-call, block-expression-member-access,
  component-binding-each-reassigned, component-binding-each-remount-keyed,
  component-binding-each-remount-unkeyed, keyed-each-bind-read-index, props-reassign,
  rest-props-reassign, reactive-assignment-in-complex-declaration-with-store and -2,
  each-block-default-arg, snippet-default-arg, destructure-state-iterable,
  async-each-preserve-pending): where the walk refuses and the entry reads nothing a request
  decides, the page is Svelte's render, whole. spec/pipeline.md.

- props-default-value-rest: a child changing a prop the call site passes as a constant is left to
  Svelte.
- async-block-reject-during-init, async-error-in-block-expression, async-derived-unowned,
  async-derived-in-multiple-effects: ECMAScript's built-ins and the timers resolve as globals.
- hydratable-complex-nesting, hydratable-unused-keys-nesting-partial: an `await` of what the
  request decides is an async derivation.
