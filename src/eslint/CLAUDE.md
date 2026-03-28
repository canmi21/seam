# @canmi/eslint-plugin-seam

ESLint plugin enforcing build-time safety for filesystem-router page components rendered via `renderToString`.

## Architecture

- Filesystem-router page components (`page.tsx`) run at build time through React `renderToString`
- No browser APIs, async operations, or non-deterministic logic allowed
- Each rule lives in `src/rules/` as a standalone `Rule.RuleModule`
- Plugin entry (`src/index.ts`) exports `rules` map and `configs.recommended`
- `configs.recommended` scopes all rules to `page.tsx` via flat config `files` globs

## Key Files

| File                                           | Purpose                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                 | Plugin entry: exports rules + recommended config                                                                                                                                      |
| `src/rules/no-browser-apis-in-skeleton.ts`     | Bans window, document, localStorage, etc.                                                                                                                                             |
| `src/rules/no-async-in-skeleton.ts`            | Bans async/await, Promises, fetch, setTimeout                                                                                                                                         |
| `src/rules/no-nondeterministic-in-skeleton.ts` | Bans Date.now, Math.random, crypto                                                                                                                                                    |
| `src/rules/no-derived-data-in-skeleton.ts`     | Bans arithmetic, array derivation, formatting on seam data — enforces the derive layer boundary: computations on loader data belong in `RouteDef.derive` entries, not in render logic |
| `src/rules/no-effect-in-skeleton.ts`           | Warns useEffect/useLayoutEffect (dead code in renderToString)                                                                                                                         |

## Testing

```sh
just test-ts
```

- Tests in `__tests__/` use vitest + ESLint `RuleTester`
- Each test file mirrors a rule file: `no-browser-apis-in-skeleton.test.ts`, etc.
- `valid` cases: code that should NOT trigger the rule
- `invalid` cases: code that SHOULD produce errors (with expected `messageId`)

## Rule Development Workflow

1. Add AST visitors in the rule's `create()` method
2. Add `invalid` test cases with expected `errors: [{ messageId: "..." }]`
3. Run `just test-ts` to verify
4. Build with `just build-ts`

See root CLAUDE.md for project-wide conventions.
