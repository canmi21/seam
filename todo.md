# To do

What the suite fails on, sorted by what closing each takes. The live list is
`mise run vendor-baseline`; this file is the plan, not the count.

## Doable now, no decision needed

- [ ] **A. Constant bytes, refused anyway.** The entry takes no props and nothing else the request
      supplies is read, so the compile-time render already has the bytes. The refusal fires on the
      shape before asking whether anything reads the request. `Error` is refused as a host global
      and is an ECMAScript built-in.
      binding-circular, binding-indirect-value, binding-input-group-each-8, block-expression-fn-call,
      block-expression-member-access, component-binding-each-reassigned,
      component-binding-each-remount-keyed, component-binding-each-remount-unkeyed,
      keyed-each-bind-read-index, props-reassign, reactive-assignment-in-complex-declaration-with-store,
      reactive-assignment-in-complex-declaration-with-store-2, rest-props-reassign,
      async-block-reject-during-init, async-derived-in-multiple-effects, async-derived-unowned,
      async-each-preserve-pending, async-error-in-block-expression, each-block-default-arg,
      props-default-value-rest, snippet-default-arg, destructure-state-iterable
      Done: props-default-value-rest (a child changing a prop the call site passes as a constant),
      async-block-reject-during-init, async-error-in-block-expression, async-derived-unowned,
      async-derived-in-multiple-effects (ECMAScript built-ins and timers as globals).
      Left: an entry whose payload is empty still writes derivations where the walk always does --
      an option's `selected`, an each item, a held destructuring, a store read -- and those are
      substituted where the render has the value.
- [ ] **B. Script state over props.** Deterministic statements over props (`$: x *= 2`,
      `count += 1`, `items.sort(...)`). Running the instance script per request and reading the
      names after is still a pure function of the payload. spec/derivation.md, Open.
- [ ] **G. Pure over props, not yet written.** A raw snippet whose function is called per request
      (snippet-raw-component, snippet-raw-component-ssr-dev). Done: an `await` of a promise built
      from a prop (hydratable-complex-nesting, hydratable-unused-keys-nesting-partial).

## Waiting on a decision

- [ ] **May the payload hold a value that is not data on the server?** A store, a promise, a
      component, a render option's function. Covers C (stores and components in props, 14) and
      D (`transformError`, 11).
- [ ] **May the derive stage read ambient state, or be non-deterministic?** Covers E
      (`Math.random`: random, props-derived; `Date()` and `Symbol()`: state-snapshot-date and
      derived-rest-includes-symbol, whose bytes are constant but which the compiler cannot prove
      without baking an ambient value or rendering twice) and F (a host global: globals-deconflicted; module
      state: reactive-import-statement). E also needs the suite to give both sides the same
      random numbers before it can compare bytes.

## Also open

- [ ] `runtime-legacy/spread-component-dynamic-undefined` hangs about one run in five: 3ms
      normally, and once the 5s deadline, filed as a harness skip. Cause not found.
- [ ] Refusal messages still carry the withdrawn scope reasons ("an artifact has nowhere to
      hold", "the payload carries data"); each changes with the gap it names.
