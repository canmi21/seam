# To do

What the suite fails on, sorted by what closing each takes. The live list is
`mise run vendor-baseline`; this file is the plan, not the count.

## Doable now, decided

- [ ] **C and D: a value that is not data in the render input.** Decided: the render input and the
      hydration wire are two things, and the input holds any JavaScript value (spec/payload.md).
  - C, a component the request hands in: await-with-update, await-with-update-2,
    dynamic-component-dirty. The source names no component it could be; which components a request
    may hand in is the open part.
  - D, `transformError`: async-error-boundary, async-error-boundary-2, async-error-boundary-3,
    boundary-error-failed-prop, boundary-error-html-comment-close-bang-escape,
    boundary-error-html-comment-escape, boundary-error-html-comment-open-escape,
    boundary-error-html-comment-overlap-escape, boundary-error-with-onerror, error-boundary-26,
    error-boundary-27

## Work, with design questions to answer first

- [ ] **G. A raw snippet whose function reads a prop.** The author's `render` calls
      `svelte/server`'s `render(Child)` inside it. Two ways, and the first is a decision: carry
      `svelte/server` and compiled components into the derivation bundle, which crosses
      spec/pipeline.md's line that a derivation renders nothing and touches no component; or fold
      what reads nothing the request decides -- `render(Child).body` here, `Child` taking no props --
      by asking the render for a subexpression, which `Site.wants` does today only for a whole
      expression.
      snippet-raw-component, snippet-raw-component-ssr-dev

- [ ] **B. Script state over props.** Deterministic statements over props (`$: x *= 2`,
      `count += 1`, `items.sort(...)`): run the instance script per request and read the names
      after, still a pure function of the payload. spec/derivation.md, Open, names three questions:
      `<script module>` runs once where the instance script runs per render; the script's imports
      are more than `carry` bundles today; a backend then needs a JavaScript engine for any
      component that takes this path.
      assignment-to-computed-property, await-then-destruct-computed-props, binding-backflow,
      binding-select-from-let-2, component-not-constructor2, hydratable-error-on-missing,
      immutable-option, immutable-svelte-meta, immutable-svelte-meta-false,
      inline-style-directive-update-object-property, key-block-post-hydrate,
      ownership-invalid-mutation-use-transform, props-default-value-lazy-accessors,
      reactive-compound-operator, reactive-update-expression, reactive-values-function-dependency,
      reactive-values-second-order, reactive-values-self-dependency,
      reactive-values-self-dependency-b, reactive-values-subscript-assignment,
      reactive-values-uninitialised, spread-component-side-effects,
      store-assignment-updates-reactive

## Waiting on a decision

- [ ] **May the derive stage read ambient state, or be non-deterministic?**
  - E, a clock, randomness, a fresh symbol: random, props-derived; and state-snapshot-date,
    derived-rest-includes-symbol, whose bytes are constant but which cannot be proved so without
    baking an ambient value or rendering twice. `random` also needs the suite to give both sides
    the same numbers before it can compare bytes.
  - F, a host global and module state: globals-deconflicted, reactive-import-statement

## Also open

- [ ] `runtime-legacy/spread-component-dynamic-undefined` hangs about one run in five: 3ms
      normally, and once the 5s deadline, filed as a harness skip. Cause not found.
- [ ] Refusal messages still carry the withdrawn scope reasons ("an artifact has nowhere to
      hold", "the payload carries data"); each changes with the gap it names.

## Done

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
