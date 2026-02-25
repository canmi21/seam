# Skeleton Component Constraints

Skeleton components (`*-skeleton.tsx`) are rendered at build time by
`renderToString()` to extract CTR templates. They must be **pure,
synchronous, and deterministic**.

Two enforcement layers work together:

- **Runtime sandbox** (`installRenderTraps()` + `validateOutput()` in
  `packages/client/react/scripts/build-skeletons.mjs`) &mdash; traps
  dangerous APIs during `renderToString`, aborts the build on violation.
- **Static analysis** (`@canmi/eslint-plugin-seam` in `packages/eslint/`, 4 rules scoped to
  `**/*-skeleton.tsx`) &mdash; catches violations before build time.

---

## Allowed

These patterns are safe and verified in skeleton components:

| Pattern                                          | Notes                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `useSeamData<T>()`                               | Primary data access &mdash; returns sentinel object at build time      |
| `useState(initialValue)`                         | Initial value is baked into the template; setter is never called       |
| `useId()`                                        | Deterministic in `renderToString` (format `_R_N_`)                     |
| `useRef(initialValue)`                           | Ref object created but never mutated during SSR                        |
| `useMemo(() => expr, deps)`                      | Runs synchronously, result baked into template                         |
| `useContext(SomeContext)`                        | Reads context value synchronously                                      |
| `<Suspense>` children that resolve synchronously | Works, but lint bans `<Suspense>` to prevent accidental async fallback |
| Boolean `&&`, ternary, `.map()`                  | Structural rendering patterns for CTR variant extraction               |
| `typeof window !== "undefined"`                  | Guard check &mdash; `typeof` bypasses getter traps                     |

---

## Prohibited (build error)

Violations in this section abort the build immediately via `SeamBuildError`.

### `fetch()`

**Enforced by:** runtime trap (`installRenderTraps` line 53), lint rule `no-browser-apis-in-skeleton`

**Why:** Network calls are non-deterministic and asynchronous. Skeleton rendering must be a pure function of mock data.

**Error:** `fetch() is not allowed in skeleton components`

**Fix:** Move data fetching to a loader. Use `useSeamData()` to consume it.

### `Math.random()`

**Enforced by:** runtime trap (`installRenderTraps` line 54), lint rule `no-nondeterministic-in-skeleton`

**Why:** Produces different values on each render variant, making Rust multi-variant diff unreliable.

**Error:** `Math.random() is not allowed in skeleton components`

**Fix:** Use a deterministic sentinel value in `RouteDef.mock` instead.

### `Date.now()` / `new Date()`

**Enforced by:** runtime trap (`installRenderTraps` line 55), lint rule `no-nondeterministic-in-skeleton`

**Why:** Non-deterministic at build time &mdash; variant diffs become unstable.

**Error:** `Date.now() is not allowed in skeleton components`

**Fix:** Use a fixed mock date in `RouteDef.mock` instead.

### `crypto.randomUUID()` / `crypto.getRandomValues()`

**Enforced by:** runtime trap (`installRenderTraps` line 56&ndash;58), lint rule `no-nondeterministic-in-skeleton`

**Why:** Non-deterministic random generation.

**Error:** `crypto.randomUUID() is not allowed in skeleton components`

**Fix:** Use a fixed mock value in `RouteDef.mock` instead.

### `setTimeout()` / `setInterval()`

**Enforced by:** runtime trap (`installRenderTraps` line 62&ndash;63)

**Why:** Timer handles keep Node's event loop alive, causing the build process to hang indefinitely. `renderToString` returns synchronously, but pending timers prevent `process.exit`.

**Error:** `setTimeout() is not allowed in skeleton components`

**Fix:** Remove timer calls. If you need delayed behavior, it belongs in a non-skeleton component.

### `setImmediate()`

**Enforced by:** runtime trap (`installRenderTraps` line 64&ndash;66, conditional &mdash; only trapped when available in the runtime)

**Why:** Same as `setTimeout` &mdash; prevents clean process exit.

