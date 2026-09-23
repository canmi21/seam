# To do

What the suite fails on, sorted by what closing each takes. The live list is
`mise run vendor-baseline`; this file is the plan, not the count.

## Doable now, no decision needed

- [ ] **A. Constant bytes, refused anyway.** The entry's payload is empty, so the compile-time
      render already has the bytes; a refusal fires on a shape before asking whether anything reads
      the request. Four causes:
  - [ ] **A1. Positions the walk always writes as a derivation.** An option's `selected`, an each
        item, a held destructuring, a store read -- each substituted outside the render, which has
        the value. Fix: where the value varies with nothing the request decides, ask the render
        (`Site.wants`), as an each's source already is; an each item is the hard one, being one
        value per item.
        async-each-preserve-pending, binding-circular, binding-input-group-each-8,
        destructure-state-iterable, each-block-default-arg,
        reactive-assignment-in-complex-declaration-with-store,
        reactive-assignment-in-complex-declaration-with-store-2
  - [ ] **A2. `asWritten` expands a name the walk bound** -- a `{@const}`, a snippet parameter --
        and the expansion reads a name the script changes.
        block-expression-fn-call, block-expression-member-access, snippet-default-arg
  - [ ] **A3. A child changes a prop the call site binds with `bind:`,** from a value that varies
        with nothing the request decides.
        binding-indirect-value, component-binding-each-reassigned, keyed-each-bind-read-index
  - [ ] **A4. `locals()` refuses before the walk:** a write into `$$props` or `$$restProps`, and a
        name assigned after its declaration in a copy.
        props-reassign, rest-props-reassign, component-binding-each-remount-keyed,
        component-binding-each-remount-unkeyed
- [ ] **G. A raw snippet whose function reads a prop.** The derivation calls the author's function
      per request; it is a pure function of the payload.
      snippet-raw-component, snippet-raw-component-ssr-dev

## Work, with design questions to answer first

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
      reactive-values-uninitialised, spread-component-side-effects

## Waiting on a decision

- [ ] **May the payload hold a value that is not data on the server?** A store, a promise, a
      component, a render option's function.
  - C, stores and components in props: await-with-update, await-with-update-2,
    dynamic-component-dirty, prop-exports, prop-subscribable, store-assignment-updates,
    store-assignment-updates-reactive, store-auto-subscribe, store-auto-subscribe-implicit,
    store-auto-subscribe-in-reactive-declaration, store-auto-subscribe-nullish,
    store-auto-subscribe-removed-store, store-resubscribe-export,
    transition-js-if-outro-unrelated-component-store-update
  - D, `transformError`: async-error-boundary, async-error-boundary-2, async-error-boundary-3,
    boundary-error-failed-prop, boundary-error-html-comment-close-bang-escape,
    boundary-error-html-comment-escape, boundary-error-html-comment-open-escape,
    boundary-error-html-comment-overlap-escape, boundary-error-with-onerror, error-boundary-26,
    error-boundary-27
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

- props-default-value-rest: a child changing a prop the call site passes as a constant is left to
  Svelte.
- async-block-reject-during-init, async-error-in-block-expression, async-derived-unowned,
  async-derived-in-multiple-effects: ECMAScript's built-ins and the timers resolve as globals.
- hydratable-complex-nesting, hydratable-unused-keys-nesting-partial: an `await` of what the
  request decides is an async derivation.
