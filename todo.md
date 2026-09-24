# To do

What the suite fails on, sorted by what closing each takes. The live list is
`mise run vendor-baseline`; this file is the plan, not the count.

## Doable now, decided

- [ ] **B. Script state over props.** Decided and built: where substitution cannot follow, the
      script runs as Svelte compiled it, the entry's and a child copy's (spec/derivation.md, "Where
      substitution cannot follow, the script runs as Svelte compiled it"; the plugin's own test holds
      a Kit page through the project's Vite). Left, each on a refusal that says why:
      await-then-destruct-computed-props and spread-component-side-effects (a function a derivation
      calls assigns a name), binding-backflow (a bound prop the child changes),
      component-not-constructor2 (a component the run chose), hydratable-error-on-missing (a
      `hydratable` in a run script), props-default-value-lazy-accessors (a destructuring default
      counting its calls), reactive-values-function-dependency and reactive-values-uninitialised (a
      neutralised name the script calls, which the render cannot run).

- [ ] **C and D: a value that is not data in the render input.** Decided: the render input and the
      hydration wire are two things, and the input holds any JavaScript value (spec/payload.md).
  - D, `transformError`: done where the boundary's children are markup and expressions (spec/ir.md,
    "A boundary that may throw is a block of its own, lowered to an `if`"). Left: error-boundary-27,
    async-error-boundary-2, async-error-boundary-3, which throw from inside a child component in
    the boundary.

## Work, with design questions to answer first

- [ ] **G. A raw snippet whose function reads a prop.** The author's `render` calls
      `svelte/server`'s `render(Child)` inside it. Two ways, and the first is a decision: carry
      `svelte/server` and compiled components into the derivation bundle, which crosses
      spec/pipeline.md's line that a derivation renders nothing and touches no component; or fold
      what reads nothing the request decides -- `render(Child).body` here, `Child` taking no props --
      by asking the render for a subexpression, which `Site.wants` does today only for a whole
      expression.
      snippet-raw-component, snippet-raw-component-ssr-dev

## Waiting on a decision

## Also open

- [ ] Refusal messages still carry the withdrawn scope reasons ("an artifact has nowhere to
      hold", "the payload carries data"); each changes with the gap it names.

## Done

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