**Error:** `setImmediate() is not allowed in skeleton components`

**Fix:** Remove the call.

### `queueMicrotask()`

**Enforced by:** runtime trap (`installRenderTraps` line 67)

**Why:** Microtasks scheduled during render are not guaranteed to execute in time and prevent clean exit.

**Error:** `queueMicrotask() is not allowed in skeleton components`

**Fix:** Remove the call.

### `window` / `document` / `localStorage`

**Enforced by:** runtime trap (`installRenderTraps` line 71&ndash;84, getter trap on `globalThis`), lint rule `no-browser-apis-in-skeleton`

**Why:** These are browser-only globals. They do not exist in the Node/Bun environment where `renderToString` runs.

**Error:** `window is not available in skeleton components`

**Lint also catches:** `sessionStorage`, `navigator`, `location` (additional browser globals not trapped at runtime but caught by lint)

**Fix:** Guard with `typeof window !== "undefined"` (bypasses the getter trap) or move the logic to `useEffect` in a non-skeleton component.

### `use()` with Promise

**Enforced by:** lint rule `no-async-in-skeleton` (bans all `use()` calls), runtime `validateOutput` detects `<!--$!-->` abort markers

**Why:** `use(Promise.resolve())` silently suspends inside `renderToString`, producing a Suspense abort marker (`<!--$!-->`) that bakes fallback content into the template, corrupting it.

**Error (lint):**

```
use() is not allowed in skeleton components.
  Safe: use(thenable with status:'fulfilled') works at build time,
        but static analysis cannot verify this.
  Risk: use(Promise.resolve()) silently suspends and corrupts the template.
  Fix:  Move data fetching to a loader. Use useSeamData() to consume it.
```

**Error (runtime, if `<Suspense>` wraps the `use()` call):**

```
Suspense abort detected -- a component used an unresolved async resource
  (e.g. use(promise)) inside a <Suspense> boundary, producing an incomplete
  template with fallback content baked in.
  Fix: remove use() from skeleton components. Async data belongs in loaders.
```

**Fix:** Move data fetching to a loader. Use `useSeamData()` to consume it.

### `async function` / `async () =>`

**Enforced by:** lint rule `no-async-in-skeleton`

**Why:** Skeleton components must render synchronously. `renderToString` does not await async components.

**Error:** `Async components are not allowed in skeleton files. Skeleton components must render synchronously.`

**Fix:** Remove `async`. Use loaders for async data.

### `<Suspense>`

**Enforced by:** lint rule `no-async-in-skeleton`

**Why:** Suspense boundaries may produce abort markers (`<!--$!-->`) that corrupt CTR templates.

**Error:** `Suspense boundaries in skeleton components may produce abort markers (<!--$!-->) that corrupt CTR templates.`

**Fix:** Remove the `<Suspense>` boundary. If a child needs async data, move it to a loader.

---

## Prohibited (lint warning)

Violations in this section do not abort the build, but produce ESLint warnings.

### `useEffect()` / `useLayoutEffect()`

**Enforced by:** lint rule `no-effect-in-skeleton` (severity: `warn`)

**Why:** `renderToString` completely skips all effect callbacks. The code is dead &mdash; it never executes at build time and has zero impact on the template output.

**Warning:**

```
useEffect() has no effect during build-time rendering (renderToString skips all effects).
  This is dead code in a skeleton component.
  If you need client-side behavior, it belongs in a non-skeleton component.
```

**Fix:** Remove the effect. If you need client-side behavior (DOM manipulation, subscriptions), it belongs in a non-skeleton component that only runs in the browser.

---

## Build warnings (non-fatal, auto-fixed)

### React `preload()` / `preinit()` resource hints

**Enforced by:** `validateOutput()` + `stripResourceHints()` in `build-skeletons.mjs`

**What happens:** React's `preload()` and `preinit()` APIs inject `<link>` tags (with `rel="preload"`, `rel="dns-prefetch"`, `rel="preconnect"`, or `data-precedence`) into `renderToString` output. These are not data-driven and would cause hydration mismatch.

**Behavior:** Detected via regex, stripped from the template output automatically, logged as a build warning.

**Not affected:** User-authored `<link rel="stylesheet">` tags without `data-precedence` are preserved. Sentinel-bearing `<link>` tags (containing `%%SEAM:`) are also preserved.

---

## React 19.2 Compatibility

Verified with React 19.2 in Chrome with real hydration through the full CTR pipeline:

| Feature                                           | renderToString behavior                                  | CTR compatible        | Notes                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `useId()`                                         | Produces `_R_N_` format IDs                              | Yes                   | StrictMode transparent to ID generation                                                    |
| `<Suspense>` markers                              | Emits `<!--$-->` / `<!--/$-->`                           | Yes                   | Rust parser treats as `Comment("$")`, `sentinel_to_slots` regex ignores them               |
| `<Activity>` markers                              | Emits `<!--&-->` / `<!--/&-->`                           | Yes                   | Same treatment as Suspense markers                                                         |
| Metadata hoisting (`<title>`, `<meta>`, `<link>`) | Hoisted to root of renderToString output (not `<head>`)  | Yes                   | `wrap_document` extracts leading metadata into `<head>` for proper SEO                     |
| `ref` as prop (React 19+)                         | Never appears as HTML attribute in renderToString output | Yes                   | No impact on template extraction                                                           |
| `<Context>` as provider (new syntax)              | Output byte-identical to `<Context.Provider>`            | Yes                   | No wrapper nodes, sentinels preserved, useId stable                                        |
| `preload()` / `preinit()`                         | Injects `<link>` tags into output                        | Yes (auto-stripped)   | Stripped when `data-precedence` present; user-authored `<link rel="stylesheet">` preserved |
| `use(thenable{status:"fulfilled"})`               | Synchronous fast path, renders normally                  | Yes (but lint-banned) | Static analysis cannot distinguish safe thenables from unsafe Promises                     |
| `use(Promise.resolve())`                          | Suspends, produces error or `<!--$!-->`                  | **No**                | Promise `.then()` uses microtask queue, incompatible with synchronous renderToString       |

---

## Enforcement summary

| API / Pattern                               | Runtime trap                           | Lint rule                         | Severity            |
| ------------------------------------------- | -------------------------------------- | --------------------------------- | ------------------- |
| `fetch()`                                   | Yes                                    | `no-browser-apis-in-skeleton`     | error               |
| `Math.random()`                             | Yes                                    | `no-nondeterministic-in-skeleton` | error               |
| `Date.now()` / `new Date()`                 | Yes                                    | `no-nondeterministic-in-skeleton` | error               |
| `crypto.randomUUID()` / `getRandomValues()` | Yes                                    | `no-nondeterministic-in-skeleton` | error               |
| `setTimeout()` / `setInterval()`            | Yes                                    | &mdash;                           | error               |
| `setImmediate()`                            | Yes (conditional)                      | &mdash;                           | error               |
| `queueMicrotask()`                          | Yes                                    | &mdash;                           | error               |
| `window` / `document` / `localStorage`      | Yes (getter trap)                      | `no-browser-apis-in-skeleton`     | error               |
| `sessionStorage` / `navigator` / `location` | &mdash;                                | `no-browser-apis-in-skeleton`     | error               |
| `use()`                                     | `validateOutput` (detects `<!--$!-->`) | `no-async-in-skeleton`            | error               |
| `async function` / `async () =>`            | &mdash;                                | `no-async-in-skeleton`            | error               |
| `<Suspense>`                                | `validateOutput` (detects `<!--$!-->`) | `no-async-in-skeleton`            | error               |
| `useEffect()` / `useLayoutEffect()`         | &mdash;                                | `no-effect-in-skeleton`           | warn                |
| `preload()` / `preinit()` hints             | `validateOutput` (auto-strip)          | &mdash;                           | warning (non-fatal) |
